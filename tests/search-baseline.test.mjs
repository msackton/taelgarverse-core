import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'acorn';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {targetPath} from '../src/common.mjs';
import {Contexts} from '../src/contexts.mjs';
import {prepareCorpus,tokenizer,hash} from '../experiments/ai-search/corpus.mjs';
import {D1PilotClient,D1_DATABASE,ftsQuery} from '../experiments/ai-search/baseline.mjs';
import {layeredQuery,fusePages} from '../experiments/ai-search/layered.mjs';
import {viewerHTML,reportHTML} from '../experiments/ai-search/viewer.mjs';
import {createPilotServer} from '../experiments/ai-search/cli.mjs';
import {baselineUpdateProbe} from '../experiments/ai-search/baseline-probes.mjs';

// Node 22.12 needs --experimental-sqlite; newer supported Node releases expose
// the module by default. Other tests still run when it is unavailable.
const {DatabaseSync}=await import('node:sqlite').catch(()=>({}));
const sqliteTest=(name,fn)=>test(name,{skip:!DatabaseSync?'Enable node:sqlite with --experimental-sqlite on Node 22.12':false},fn);

function batchFor(sources){
  const entries=Object.entries(sources).map(([id,source])=>({id,name:id.slice(0,-3),title:id.slice(0,-3),target:targetPath(id),slug:targetPath(id).slice(0,-3),note:parseNote(source),extension:'.md'}));
  const store=new ContentStore(entries),settings={default_date:'1750-01-01'},contexts=new Contexts(store,{campaigns:{frontier:{code:'dufr',name:'Frontier'}}},settings);
  const codec=tokenizer();try{return prepareCorpus({store,contexts,codec,views:['public-all','public-none','dm-all'],config:{notes:Object.keys(sources),
    limits:{notes:25,batchTokens:100000,totalTokens:1000000,queries:500},views:[
      {id:'public-all',date:'1750-01-01',campaigns:'all',dm:false},{id:'public-none',date:'1720-01-01',campaigns:'',dm:false},{id:'dm-all',date:'1750-01-01',campaigns:'all',dm:true}]}});
  }finally{codec.free();}
}
function sqliteD1(){
  const db=new DatabaseSync(':memory:'),calls=[],usage=[],id='11111111-1111-4111-8111-111111111111';let fail=false;
  const client=new D1PilotClient({account:'a'.repeat(32),token:'test-secret',onUsage:row=>usage.push(row),fetcher:async(url,options)=>{
    calls.push({url,options});assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+'a'.repeat(32)+'/d1/database'));
    if(options.method==='GET')return Response.json({success:true,result:[{name:D1_DATABASE,uuid:id}]});
    const body=JSON.parse(options.body);
    if(!url.endsWith('/query'))return Response.json({success:true,result:{name:D1_DATABASE,uuid:id}});
    db.exec('BEGIN');
    try{
      const result=body.batch.map(({sql,params=[]})=>{
        if(fail && sql.startsWith('INSERT INTO tv_pilot_batches'))throw new Error('Injected transaction failure');
        const stmt=db.prepare(sql),read=/^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql.trim()),rows=read?stmt.all(...params):[];
        const write=read?0:Number(stmt.run(...params).changes);
        return {success:true,results:rows,meta:{rows_read:rows.length,rows_written:write,duration:1,size_after:4096}};
      });db.exec('COMMIT');return Response.json({success:true,result});
    }catch{db.exec('ROLLBACK');return Response.json({success:false,errors:[{code:7500,message:'test-secret SQL error'}]},{status:400});}
  }});
  return {db,client,calls,usage,failNextSync:()=>{fail=true;}};
}

sqliteTest('D1 uses real FTS5 ranking, quoted phrases, Unicode names, aliases, and scoped excerpts',async t=>{
  const {db,client}=sqliteD1();t.after(()=>db.close());
  const batch=batchFor({'Rhodar.md':'---\naliases: ["The Count"]\n---\nA vampire lord owns a castle.',
    'Other.md':'Rhodar Rhodar Rhodar lives near the castle.','Cha’mutte.md':'A deity.',
    'Gated.md':'Public prose.\n%%^Campaign:dufr%%campaignmarker\n%%^End%%\n%%^Date:1740%%datemarker\n%%^End%%\n%% dmhiddenmarker %%'});
  await client.sync(batch);
  assert.equal((await client.search(batch,'public-all','Rhodar')).pages[0].title,'Rhodar');
  assert.equal((await client.search(batch,'public-all','"The Count"')).pages[0].title,'Rhodar');
  assert.equal((await client.search(batch,'public-all',"Cha'mutte")).pages[0].title,'Cha’mutte');
  const body=await client.search(batch,'public-all','"vampire lord"');assert.equal(body.pages[0].title,'Rhodar');assert.match(body.pages[0].excerpt,/vampire lord/);
  for(const term of ['campaignmarker','datemarker']){
    assert.equal((await client.search(batch,'public-all',term)).pages.length,1);
    assert.equal((await client.search(batch,'public-none',term)).pages.length,0);
  }
  assert.equal((await client.search(batch,'public-all','dmhiddenmarker')).pages.length,0);
  assert.equal((await client.search(batch,'dm-all','dmhiddenmarker')).pages.length,1);
  assert.equal((await client.search(batch,'public-all','vampire absentword')).pages.length,0);
  assert.equal((await client.search(batch,'public-all','vampire absentword',{keywordMatch:'or'})).pages.length,1);
  assert.equal((await client.search(batch,'public-all','* : ()')).pages.length,0);
});

sqliteTest('D1 updates/deletes incrementally, rolls back failed syncs, and preserves other runs',async t=>{
  const {db,client,failNextSync}=sqliteD1();t.after(()=>db.close());
  const first=batchFor({'One.md':'oldmarker','Two.md':'deletemarker'});await client.sync(first);
  const copy=structuredClone(first);copy.run='article-'+hash('another run').slice(0,16);
  for(const d of copy.documents){d.key=d.key.replace(first.run,copy.run);d.metadata.run=copy.run;}
  copy.digest=hash(JSON.stringify(copy.documents.map(({key,sha256})=>({key,sha256}))));await client.sync(copy);
  const unchanged=await client.sync(first);assert.equal(unchanged.uploaded,0);assert.equal(unchanged.usage.rowsWritten,0);
  const next=batchFor({'One.md':'newmarker'}),changed=await client.sync(next);
  assert.equal(changed.uploaded,3);assert.equal(changed.deleted,3);
  assert.equal((await client.search(next,'public-all','newmarker')).pages.length,1);
  assert.equal((await client.search(next,'public-all','oldmarker')).pages.length,0);
  assert.equal((await client.search(next,'public-all','deletemarker')).pages.length,0);
  assert.equal((await client.search(copy,'public-all','oldmarker')).pages.length,1);
  await assert.rejects(client.search(first,'public-all','oldmarker'),/exact batch/);
  failNextSync();await assert.rejects(client.sync(first),error=>!error.message.includes('test-secret'));
  assert.equal((await client.search(next,'public-all','newmarker')).pages.length,1);
  await client.reset(next.run);
  assert.equal((await client.search(copy,'public-all','deletemarker')).pages.length,1);
  await assert.rejects(client.reset('anything'),/explicit pilot/);
});

sqliteTest('D1 refuses foreign schema and stale excerpts, and literals cannot execute SQL/FTS operators',async t=>{
  const foreign=sqliteD1();t.after(()=>foreign.db.close());foreign.db.exec('CREATE TABLE unrelated(secret TEXT)');
  await assert.rejects(foreign.client.ensure(),/nonempty/);assert.ok(foreign.db.prepare("SELECT name FROM sqlite_master WHERE name='unrelated'").get());
  assert.equal(ftsQuery('castle OR "vampire lord"'),'"castle" AND "or" AND "vampire lord"');
  assert.throws(()=>ftsQuery('"unclosed'),/Close/);assert.throws(()=>ftsQuery('x '.repeat(65)),/64/);
  const {db,client}=sqliteD1();t.after(()=>db.close());const batch=batchFor({'One.md':'safe body'});await client.sync(batch);
  assert.equal((await client.search(batch,'public-all',"'; DROP TABLE tv_pilot_docs; --")).pages.length,0);
  db.prepare('UPDATE tv_pilot_docs SET body=? WHERE view=?').run('unsafe old body','public-all');
  await assert.rejects(client.search(batch,'public-all','unsafe'),/stale or out-of-view/);
});

sqliteTest('repeatable D1 diagnostic probe verifies rollback and removes its own copies',async t=>{
  const {db,client}=sqliteD1();t.after(()=>db.close());const batch=batchFor({'One.md':'first body','Two.md':'second body'});
  await client.sync(batch);const codec=tokenizer();
  try{
    const result=await baselineUpdateProbe(client,batch,{codec});assert.equal(result.passed,true);assert.equal(result.atomicRollback,true);assert.equal(result.cleanedUp,true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tv_pilot_batches').get().count,1);
    assert.equal((await client.search(batch,'public-all','first')).pages.length,1);
  }finally{codec.free();}
});

test('baseline-only and both AI off switches make zero AI calls',async()=>{
  const batch=batchFor({'One.md':'safe body'}),page={page:batch.documents[0].page,title:'One',excerpt:'safe body',score:1};let calls=0;
  const baseline={search:async()=>({mode:'baseline',latencyMs:1,pages:[page],usage:{rowsRead:2}})},aiSearch=()=>{calls++;throw Error('Must not run');};
  for(const [service,settings] of [[{aiEnabled:false},{}],[{}, {ai:false}],[{}, {modes:['baseline']} ]]){
    const result=await layeredQuery({baseline,aiSearch,...service},batch,'public-all','One',settings);
    assert.equal(result.usage.aiRequests,0);assert.equal(result.results[0].pages[0].page,page.page);
  }
  assert.equal(calls,0);
});

test('AI failure, quota errors, stale results and a bounded timeout preserve full-text results',async()=>{
  const batch=batchFor({'One.md':'safe body'}),page={page:batch.documents[0].page,title:'One',excerpt:'safe body',score:1};
  const baseline={search:async()=>({mode:'baseline',latencyMs:1,pages:[page],usage:{rowsRead:2}})};
  for(const aiSearch of [async()=>{throw Error('quota or provider failure');},async()=>({chunks:[{text:'foreign secret'}]})]){
    const result=await layeredQuery({baseline,aiSearch},batch,'public-all','One');
    assert.equal(result.results[1].aiStatus,'unavailable');assert.deepEqual(result.results[1].pages,[page]);
    assert.doesNotMatch(JSON.stringify(result),/foreign secret|quota/);
  }
  let signal;const start=performance.now();
  const timed=await layeredQuery({baseline,aiSearch:(_body,s)=>{signal=s;return new Promise(()=>{});}},batch,'public-all','One',{aiTimeoutMs:15});
  assert.equal(timed.results[1].aiStatus,'timeout');assert.ok(signal.aborted);assert.ok(performance.now()-start<500);
  assert.deepEqual(timed.results[1].pages,[page]);
});

test('fusion deduplicates sources, preserves exact names and uses vector-only retrieval with scope filters',async()=>{
  const batch=batchFor({'One.md':'safe body','Other.md':'One safe body'}),doc=batch.documents.find(d=>d.title==='One');let requests=0;
  const page={page:doc.page,title:doc.title,url:doc.url,score:1,excerpt:'safe body'},other={page:'Other',title:'Other',score:1,excerpt:'safe body'};
  const fused=fusePages([page],[other,page],batch,'One');assert.equal(fused[0].page,doc.page);assert.deepEqual(fused[0].provenance,['full-text','semantic']);
  const result=await layeredQuery({baseline:{search:async()=>({mode:'baseline',latencyMs:1,pages:[page],usage:{rowsRead:1}})},aiSearch:async body=>{
    requests++;assert.equal(body.ai_search_options.retrieval.retrieval_type,'vector');assert.equal(body.ai_search_options.retrieval.filters.view,'public-all');
    return {chunks:[{text:'safe body',score:.8,item:{key:doc.key,metadata:doc.metadata}}]};
  }},batch,'public-all','One');
  assert.equal(requests,1);assert.equal(result.results[1].aiStatus,'used');assert.equal(result.results[1].pages.length,1);
});

test('viewer scripts parse, reports escape fallback/source text, and the server exposes only public settings',async t=>{
  parse(viewerHTML.match(/<script type="module">([\s\S]*)<\/script>/)[1],{ecmaVersion:'latest',sourceType:'module'});
  const html=reportHTML([{query:'<script>bad</script>',run:'run',view:'view',results:[{mode:'enhanced',aiStatus:'timeout',latencyMs:1,pages:[{url:'javascript:bad()',title:'<img>',page:'x',excerpt:'<script>bad</script>',score:1}]}]}]);
  assert.doesNotMatch(html,/<script>|javascript:/);assert.match(html,/AI timed out/);
  const server=createPilotServer({aiEnabled:false,loadBatches:()=>[],search:async()=>({})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.deepEqual(await (await fetch('http://127.0.0.1:'+server.address().port+'/api/settings')).json(),{aiEnabled:false});
});
