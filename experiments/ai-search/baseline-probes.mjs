import {hash} from './corpus.mjs';
import {visibilityCases} from './probes.mjs';

export async function baselineVisibilityProbe(client,batch){
  const results=[];
  for(const c of visibilityCases(batch)){
    const doc=batch.documents.find(d=>d.view===c.view && d.source.endsWith(c.source));
    if(!doc || doc.text.toLowerCase().includes(c.term)!==c.present)throw new Error('Visibility expectation does not match exported prose');
    const result=await client.search(batch,c.view,c.term);
    const present=result.pages.some(p=>p.page===doc.page && p.excerpt.toLowerCase().includes(c.term));
    results.push({...c,passed:present===c.present,usage:result.usage});
  }
  return {type:'baseline-visibility',run:batch.run,passed:results.every(r=>r.passed),results,completedAt:new Date().toISOString()};
}
export async function baselineUpdateProbe(client,original,{codec,saveBatch=()=>{}}){
  const batch=structuredClone(original),run='article-'+hash('baseline-update-probe:'+original.run).slice(0,16);
  batch.run=run;batch.documents=batch.documents.filter(d=>d.view===batch.views[0].id).slice(0,2);
  if(batch.documents.length!==2)throw new Error('Update probe needs two exported documents');
  const setText=(doc,text)=>{doc.text=text;doc.sha256=hash(text);doc.metadata.sha256=doc.sha256;doc.tokens=codec.count(text);};
  const digest=()=>{batch.tokens=batch.documents.reduce((n,d)=>n+d.tokens,0);batch.digest=hash(JSON.stringify(batch.documents.map(({key,sha256})=>({key,sha256}))));saveBatch(batch);};
  const old='baselineoldmarkerqzv',next='baselinenewmarkerqzv',removed='baselinedeletemarkerqzv';
  batch.documents.forEach((d,i)=>{d.key=d.key.replace(original.run,run);d.metadata.run=run;setText(d,d.text+'\n\n'+(i?removed:old));});
  const checks=[];
  const check=async(term,present)=>{const result=await client.search(batch,batch.views[0].id,term);checks.push({term,present,passed:result.pages.some(p=>p.excerpt.includes(term))===present});};
  try{
    digest();const first=await client.sync(batch);
    let rejected=false;
    try{await client.query([{sql:'UPDATE tv_pilot_batches SET digest=? WHERE run=?',params:['atomic-probe',run]},
      {sql:'SELECT * FROM tv_pilot_deliberately_missing_table'}]);}catch(error){if(error.status!==400)throw error;rejected=true;}
    if(!rejected)throw new Error('Expected diagnostic transaction to fail');
    // A successful search also proves the failed transaction did not change
    // the active digest. This checks REST batch rollback on the real service.
    await check(old,true);await check(removed,true);
    setText(batch.documents[0],batch.documents[0].text.replace(old,next));batch.documents.pop();digest();
    const changed=await client.sync(batch);await check(next,true);await check(old,false);await check(removed,false);
    const unchanged=await client.sync(batch);
    const passed=checks.every(c=>c.passed) && changed.uploaded===1 && changed.deleted===1 && unchanged.uploaded===0 && unchanged.usage.rowsWritten===0;
    return {type:'baseline-updates',run,passed,atomicRollback:true,first,changed,unchanged,checks,cleanedUp:true,completedAt:new Date().toISOString()};
  }finally{await client.reset(run);}
}
