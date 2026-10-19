import {hash} from './corpus.mjs';
import {syncBatch,searchRequest} from './runner.mjs';
const digest=batch=>{batch.tokens=batch.documents.reduce((n,d)=>n+d.tokens,0);batch.digest=hash(JSON.stringify(batch.documents.map(({key,sha256})=>({key,sha256}))));return batch;};
const setText=(doc,text,codec)=>{doc.text=text;doc.tokens=codec.count(text);doc.sha256=hash(text);doc.metadata.sha256=doc.sha256;};

// Synthetic markers are confined to exported copies in their own diagnostic run.
export async function updateProbe(client,original,{codec,reserveUsage,log=()=>{},record=()=>{},saveBatch=()=>{}}){
  const batch=structuredClone(original), run='article-'+hash('update-probe:'+original.run).slice(0,16);
  batch.run=run;batch.documents=batch.documents.filter(d=>d.view===batch.views[0].id).slice(0,2);
  if(batch.documents.length!==2)throw new Error('Update probe needs two exported documents');
  const oldMarker='pilotoldmarkerqzv',newMarker='pilotnewmarkerqzv',deleteMarker='pilotdeletemarkerqzv';
  batch.documents.forEach((d,i)=>{d.key=d.key.replace(original.run,run);d.metadata.run=run;setText(d,d.text+'\n\nPilot diagnostic marker: '+(i?deleteMarker:oldMarker),codec);});
  batch.sources=batch.sources.filter(s=>batch.documents.some(d=>d.source===s.id));
  digest(batch);saveBatch(batch);const first=await syncBatch(client,batch,{reserveUsage,log});
  const query=async(marker,expected)=>{
    const request=searchRequest(batch,batch.views[0].id,marker,'keyword');
    for(let attempt=0;attempt<12;attempt++){
      reserveUsage({queries:1});const response=await client.search(request);
      const present=response.chunks?.some(c=>String(c.text).includes(marker));
      if(present===expected)return {marker,expected,passed:true,attempts:attempt+1};
      if(attempt<11)await new Promise(resolve=>setTimeout(resolve,3000));
    }
    throw new Error('Update probe did not observe expected marker state: '+marker);
  };
  const checks=[await query(oldMarker,true),await query(deleteMarker,true)];
  setText(batch.documents[0],batch.documents[0].text.replace(oldMarker,newMarker),codec);batch.documents.pop();digest(batch);saveBatch(batch);
  const changed=await syncBatch(client,batch,{reserveUsage,log});
  checks.push(await query(newMarker,true),await query(oldMarker,false),await query(deleteMarker,false));
  const unchanged=await syncBatch(client,batch,{reserveUsage,log});
  if(changed.uploaded!==1 || changed.deleted!==1 || unchanged.uploaded!==0 || unchanged.unchanged!==1)throw new Error('Incremental update counts did not match expectations');
  for(const item of (await client.list()).filter(i=>i.metadata?.run===run))await client.remove(item);
  const report={type:'update-probe',run,first,changed,unchanged,checks,cleanedUp:true,completedAt:new Date().toISOString()};record(report);return report;
}

export function visibilityCases(batch){
  const cases=[
    {view:'public-all',source:'Rhodar von Glauer.md',term:'millstone',present:true},
    {view:'public-none',source:'Rhodar von Glauer.md',term:'millstone',present:false},
    {view:'before-fire',source:'Elemental Plane of Fire.md',term:'fireproof',present:false},
    {view:'after-fire',source:'Elemental Plane of Fire.md',term:'fireproof',present:true},
    {view:'before-door',source:'Twilight Promontory.md',term:'bottomless',present:false},
    {view:'public-all',source:'Twilight Promontory.md',term:'bottomless',present:true}
  ];
  // Select a real word unique to an authored DM comment. The sampled
  // Campaign:none tables contain unevaluated queries in this raw-vault export.
  const pub=batch.documents.find(d=>d.view==='public-all' && d.source.endsWith('/Ursk.md'));
  const dm=batch.documents.find(d=>d.view==='dm-all' && d.source===pub?.source);
  const publicWords=new Set(pub?.text.toLowerCase().match(/\b[a-z]{6,}\b/g) || []);
  const term=dm?.text.toLowerCase().match(/\b[a-z]{6,}\b/g)?.filter(word=>!publicWords.has(word) && !['behind','curtain','secret'].includes(word))
    .sort((a,b)=>b.length-a.length || a.localeCompare(b))[0];
  if(!term)throw new Error('No distinct DM term available for visibility probe');
  cases.push({view:'public-all',source:'Ursk.md',term,present:false},{view:'dm-all',source:'Ursk.md',term,present:true});
  return cases;
}
export async function visibilityProbe(client,batch,{reserveUsage,record=()=>{}}){
  const cases=visibilityCases(batch);
  const results=[];
  for(const c of cases){
    const doc=batch.documents.find(d=>d.view===c.view && d.source.endsWith(c.source));if(!doc)throw new Error('Missing visibility probe document');
    if(doc.text.toLowerCase().includes(c.term)!==c.present)throw new Error('Local visibility expectation does not match exported prose');
    const request=searchRequest(batch,c.view,c.term,'keyword');request.ai_search_options.retrieval.filters.sha256=doc.sha256;
    reserveUsage({queries:1});const response=await client.search(request);
    const passed=c.present ? response.chunks?.some(chunk=>chunk.item?.key===doc.key && chunk.text.toLowerCase().includes(c.term)) : response.chunks?.length===0;
    results.push({...c,passed:Boolean(passed)});
  }
  const report={type:'visibility-probe',run:batch.run,results,passed:results.every(r=>r.passed),completedAt:new Date().toISOString()};record(report);
  if(!report.passed)throw new Error('Live visibility probe failed; inspect the saved results');return report;
}
