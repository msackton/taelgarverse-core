import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {robots as robotsPolicy} from '../src/crawler-policy.mjs';
import {ROOT} from '../src/config.mjs';
import {coreRelease,publication} from './helpers/page-cache-fixture.mjs';

test('real Worker rejects crawlers before content exists and serves browsers after publication',async t=>{
  const bundle=await build({stdin:{contents:"import {createWorker} from './src/worker-handler.mjs'; export default createWorker("+JSON.stringify(coreRelease)+');',
    resolveDir:ROOT,sourcefile:'crawler-policy-worker.mjs'},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],write:false,logLevel:'silent'});
  const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-19',
    compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:0,cf:false,cache:true,
    bindings:{BLOCK_CRAWLERS:'true'},r2Buckets:{CONTENT:'crawler-policy-test'}}),telemetry:{enabled:false}});
  t.after(()=>mf.dispose());
  const url='https://taelgar.org/page/person';
  const bot=await mf.dispatchFetch(url,{headers:{'User-Agent':'Googlebot/2.1'}});
  assert.equal(bot.status,403);assert.match(await bot.text(),/Automated access/);
  const robots=await mf.dispatchFetch('https://taelgar.org/robots.txt',{headers:{'User-Agent':'QlyzeBot/1.0'}});
  assert.equal(robots.status,200);assert.equal(await robots.text(),robotsPolicy);
  const r2=await mf.getR2Bucket('CONTENT');
  for(const [key,value] of publication().objects)await r2.put(key,value);
  for(const agent of ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1']){
    const browser=await mf.dispatchFetch(url,{headers:{'User-Agent':agent}});
    assert.equal(browser.status,200);assert.match(browser.headers.get('X-Robots-Tag'),/noindex/);
    assert.match(await browser.text(),/Original biography/);
  }
  assert.equal((await mf.dispatchFetch(url,{headers:{'User-Agent':'QlyzeBot/1.0'}})).status,403);
});
