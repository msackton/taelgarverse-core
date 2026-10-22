import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/worker-handler.mjs';
import {pageCache} from '../src/page-cache.mjs';
import {coreRelease,publication,Bucket,PageCache} from './helpers/page-cache-fixture.mjs';

const browserPolicy='public, max-age=0, must-revalidate';
const setup=options=>{
  const {objects,pointer}=publication(options),bucket=new Bucket(objects),cache=new PageCache();
  const env={CONTENT:bucket,ASSETS:{fetch:async()=>new Response('theme')}};
  const worker=()=>createWorker(coreRelease,{cache});
  const request=(url='/page/person',options={},instance=worker(),context)=>instance.fetch(new Request(new URL(url,'https://taelgar.org'),options),env,context);
  return {bucket,cache,pointer,env,worker,request};
};

test('page and homepage hits skip snapshot initialization even in a fresh Worker',async()=>{
  const {request,bucket,cache}=setup();
  for(const url of ['/page/person','/','https://frontier.taelgar.org/']){
    const first=await request(url);assert.equal(first.status,200);
    assert.equal(first.headers.get('X-Taelgar-Page-Cache'),'MISS');assert.equal(first.headers.get('Cache-Control'),browserPolicy);
    const body=await first.text();assert.ok(body.length>1000);
    bucket.calls.length=0;
    const hit=await request(url);assert.equal(hit.headers.get('X-Taelgar-Page-Cache'),'HIT');
    assert.equal(hit.headers.get('ETag'),first.headers.get('ETag'));assert.equal(await hit.text(),body);
    assert.deepEqual(bucket.calls,['published/current.json']);
  }
  assert.equal(cache.values.size,3);
  for(const value of cache.values.values())assert.equal(new Headers(value.headers).get('Cache-Control'),'public, max-age=86400');
});

test('hostnames and all URL variants remain isolated, including repeated parameters and POV overrides',async()=>{
  const {request,env}=setup(),uncached=createWorker(coreRelease,{cache:null});
  const urls=['/page/person','/page/person?dm=1','/page/person?date=1720-01-01','/page/person?context=frontier',
    '/page/person?context=custom&campaigns=adma','/page/person?campaigns=dufr&campaigns=adma','/page/person?campaigns=all',
    '/page/person?dm=1&dm=0','/page/person?dm=0&dm=1','/page/future?pov=0',
    'https://frontier.taelgar.org/page/person?context=modern','https://www.taelgar.org/page/person','/page/other'];
  const etags=new Set();
  for(const url of urls){
    const expected=await uncached.fetch(new Request(new URL(url,'https://taelgar.org')),env);
    assert.equal(expected.status,200,url);const body=await expected.text();
    const first=await request(url);assert.equal(first.headers.get('X-Taelgar-Page-Cache'),'MISS',url);
    assert.equal(await first.text(),body,url);etags.add(first.headers.get('ETag'));
    const hit=await request(url);assert.equal(hit.headers.get('X-Taelgar-Page-Cache'),'HIT',url);assert.equal(await hit.text(),body,url);
  }
  assert.equal(etags.size,urls.length);
  assert.equal((await request('/page/future?pov=1')).status,404);
  assert.equal((await request('https://frontier.taelgar.org/page/future?pov=0')).status,404);
  assert.equal((await request('/page/person?dm=0')).status,200);
  assert.doesNotMatch(await (await request('/page/person?dm=0')).text(),/secret detail/);
  assert.match(await (await request('/page/person?dm=1')).text(),/secret detail/);
});

test('publishing, activation metadata and rollback invalidate cached representations',async()=>{
  const {request,bucket,pointer,worker}=setup(),sameWorker=worker();
  const first=await request('/page/person',{},sameWorker),etag=first.headers.get('ETag');await first.text();
  await (await request('/page/other',{},sameWorker)).text();
  const campaignUrl='https://frontier.taelgar.org/page/person';
  assert.match(await (await request(campaignUrl,{},sameWorker)).text(),/Frontier paragraph/);
  const next=publication({revision:'b'.repeat(64),text:'Updated biography.',linked:'Renamed',siteCampaigns:'adma'});
  for(const [key,value] of next.objects)bucket.objects.set(key,value);
  const updated=await request('/page/person',{headers:{'If-None-Match':etag}},sameWorker);
  assert.equal(updated.status,200);assert.equal(updated.headers.get('X-Taelgar-Page-Cache'),'MISS');
  assert.notEqual(updated.headers.get('ETag'),etag);const body=await updated.text();
  assert.match(body,/Updated biography/);assert.match(body,/\/page\/renamed/);
  assert.equal((await request('/page/other',{},sameWorker)).status,404);
  const campaign=await request(campaignUrl,{},sameWorker);assert.equal(campaign.headers.get('X-Taelgar-Page-Cache'),'MISS');
  assert.doesNotMatch(await campaign.text(),/Frontier paragraph/);
  // A rollback can reuse the original revision but has a new activation date.
  const rollback={...pointer,completedAt:'2026-10-23T10:00:00.000Z'};
  bucket.objects.set('published/current.json',JSON.stringify(rollback));
  const restored=await request('/page/person',{headers:{'If-None-Match':etag}},sameWorker);
  assert.equal(restored.status,200);assert.notEqual(restored.headers.get('ETag'),etag);
  const restoredBody=await restored.text();assert.match(restoredBody,/Original biography/);assert.match(restoredBody,/2026-10-23T10:00:00.000Z/);
  for(const changes of [{commit:'e'.repeat(40)},{dirty:true},{completedAt:'2026-10-24T10:00:00.000Z'}]){
    bucket.objects.set('published/current.json',JSON.stringify({...rollback,...changes}));
    const changed=await request('/page/person',{},sameWorker);assert.equal(changed.headers.get('X-Taelgar-Page-Cache'),'MISS');await changed.text();
  }
});

test('website deploys and same-commit rebuilds cannot reuse old HTML',async()=>{
  const {request,cache,env}=setup();await (await request()).text();
  for(const changes of [{commit:'f'.repeat(40)},{publishedAt:'2026-10-22T12:00:00.000Z'},{dirty:true}]){
    const worker=createWorker({...coreRelease,...changes},{cache}),response=await worker.fetch(new Request('https://taelgar.org/page/person'),env);
    assert.equal(response.headers.get('X-Taelgar-Page-Cache'),'MISS');await response.text();
  }
});

test('GET/HEAD revalidation returns bodyless 304s and HEAD misses never poison cached GETs',async()=>{
  const {request,bucket,cache}=setup();
  const head=await request('/page/person',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal(cache.values.size,0);
  const first=await request(),etag=first.headers.get('ETag'),body=await first.text();assert.ok(body.length>1000);
  assert.equal(head.headers.get('ETag'),etag);
  for(const method of ['GET','HEAD'])for(const value of [etag,etag.slice(2),'"different", '+etag,'*']){
    bucket.calls.length=0;
    const response=await request('/page/person',{method,headers:{'If-None-Match':value}});
    assert.equal(response.status,304);assert.equal(await response.text(),'');assert.equal(response.headers.get('Cache-Control'),browserPolicy);
    assert.deepEqual(bucket.calls,['published/current.json']);
  }
  const stale=await request('/page/person',{headers:{'If-None-Match':'"different"'}});assert.equal(stale.status,200);assert.equal(await stale.text(),body);
  assert.equal(await (await request('/page/person',{method:'HEAD'})).text(),'');
  assert.equal(await (await request()).text(),body);
  cache.values.clear();
  const revalidated=await request('/page/person',{headers:{'If-None-Match':etag}});
  assert.equal(revalidated.status,304);assert.equal(await revalidated.text(),'');assert.equal(cache.values.size,1);
  assert.equal(await (await request()).text(),body);
});

test('errors, search, APIs, fallback homepages and bypassed requests remain uncached',async()=>{
  const {request,cache}=setup();
  for(const [url,status] of [['/page/missing',404],['/page/broken',422],['/page/person?date=bad',400],['/page/future',404],
    ['https://missing.taelgar.org/',404],['/%ZZ',400],['/?q=',200],['/api/page?page=Person',200],['/api/contexts',200],['/health',200]]){
    const response=await request(url);assert.equal(response.status,status,url);assert.equal(response.headers.get('Cache-Control'),'no-store',url);await response.text();
  }
  assert.equal(cache.values.size,0);
  await (await request()).text();const matches=cache.matches.length,puts=cache.puts.length;
  for(const options of [{method:'POST'},{headers:{Authorization:'Bearer fixture'}},{headers:{Range:'bytes=0-10'}},{headers:{'Cache-Control':'no-store'}}]){
    const response=await request('/page/person',options);assert.equal(response.headers.get('Cache-Control'),'no-store');await response.text();
  }
  assert.equal(cache.matches.length,matches);assert.equal(cache.puts.length,puts);
  const fallback=setup({home:null});const response=await fallback.request('/');assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(fallback.cache.values.size,0);
  const policy=pageCache(new Request('https://taelgar.org/page/person'),{revision:'a'.repeat(64)},coreRelease,cache);
  for(const headers of [{'Set-Cookie':'session=fixture'},{Vary:'Cookie'},{'Cache-Control':'private'}]){
    assert.equal(policy.accepts(new Response('private',{headers:{'Content-Type':'text/html',...headers}})),false);
  }
});

test('a missing or invalid publication never serves cached HTML',async()=>{
  const {request,bucket,cache,pointer}=setup();await (await request()).text();const matches=cache.matches.length;
  for(const value of [undefined,'{}','{bad json']){
    if(value===undefined)bucket.objects.delete('published/current.json');else bucket.objects.set('published/current.json',value);
    const response=await request();assert.ok(response.status>=500);assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  assert.equal(cache.matches.length,matches);
  bucket.objects.set('published/current.json',JSON.stringify(pointer));assert.equal((await request()).headers.get('X-Taelgar-Page-Cache'),'HIT');
});

test('cache failures fall back to rendering and writes use waitUntil without delaying the response',async()=>{
  const {request,cache,worker}=setup();
  cache.match=async()=>{throw new Error('cache unavailable');};cache.put=async()=>{throw new Error('cache unavailable');};
  const response=await request();assert.equal(response.status,200);assert.match(await response.text(),/Original biography/);
  let release;
  const pending=new Promise(resolve=>{release=resolve;}),waits=[];
  cache.match=async()=>undefined;cache.put=()=>pending;
  const immediate=await request('/page/person',{},worker(),{waitUntil:task=>waits.push(task)});
  assert.equal(immediate.status,200);assert.equal(waits.length,1);assert.match(await immediate.text(),/Original biography/);
  release();await Promise.all(waits);
});
