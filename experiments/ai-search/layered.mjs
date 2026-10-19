import {exactName,ftsQuery} from './baseline.mjs';
import {searchRequest,groupResults} from './runner.mjs';

export const LAYER_MODES=['baseline','enhanced'];
export function fusePages(baseline,semantic,batch,query){
  const pages=new Map();
  for(const [list,source] of [[baseline,'full-text'],[semantic,'semantic']])for(const [rank,page] of list.entries()){
    const previous=pages.get(page.page);
    pages.set(page.page,{...(previous || page),score:(previous?.score || 0)+1/(60+rank+1),provenance:[...(previous?.provenance || []),source]});
  }
  return [...pages.values()].sort((a,b)=>Number(exactName(b.page,batch,query))-Number(exactName(a.page,batch,query)) || b.score-a.score || a.page.localeCompare(b.page)).slice(0,5);
}

// Disabled requests never initialize AI Search. Provider errors, quota
// exhaustion and a bounded timeout all preserve the independent baseline.
export async function layeredQuery({baseline,aiSearch,aiEnabled=true},batch,view,query,
  {modes=LAYER_MODES,ai=true,aiTimeoutMs=5000,threshold=.4,rerank=false,keywordMatch='and'}={}){
  if(!Array.isArray(modes) || !modes.length || modes.length>2 || new Set(modes).size!==modes.length || modes.some(m=>!LAYER_MODES.includes(m)))throw new Error('Invalid layered search modes');
  if(typeof ai!=='boolean' || typeof rerank!=='boolean' || !Number.isInteger(aiTimeoutMs) || aiTimeoutMs<10 || aiTimeoutMs>30000)throw new Error('Invalid AI search settings');
  ftsQuery(query,keywordMatch);
  const request=searchRequest(batch,view,query,'vector',{threshold,rerank,keywordMatch});
  const started=performance.now(),wantsAI=modes.includes('enhanced') && ai && aiEnabled;
  const controller=new AbortController();let timer;
  const semantic=wantsAI ? Promise.race([
    Promise.resolve().then(()=>aiSearch(request,controller.signal)).then(raw=>({pages:groupResults(batch,view,raw,30)})),
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},aiTimeoutMs);})
  ]).catch(()=>({fallback:controller.signal.aborted?'timeout':'unavailable'})).finally(()=>clearTimeout(timer)) : Promise.resolve({fallback:'disabled'});
  let base;
  try{base=await baseline.search(batch,view,query,{keywordMatch});}catch(error){controller.abort();await semantic;throw error;}
  const extra=await semantic;
  const results=modes.map(mode=>mode==='baseline'?{...base,pages:base.pages.slice(0,5)}:{mode,latencyMs:Math.round(performance.now()-started),
    pages:extra.pages ? fusePages(base.pages,extra.pages,batch,query) : base.pages.slice(0,5),
    aiStatus:extra.fallback || 'used',usage:{aiRequests:wantsAI?1:0}});
  return {query,run:batch.run,view,at:new Date().toISOString(),settings:{threshold,rerank,keywordMatch,aiEnabled,aiRequested:ai,aiTimeoutMs},
    usage:{d1:base.usage,aiRequests:wantsAI?1:0},results};
}
