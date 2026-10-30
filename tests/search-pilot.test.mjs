import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {targetPath} from '../src/common.mjs';
import {Contexts} from '../src/contexts.mjs';
import {prepareCorpus,tokenizer,hash,OWNER,PILOT_INSTANCE} from '../experiments/ai-search/corpus.mjs';
import {PilotClient,owned,wranglerJSON} from '../experiments/ai-search/cloudflare.mjs';
import {validateBatch,reserve,syncBatch,searchRequest,groupResults,compareQuery} from '../experiments/ai-search/runner.mjs';
import {createPilotServer} from '../experiments/ai-search/cli.mjs';
import {reportHTML} from '../experiments/ai-search/viewer.mjs';

const registry={campaigns:{frontier:{code:'dufr',name:'Dunmari Frontier'},addermarch:{code:'adma',name:'Addermarch'}}};
function fixture(sources){
  const entries=Object.entries(sources).map(([id,source])=>({id,name:id.slice(0,-3),title:id.slice(0,-3),target:targetPath(id),slug:targetPath(id).slice(0,-3),note:parseNote(source),extension:'.md'}));
  const store=new ContentStore(entries), settings={default_date:'1750-01-01'};
  return {store,contexts:new Contexts(store,registry,settings)};
}
const configFor=notes=>({notes,limits:{notes:25,batchTokens:100000,totalTokens:1000000,queries:500},views:[
  {id:'public-all',date:'1750-01-01',campaigns:'all',dm:false},
  {id:'public-none',date:'1720-01-01',campaigns:'',dm:false},
  {id:'dm-all',date:'1750-01-01',campaigns:'all',dm:true}]});
function batchFor(sources,extra={}){
  const codec=tokenizer();try{return prepareCorpus({...fixture(sources),config:configFor(Object.keys(sources)),codec,...extra});}finally{codec.free();}
}
test('pilot exports only allowlisted prose with renderer visibility and no transitive embeds',()=>{
  const sources={'Host.md':'---\nheaderVersion: 1\ntags: [place]\naliases: [Alias]\n---\n> [!taelgar-header]\n> Generated header.\n\n# Authored\nPublic. ![[Child]]\n%% popup secret %%\n%%^Campaign:none%%DM block%%^End%%\n%%^Campaign:dufr%%Frontier body%%^End%%\n%%^Date:1740%%Future prose%%^End%%\n%%^Metadata:names:v1%%Admin hidden%%^End%%\n',
    'Child.md':'Child body must not expand.'};
  const codec=tokenizer();try{
    const data=prepareCorpus({...fixture(sources),config:configFor(['Host.md']),codec,views:['public-all','public-none','dm-all']});
    assert.equal(data.documents.length,3);
    const get=view=>data.documents.find(d=>d.view===view).text;
    assert.match(get('public-all'),/Public.*Child/s);assert.match(get('public-all'),/Frontier body/);assert.match(get('public-all'),/Future prose/);
    assert.doesNotMatch(get('public-all'),/Generated header|popup secret|DM block|Admin hidden|must not expand/);
    assert.doesNotMatch(get('public-none'),/Frontier body|Future prose|popup secret/);
    assert.match(get('dm-all'),/popup secret/);assert.match(get('dm-all'),/DM block/);assert.doesNotMatch(get('dm-all'),/Admin hidden/);
    assert.match(get('public-all'),/Aliases: Alias/);
    assert.match(data.documents.find(d=>d.view==='dm-all').url,/dm=1/);
  }finally{codec.free();}
});
test('pilot omits excluded/future/unsafe articles and refuses missing or oversized allowlists',()=>{
  const sources={'Visible.md':'Visible.','Hidden.md':'---\nexcludePublish: all\n---\nsecret',
    'Future.md':'---\ncreated: 1800-01-01\n---\nfuture', 'Broken.md':'This visible prefix must not escape %% broken private'};
  const batch=batchFor(sources);assert.equal(batch.documents.length,1);assert.equal(batch.warnings.length,1);
  assert.doesNotMatch(JSON.stringify(batch.documents),/visible prefix|private|secret|future/);
  const codec=tokenizer();try{
    const state=fixture(sources);
    assert.throws(()=>prepareCorpus({...state,config:configFor(['Missing.md']),codec}),/not in the website store/);
    const config=configFor(['Visible.md']);config.limits.batchTokens=1;
    assert.throws(()=>prepareCorpus({...state,config,codec}),/Batch token limit/);
    assert.throws(()=>prepareCorpus({...state,config:configFor(['Visible.md']),views:['unknown'],codec}),/Unknown pilot view/);
  }finally{codec.free();}
});
test('passages respect heading boundaries, Unicode, and token limits; source edits retain run/key identity',()=>{
  const text='## First\n\n'+('This is a paragraph about a magical castle. '.repeat(30))+'\n\n## Second\n\n'+('龍 🐉 castle '.repeat(200));
  const batch=batchFor({'Example.md':text},{style:'passages',chunkTokens:128});
  assert.ok(batch.documents.length>3);assert.ok(batch.documents.every(d=>d.tokens<=128));
  assert.ok(batch.documents.every(d=>!d.text.includes('\ufffd')));
  assert.ok(batch.documents.some(d=>d.heading==='First'));assert.ok(batch.documents.some(d=>d.heading==='Second'));
  assert.ok(batch.documents.every(d=>!d.text.includes('First') || !d.text.includes('Second')));
  const overlap=batchFor({'Example.md':text},{style:'passages',chunkTokens:128,overlapTokens:12});
  assert.ok(overlap.documents.every(d=>d.tokens<=128 && !d.text.includes('\ufffd')));
  assert.ok(overlap.tokens>batch.tokens);
  const a=batchFor({'Example.md':'One.'}), b=batchFor({'Example.md':'Two.'});
  assert.equal(a.run,b.run);assert.equal(a.documents[0].key,b.documents[0].key);assert.notEqual(a.digest,b.digest);
});
test('pending uploads resume without another upload or token reservation',async()=>{
  const batch=batchFor({'Example.md':'Body'}),doc=batch.documents[0],client=fakeClient();
  client.items.set('pending',{id:'pending',key:doc.key,metadata:doc.metadata,source_id:'builtin',status:'running'});
  client.item=async id=>({...client.items.get(id),status:'completed',chunks_count:1});
  const result=await syncBatch(client,batch,{reserveUsage:()=>assert.fail('Pending document must not reserve more tokens')});
  assert.equal(result.uploaded,0);assert.equal(result.resumed,1);assert.equal(result.tokens,0);
  client.items.get('pending').metadata=null;
  client.item=async id=>({...client.items.get(id),metadata:doc.metadata,status:'completed',chunks_count:1});
  const resumed=await syncBatch(client,batch,{previous:{digest:batch.digest,pending:[{key:doc.key,id:'pending'}]},reserveUsage:()=>assert.fail('Do not reserve again')});
  assert.equal(resumed.resumed,1);
  await assert.rejects(syncBatch(client,batch),/collides/);
});
test('batch integrity and cumulative budgets reject tampering and reserve failed attempts',()=>{
  const batch=batchFor({'Example.md':'Body'}),codec=tokenizer(),root=fs.mkdtempSync(path.join(os.tmpdir(),'search-pilot-'));
  try{
    validateBatch(batch,codec);const bad=structuredClone(batch);bad.documents[0].text+=' changed';assert.throws(()=>validateBatch(bad,codec),/integrity/);
    const limits={totalTokens:10,queries:2};reserve(root,'a'.repeat(32),limits,{tokens:7,queries:1});
    assert.throws(()=>reserve(root,'a'.repeat(32),limits,{tokens:4}),/budget exceeded/);
    assert.equal(reserve(root,'a'.repeat(32),limits,{queries:1}).tokens,7);
    assert.throws(()=>reserve(root,'a'.repeat(32),limits,{queries:1}),/budget exceeded/);
  }finally{codec.free();const resolved=path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep) && path.basename(resolved).startsWith('search-pilot-'));
    fs.rmSync(resolved,{recursive:true});}
});
function fakeClient(){
  const items=new Map(),calls=[];let id=0;
  return {items,calls,ensure:async()=>{},stats:async()=>({completed:items.size}),list:async()=>[...items.values()],
    upload:async doc=>{calls.push('upload:'+doc.key);const old=[...items.values()].find(i=>i.key===doc.key),item={id:old?.id || String(++id),key:doc.key,source_id:'builtin',metadata:doc.metadata,status:'completed',chunks_count:1};items.set(item.id,item);return item;},
    item:async id=>items.get(id),remove:async item=>{assert.ok(owned(item));calls.push('delete:'+item.key);items.delete(item.id);}};
}
test('incremental upload skips unchanged documents, deletes obsolete passages after indexing, and isolates runs',async()=>{
  const batch=batchFor({'One.md':'One','Two.md':'Two'}),client=fakeClient(),reserved=[];
  const first=await syncBatch(client,batch,{reserveUsage:a=>reserved.push(a)});assert.equal(first.uploaded,2);
  const again=await syncBatch(client,batch,{reserveUsage:a=>reserved.push(a)});assert.equal(again.uploaded,0);assert.equal(again.unchanged,2);assert.equal(reserved.length,2);
  const next=batchFor({'One.md':'Changed'});const other={id:'other',key:'tvpilot/other/file.txt',source_id:'builtin',metadata:{owner:OWNER,run:'other'},status:'completed'};client.items.set(other.id,other);
  const result=await syncBatch(client,next);assert.equal(result.uploaded,1);assert.equal(result.deleted,1);assert.ok(client.items.has('other'));
  assert.ok(client.calls.at(-1).startsWith('delete:'));
});
test('search prefilters run/view, forbids invalid input, groups pages, and fails closed on stale or foreign chunks',async()=>{
  const batch=batchFor({'Example.md':'Example content'}),doc=batch.documents[0];
  const body=searchRequest(batch,'public-all','Example','hybrid');
  assert.deepEqual(body.ai_search_options.retrieval.filters,{owner:OWNER,run:batch.run,view:'public-all'});
  assert.equal(body.ai_search_options.query_rewrite.enabled,false);assert.equal(body.ai_search_options.cache.enabled,false);
  const reranked=searchRequest(batch,'public-all','Example','hybrid',{rerank:true,threshold:.4});
  assert.equal(reranked.ai_search_options.retrieval.match_threshold,0);assert.equal(reranked.ai_search_options.reranking.match_threshold,.4);
  assert.throws(()=>searchRequest(batch,'public-all',' ','hybrid'),/Query must/);
  const chunk={text:'Example content',score:.7,item:{key:doc.key,metadata:doc.metadata}};
  assert.equal(groupResults(batch,'public-all',{chunks:[chunk,chunk]}).length,1);
  assert.throws(()=>groupResults(batch,'public-all',{chunks:[{...chunk,text:'Hidden old text'}]}),/stale excerpt/);
  assert.throws(()=>groupResults(batch,'public-all',{chunks:[{...chunk,item:{...chunk.item,metadata:{...doc.metadata,view:'dm-all'}}}]}),/out-of-view/);
  const reserves=[];let calls=0;
  const result=await compareQuery({search:async()=>{calls++;return {chunks:[chunk]};}},batch,'public-all','Example',{reserveUsage:x=>reserves.push(x)});
  assert.equal(result.results.length,3);assert.equal(calls,3);assert.deepEqual(reserves,[{queries:3}]);
});
test('REST client uses only the fixed pilot endpoint and never emits raw API errors or credentials',async()=>{
  const urls=[],client=new PilotClient({account:'a'.repeat(32),token:'secret-token',fetcher:async(url,options)=>{
    urls.push(url);assert.equal(options.headers.Authorization,'Bearer secret-token');return Response.json({result:{chunks:[]},success:true});}});
  await client.search({query:'test'});assert.ok(urls[0].endsWith('/'+PILOT_INSTANCE+'/search'));
  await assert.rejects(client.remove({id:'x',key:'production-note',source_id:'builtin',metadata:{owner:OWNER}}),/Refusing/);
  const bad=new PilotClient({account:'a'.repeat(32),token:'secret-token',fetcher:async()=>Response.json({success:false,errors:[{code:10000,message:'secret-token'}]},{status:403})});
  await assert.rejects(bad.info(),error=>error.message.includes('403') && !error.message.includes('secret-token'));
});
test('Wrangler credentials are captured with file logging disabled, including error paths',()=>{
  const result=wranglerJSON(['auth','token'],{WRANGLER_WRITE_LOGS:'true'},(_exe,args,options)=>{
    assert.deepEqual(args.slice(-3),['auth','token','--json']);
    assert.equal(options.env.WRANGLER_WRITE_LOGS,'false');assert.deepEqual(options.stdio,['ignore','pipe','pipe']);
    return JSON.stringify({type:'oauth',token:'fake-test-token'});
  });
  assert.equal(result.token,'fake-test-token');
  assert.throws(()=>wranglerJSON(['auth','token'],{},()=>{throw new Error('fake-test-token');}),error=>!error.message.includes('fake-test-token'));
});
test('comparison reports escape source text and local viewer rejects other origins',async()=>{
  const html=reportHTML([{query:'<script>bad</script>',run:'x',view:'public',results:[{mode:'hybrid',latencyMs:1,pages:[{url:'/page/x',title:'<img>',page:'x',excerpt:'<script>bad</script>',score:.5}]}]}]);
  assert.doesNotMatch(html,/<script>bad/);assert.match(html,/&lt;script&gt;/);
  let searches=0;const server=createPilotServer({loadBatches:()=>[],search:async()=>{searches++;return {};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await fetch(base+'/')).status,200);
    assert.equal((await fetch(base+'/api/search',{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal(searches,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('pilot corpus honors the site-wide POV opt-in',()=>{
  const codec=tokenizer();
  try {
    for (const respect_pov_dates of [false,true]) {
      const app=fixture({'Common.md':'Common reference.','Future POV.md':'---\nPOV: 1760s\n---\nFuture perspective.'});
      app.store.settings={respect_pov_dates};
      const result=prepareCorpus({...app,config:configFor(['Common.md','Future POV.md']),codec});
      assert.equal(result.documents.length,respect_pov_dates?1:2);
    }
  } finally {codec.free();}
});
