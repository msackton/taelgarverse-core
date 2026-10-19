import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {hash,MODES,OWNER,PILOT_INSTANCE} from './corpus.mjs';
import {owned} from './cloudflare.mjs';

export const writeJSON=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+process.pid;
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n');fs.renameSync(temp,file);};
export const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export function validateBatch(batch,codec){
  if(batch.version!==1 || batch.instance!==PILOT_INSTANCE || !/^(article|passages)-[a-f0-9]{16}$/.test(batch.run) ||
     !Array.isArray(batch.documents) || !batch.documents.length)throw new Error('Invalid pilot batch');
  const keys=new Set();let total=0;
  for(const doc of batch.documents){
    if(!doc.key?.startsWith('tvpilot/'+batch.run+'/'+doc.view+'/') || !/^[a-z0-9/.-]+\.txt$/.test(doc.key) || doc.key.length>128 ||
       keys.has(doc.key) || doc.metadata?.owner!==OWNER || doc.metadata.run!==batch.run || doc.metadata.view!==doc.view ||
       hash(doc.text)!==doc.sha256 || doc.metadata.sha256!==doc.sha256 || codec.count(doc.text)!==doc.tokens ||
       !batch.views.some(v=>v.id===doc.view))throw new Error('Pilot document failed integrity checks');
    keys.add(doc.key);total+=doc.tokens;
  }
  if(total!==batch.tokens || total>batch.limits.batchTokens || batch.digest!==hash(JSON.stringify(batch.documents.map(({key,sha256})=>({key,sha256}))))) {
    throw new Error('Pilot batch totals/digest do not match or exceed limits');
  }
  return batch;
}

// One ledger per account, retained even when a batch is reset. Reserve before
// remote work, including failed/unknown attempts. Concurrent CLI/server calls
// cannot spend past the configured allowance by racing the counter.
export function reserve(root,account,limits,{tokens=0,queries=0}={}){
  const directory=path.join(root,'usage'), file=path.join(directory,account+'.json'), lock=file+'.lock';
  fs.mkdirSync(directory,{recursive:true});let fd;
  try{
    fd=fs.openSync(lock,'wx');
    const usage=fs.existsSync(file)?readJSON(file):{tokens:0,queries:0};
    if([usage.tokens,usage.queries,tokens,queries].some(n=>!Number.isSafeInteger(n) || n<0))throw new Error('Invalid pilot usage ledger or reservation; inspect it before continuing');
    if(usage.tokens+tokens>limits.totalTokens || usage.queries+queries>limits.queries)throw new Error('Pilot cumulative budget exceeded; inspect usage before changing limits');
    const next={tokens:usage.tokens+tokens,queries:usage.queries+queries,updatedAt:new Date().toISOString()};
    writeJSON(file,next);return next;
  }finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}

export async function syncBatch(client,batch,{reserveUsage=()=>{},record=()=>{},log=()=>{},wait=delay,timeoutMs=600000,previous={}}={}){
  await client.ensure();
  const before=await client.stats(), items=await client.list(), byKey=new Map(items.map(item=>[item.key,item]));
  const desired=new Set(batch.documents.map(doc=>doc.key));
  const pending=[], report={run:batch.run,digest:batch.digest,uploaded:0,unchanged:0,resumed:0,deleted:0,tokens:0,indexedChunks:0,before,items:[]};
  for(const doc of batch.documents){
    let item=byKey.get(doc.key);
    const recorded=previous.digest===batch.digest && [...(previous.pending || []),...(previous.items || [])].some(p=>p.key===doc.key && p.id===item?.id);
    if(item && !owned(item) && !(item.metadata==null && recorded && item.source_id==='builtin'))throw new Error('An existing document collides with a pilot key');
    if(item?.metadata?.sha256===doc.sha256 && item.metadata.run===batch.run && item.metadata.view===doc.view && item.status==='completed'){
      report.unchanged++;pending.push({doc,item});continue;}
    if(item?.metadata?.sha256===doc.sha256 && item.metadata.run===batch.run && item.metadata.view===doc.view && ['queued','running'].includes(item.status)){
      report.resumed++;pending.push({doc,item});continue;}
    if(recorded && item && ['queued','running'].includes(item.status)){
      report.resumed++;pending.push({doc,item});continue;}
    reserveUsage({tokens:doc.tokens});report.tokens+=doc.tokens;
    item=await client.upload(doc);report.uploaded++;pending.push({doc,item});
    if(report.uploaded===1 || report.uploaded%10===0 || report.uploaded===batch.documents.length)log('Queued '+report.uploaded+' documents; latest: '+doc.source+' ['+doc.view+']');
    record({...report,pending:pending.map(p=>({key:p.doc.key,id:p.item.id}))});
  }
  const deadline=Date.now()+timeoutMs;
  let incomplete=[...pending],lastRemaining;
  while(incomplete.length){
    const next=[];
    for(const {doc,item} of incomplete){
      const current=await client.item(item.id);
      if(['error','skipped'].includes(current.status))throw new Error('Indexing failed for '+doc.key+' ('+current.status+')');
      if(current.status==='completed' && current.metadata?.sha256===doc.sha256){
        report.items.push({key:doc.key,id:current.id,status:current.status,chunks:current.chunks_count,sha256:doc.sha256});
        report.indexedChunks+=current.chunks_count || 0;
      }else next.push({doc,item:current});
    }
    incomplete=next;
    if(!incomplete.length)break;
    if(Date.now()>deadline)throw new Error('Indexing still pending for '+incomplete.length+' documents; rerun upload to resume');
    if(incomplete.length!==lastRemaining)log('Indexing: '+incomplete.length+' documents remain');
    lastRemaining=incomplete.length;await wait(5000);
  }
  // Remove obsolete passages only after replacements have completed indexing.
  for(const item of items)if(owned(item) && item.metadata.run===batch.run && !desired.has(item.key)){
    await client.remove(item);report.deleted++;
  }
  report.after=await client.stats();report.completedAt=new Date().toISOString();record(report);return report;
}

export function searchRequest(batch,view,query,mode,{rerank=false,threshold=0,keywordMatch='and'}={}){
  if(!batch.views.some(v=>v.id===view))throw new Error('Unknown view for this batch');
  if(typeof query!=='string' || !query.trim() || query.length>1000)throw new Error('Query must contain 1–1000 characters');
  if(!MODES.includes(mode) || !Number.isFinite(threshold) || threshold<0 || threshold>1 || !['and','or'].includes(keywordMatch))throw new Error('Invalid retrieval settings');
  return {query:query.trim(),ai_search_options:{
    retrieval:{retrieval_type:mode,max_num_results:30,match_threshold:rerank ? 0 : threshold,fusion_method:'rrf',keyword_match_mode:keywordMatch,
      context_expansion:0,return_on_failure:false,filters:{owner:OWNER,run:batch.run,view}},
    query_rewrite:{enabled:false},reranking:{enabled:rerank,match_threshold:threshold},cache:{enabled:false}}};
}
export function groupResults(batch,view,response,limit=5){
  if(!Array.isArray(response.chunks))throw new Error('Unexpected AI Search response: no chunks array');
  const docs=new Map(batch.documents.filter(d=>d.view===view).map(d=>[d.key,d])), pages=new Map();
  for(const chunk of response.chunks){
    const doc=docs.get(chunk.item?.key);
    // An unexpected result is a failed experiment, not a silently discarded leak.
    if(!doc || chunk.item.metadata?.run!==batch.run || chunk.item.metadata?.view!==view || chunk.item.metadata?.sha256!==doc.sha256){
      throw new Error('AI Search returned a stale or out-of-view document; results withheld');
    }
    const normalize=text=>String(text).replace(/\s+/g,' ').trim();
    if(!normalize(doc.text).includes(normalize(chunk.text ?? '')))throw new Error('AI Search returned stale excerpt text; results withheld');
    const result={page:doc.page,title:doc.title,url:doc.url,score:chunk.score,excerpt:String(chunk.text ?? ''),heading:doc.heading,scores:chunk.scoring_details};
    if(!pages.has(doc.page))pages.set(doc.page,result);
  }
  return [...pages.values()].slice(0,limit);
}
export async function compareQuery(client,batch,view,query,{modes=MODES,reserveUsage=()=>{},...settings}={}){
  const requests=modes.map(mode=>({mode,body:searchRequest(batch,view,query,mode,settings)}));
  reserveUsage({queries:requests.length});
  const results=[];
  for(const {mode,body} of requests){
    const start=performance.now(),response=await client.search(body);
    results.push({mode,latencyMs:Math.round(performance.now()-start),pages:groupResults(batch,view,response),raw:response});
  }
  return {query,run:batch.run,view,settings,at:new Date().toISOString(),results};
}
