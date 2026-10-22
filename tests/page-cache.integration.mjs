// Exercise the actual Workers Cache API and R2 binding locally, without any
// production resources. The ordinary suite uses an injected cache for failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {ROOT} from '../src/config.mjs';
import {coreRelease,publication} from './helpers/page-cache-fixture.mjs';

test('real Workers Cache API stores HTML, revalidates browsers and follows R2 publication changes',async t=>{
  const bundle=await build({stdin:{contents:"import {createWorker} from './src/worker-handler.mjs'; export default createWorker("+JSON.stringify(coreRelease)+');',
    resolveDir:ROOT,sourcefile:'page-cache-worker.mjs'},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],write:false,logLevel:'silent'});
  const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-19',
    compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:0,cf:false,cache:true,r2Buckets:{CONTENT:'page-cache-test'}}),telemetry:{enabled:false}});
  t.after(()=>mf.dispose());
  const r2=await mf.getR2Bucket('CONTENT'),first=publication();
  for(const [key,value] of first.objects)await r2.put(key,value);
  const url='https://taelgar.org/page/person';
  const miss=await mf.dispatchFetch(url);assert.equal(miss.status,200);
  assert.equal(miss.headers.get('X-Taelgar-Page-Cache'),'MISS');
  const etag=miss.headers.get('ETag'),body=await miss.text();
  // Writes use waitUntil and can finish after the first response. Observe the
  // persisted entry with bounded requests through the real Worker handler.
  let hit;
  for(let i=0;i<10;i++){
    hit=await mf.dispatchFetch(url);
    if(hit.headers.get('X-Taelgar-Page-Cache')==='HIT')break;
    await hit.text();
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(hit.headers.get('X-Taelgar-Page-Cache'),'HIT');assert.equal(await hit.text(),body);
  assert.equal(hit.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');
  const conditional=await mf.dispatchFetch(url,{headers:{'If-None-Match':etag}});
  assert.equal(conditional.status,304);assert.equal(await conditional.text(),'');
  const head=await mf.dispatchFetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const next=publication({revision:'b'.repeat(64),text:'Changed after publishing.'});
  for(const [key,value] of next.objects)await r2.put(key,value);
  const changed=await mf.dispatchFetch(url,{headers:{'If-None-Match':etag}});
  assert.equal(changed.status,200);assert.equal(changed.headers.get('X-Taelgar-Page-Cache'),'MISS');
  assert.notEqual(changed.headers.get('ETag'),etag);assert.match(await changed.text(),/Changed after publishing/);
});
