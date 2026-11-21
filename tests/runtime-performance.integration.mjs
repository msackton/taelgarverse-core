import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {ROOT} from '../src/config.mjs';
import {coreRelease,publication} from './helpers/page-cache-fixture.mjs';

test('Workers Cache API reuses raw snapshot parts across fresh handlers and R2 timeout recovery works',async t=>{
  const source=`import {createWorker} from './src/worker-handler.mjs';
    export default {async fetch(request,env,context){
      const reads=[],fail=new URL(request.url).searchParams.has('stall');
      const bucket={get(key){reads.push(key);return fail && key.endsWith('/runtime.json')?new Promise(()=>{}):env.CONTENT.get(key);}};
      const response=await createWorker(${JSON.stringify(coreRelease)},{cache:null,timeoutMs:100,cacheMs:1000,log(){}}).fetch(request,{CONTENT:bucket},context);
      const headers=new Headers(response.headers);headers.set('X-Test-R2-Reads',JSON.stringify(reads));
      return new Response(response.body,{status:response.status,headers});
    }};`;
  const bundle=await build({stdin:{contents:source,resolveDir:ROOT,sourcefile:'runtime-performance-worker.mjs'},
    bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],write:false,logLevel:'silent'});
  const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-19',
    compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:0,cf:false,cache:true,r2Buckets:{CONTENT:'runtime-performance-test'}}),telemetry:{enabled:false}});
  t.after(()=>mf.dispose());
  const r2=await mf.getR2Bucket('CONTENT'),first=publication();
  for(const [key,value] of first.objects)await r2.put(key,value);
  const firstPage=await mf.dispatchFetch('https://taelgar.org/api/page?page=Person');
  assert.equal(firstPage.status,200);assert.doesNotMatch((await firstPage.json()).html,/secret detail/);
  const next=await mf.dispatchFetch('https://frontier.taelgar.org/api/page?page=Person&dm=1');
  assert.equal(next.status,200);assert.match((await next.json()).html,/secret detail/);
  assert.deepEqual(JSON.parse(next.headers.get('X-Test-R2-Reads')),['published/current.json','revisions/'+first.pointer.revision+'/runtime.json']);
  const failed=await mf.dispatchFetch('https://taelgar.org/api/page?page=Person&stall=1');
  assert.equal(failed.status,503);assert.match((await failed.json()).detail,/too long/);
  const recovered=await mf.dispatchFetch('https://taelgar.org/api/page?page=Person');assert.equal(recovered.status,200);await recovered.text();
  const updated=publication({revision:'b'.repeat(64),text:'New generation.'});
  for(const [key,value] of updated.objects)await r2.put(key,value);
  const changed=await mf.dispatchFetch('https://taelgar.org/api/page?page=Person');
  assert.equal(changed.status,200);assert.match((await changed.json()).html,/New generation/);
});
