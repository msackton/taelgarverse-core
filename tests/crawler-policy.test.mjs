import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/worker-handler.mjs';
import {isCrawler,noIndex,robots as robotsPolicy} from '../src/crawler-policy.mjs';
import {coreRelease,publication,Bucket,PageCache} from './helpers/page-cache-fixture.mjs';

const browser='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const request=(path,agent=browser,options={})=>new Request(new URL(path,'https://taelgar.org'),{
  ...options,headers:{...(agent===null?{}:{'User-Agent':agent}),...options.headers},
});
const untouched={BLOCK_CRAWLERS:'true',
  get CONTENT(){assert.fail('Rejected crawlers and robots.txt must not read R2');},
  get SEARCH_DB(){assert.fail('Rejected crawlers must not query D1');},
  get ASSETS(){assert.fail('Rejected crawlers must not read assets');},
};

test('crawlers and automated clients are rejected before any content or cache access',async()=>{
  const agents=['Googlebot/2.1','bingbot/2.0','QlyzeBot/1.0','serpstatbot/2.1','GPTBot/1.4','ChatGPT-User/1.0',
    'Claude-User/1.0','meta-webindexer/1.1','facebookexternalhit/1.1','HeadlessChrome/130.0',
    'python-requests/2.32','curl/8.0','Wget/1.25','Go-http-client/1.1','node','undici','',null];
  const cache={match(){assert.fail('Crawler requests must not consult the page cache');}};
  const worker=createWorker(coreRelease,{cache});
  for(const agent of agents)for(const path of ['/page/person','/api/search?q=test','/theme/material.css']){
    const response=await worker.fetch(request(path,agent),untouched);
    assert.equal(response.status,403,`${agent}: ${path}`);
    assert.equal(response.headers.get('X-Robots-Tag'),noIndex);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.match(await response.text(),/Automated access/);
  }
  const head=await worker.fetch(request('/page/person','QlyzeBot/1.0',{method:'HEAD'}),untouched);
  assert.equal(head.status,403);assert.equal(await head.text(),'');
});

test('trusted verified-bot signals reject browser-looking crawlers without trusting spoofable headers',async()=>{
  for(const cf of [{verifiedBotCategory:'Search Engine Crawler'},{verifiedBotCategory:'Page Preview'},
    {botManagement:{verifiedBot:true}}]){
    const incoming=request('/page/person');Object.defineProperty(incoming,'cf',{value:cf});
    assert.equal((await createWorker().fetch(incoming,untouched)).status,403);
  }
  assert.equal(isCrawler(request('/page/person')),false);
  assert.equal(isCrawler(request('/page/person',browser,{headers:{'X-Verified-Bot':'true'}})),false);
  const unknown=request('/page/person');Object.defineProperty(unknown,'cf',{value:{verifiedBotCategory:'Unknown'}});
  assert.equal(isCrawler(unknown),false);
});

test('robots exclusions are available to every crawler without content, including HEAD and method errors',async()=>{
  const worker=createWorker();
  const robots=await worker.fetch(request('/robots.txt','Googlebot/2.1'),untouched);
  assert.equal(robots.status,200);assert.equal(await robots.text(),robotsPolicy);
  assert.equal(robots.headers.get('X-Robots-Tag'),noIndex);
  const head=await worker.fetch(request('/robots.txt',null,{method:'HEAD'}),untouched);
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  const invalid=await worker.fetch(request('/robots.txt',browser,{method:'POST'}),untouched);
  assert.equal(invalid.status,405);assert.equal(invalid.headers.get('Allow'),'GET, HEAD');
});

test('ordinary browser pages, cached responses, APIs, assets and errors retain behavior with no-index headers',async()=>{
  const {objects}=publication(),bucket=new Bucket(objects),cache=new PageCache();
  const worker=createWorker(coreRelease,{cache});
  const env={BLOCK_CRAWLERS:'true',CONTENT:bucket,ASSETS:{fetch:async()=>new Response('asset',{headers:{'Cache-Control':'public, max-age=3600'}})}};
  const first=await worker.fetch(request('/page/person'),env);
  assert.equal(first.status,200);assert.equal(first.headers.get('X-Taelgar-Page-Cache'),'MISS');
  assert.equal(first.headers.get('X-Robots-Tag'),noIndex);
  const body=await first.text(),etag=first.headers.get('ETag');
  const hit=await worker.fetch(request('/page/person'),env);
  assert.equal(hit.headers.get('X-Taelgar-Page-Cache'),'HIT');assert.equal(await hit.text(),body);
  assert.equal(hit.headers.get('X-Robots-Tag'),noIndex);
  const conditional=await worker.fetch(request('/page/person',browser,{headers:{'If-None-Match':etag}}),env);
  assert.equal(conditional.status,304);assert.equal(await conditional.text(),'');
  assert.equal(conditional.headers.get('X-Robots-Tag'),noIndex);
  for(const [path,status] of [['/api/contexts',200],['/theme/material.css',200],['/page/missing',404],['/%ZZ',400]]){
    const response=await worker.fetch(request(path),env);assert.equal(response.status,status,path);
    assert.equal(response.headers.get('X-Robots-Tag'),noIndex);await response.text();
  }
});

test('health checks remain real and crawler blocking can be explicitly disabled',async()=>{
  const {objects}=publication(),bucket=new Bucket(objects),worker=createWorker(coreRelease,{cache:null});
  const env={BLOCK_CRAWLERS:'true',CONTENT:bucket};
  const health=await worker.fetch(request('/health','curl/8.0'),env);
  assert.equal(health.status,200);assert.equal((await health.json()).runtime,'cloudflare-worker');
  assert.ok(bucket.calls.includes('published/current.json'));
  for(const BLOCK_CRAWLERS of ['false',undefined]){
    const response=await worker.fetch(request('/page/person','Googlebot/2.1'),{...env,BLOCK_CRAWLERS});
    assert.equal(response.status,200);assert.equal(response.headers.get('X-Robots-Tag'),null);await response.text();
  }
  const failed=await worker.fetch(request('/health','curl/8.0'),{BLOCK_CRAWLERS:'true',CONTENT:{get:async()=>{throw new Error('offline');}}});
  assert.equal(failed.status,500);assert.equal(failed.headers.get('X-Robots-Tag'),noIndex);
});

 test('only trusted AI Assistant classification permits user-directed reads',async()=>{
  const worker=createWorker(coreRelease,{cache:null});
  const {objects}=publication(),env={BLOCK_CRAWLERS:'true',CONTENT:new Bucket(objects)};
  for(const agent of ['ChatGPT-User/1.0','Claude-User/1.0','Perplexity-User/1.0']){
    for(const method of ['GET','HEAD']){
      const incoming=request('/page/person',agent,{method});
      Object.defineProperty(incoming,'cf',{value:{verifiedBotCategory:'AI Assistant'}});
      assert.equal((await worker.fetch(incoming,env)).status,200);
    }
    assert.equal((await worker.fetch(request('/page/person',agent),untouched)).status,403);
    const spoof=request('/page/person',agent,{headers:{'X-Verified-Bot-Category':'AI Assistant'}});
    assert.equal((await worker.fetch(spoof,untouched)).status,403);
    for(const category of ['AI Crawler','Search Engine Crawler']){
      const incoming=request('/page/person',agent);
      Object.defineProperty(incoming,'cf',{value:{verifiedBotCategory:category}});
      assert.equal((await worker.fetch(incoming,untouched)).status,403);
    }
    const write=request('/page/person',agent,{method:'POST'});
    Object.defineProperty(write,'cf',{value:{verifiedBotCategory:'AI Assistant'}});
    assert.equal((await worker.fetch(write,untouched)).status,403);
  }
});
