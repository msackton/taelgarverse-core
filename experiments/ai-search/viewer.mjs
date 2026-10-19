import {escapeHtml as esc} from '../../src/common.mjs';

const style=`body{font:16px/1.5 system-ui;margin:2rem;background:#f5f3ee;color:#252a28}main{max-width:1500px;margin:auto}input,select,button{font:inherit;padding:.6rem}select{max-width:100%}input[type=text]{min-width:22rem;flex:1}form{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center}button{cursor:pointer}.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}.column{background:white;border:1px solid #ccc;padding:1rem;border-radius:8px}.hit{border-top:1px solid #ddd;padding:.8rem 0}.excerpt{white-space:pre-wrap;font-size:.9rem;max-height:18rem;overflow:auto}.meta{color:#58635c;font-size:.85rem}a{color:#215846}pre{white-space:pre-wrap}#status{min-height:1.5em}@media(max-width:600px){body{margin:1rem}input[type=text]{min-width:0;width:100%}}`;
const labels={baseline:'D1 full-text',enhanced:'D1 + semantic',keyword:'AI Search: keyword',vector:'AI Search: vector',hybrid:'AI Search: hybrid'};
const statuses={used:'AI completed',disabled:'AI disabled — full-text results',timeout:'AI timed out — full-text results',unavailable:'AI unavailable — full-text results'};
const safeUrl=url=>/^https?:\/\//.test(url) || /^\/page\//.test(url) ? url : '#';
function columns(comparison){
  return '<div class="columns">'+comparison.results.map(r=>'<section class="column"><h3>'+esc(labels[r.mode] || r.mode)+'</h3><p class="meta">'+r.latencyMs+' ms'+
    (r.aiStatus?' · '+esc(statuses[r.aiStatus] || r.aiStatus):'')+(r.usage?.rowsRead!==undefined?' · '+r.usage.rowsRead+' D1 rows read':'')+'</p>'+(r.pages.length?'':'<p>No matches.</p>')+r.pages.map(p=>
    '<article class="hit"><a href="'+esc(safeUrl(p.url))+'">'+esc(p.title)+'</a><p class="meta">Score '+esc(p.score)+' · '+esc((p.provenance || []).join(' + '))+' · '+esc(p.page)+'</p><div class="excerpt">'+esc(p.excerpt)+'</div></article>').join('')+'</section>').join('')+'</div>';
}
export function reportHTML(comparisons){
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Search pilot comparison</title><style>'+style+'</style><main><h1>Search pilot comparison</h1><p>Independent full-text search with optional semantic retrieval. Excerpts are source text; scores across engines are not comparable.</p>'+comparisons.map(c=>'<section><h2>'+esc(c.query)+'</h2><p class="meta">'+esc(c.run)+' · '+esc(c.view)+(c.evaluation ? ' · expected-source hit@5: '+esc(JSON.stringify(c.evaluation)) : '')+'</p>'+columns(c)+'</section>').join('')+'</main></html>';
}
export const viewerHTML='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TaelgarVerse search pilot</title><style>'+style+`</style><main><h1>TaelgarVerse search pilot</h1><p>D1 full-text search works independently. Switch AI off to compare, or add semantic matches to the same results.</p>
<form id="search"><select id="batch" aria-label="Batch and view"></select><input id="query" type="text" maxlength="1000" required placeholder="Search the sample notes" aria-label="Search query">
<select id="mode" aria-label="Search engine"><option value="compare">Compare full-text and enhanced</option><option value="baseline">D1 full-text only</option><option value="enhanced">D1 + semantic</option><option value="ai-all">Original AI Search: compare three</option><option value="keyword">AI Search: keyword</option><option value="vector">AI Search: vector</option><option value="hybrid">AI Search: hybrid</option></select>
<label><input id="ai" type="checkbox" checked>Enable AI</label><select id="match" aria-label="Keyword matching"><option value="and">All words</option><option value="or">Any word</option></select>
<label>AI minimum score <input id="threshold" type="number" min="0" max="1" step="0.05" value="0.4" style="width:5rem"></label><label><input id="rerank" type="checkbox">AI reranking</label><button>Search</button></form>
<p id="availability" class="meta"></p><p id="status" role="status"></p><div id="results"></div><p class="meta">Local experiment only. Contexts are fixed exported views. Indexing is controlled separately by CLI commands. Query rewriting and generated answers are disabled.</p></main>
<script type="module">
const el=id=>document.getElementById(id),labels=${JSON.stringify(labels)},statuses=${JSON.stringify(statuses)};let batches=[],aiAllowed=true;
function controls(){
  const enabled=aiAllowed && el('ai').checked,raw=['ai-all','keyword','vector','hybrid'];
  for(const option of el('mode').options)if(raw.includes(option.value))option.disabled=!enabled;
  if(!enabled && raw.includes(el('mode').value))el('mode').value='compare';
  el('threshold').disabled=!enabled;el('rerank').disabled=!enabled;
  const selected=el('batch').value?JSON.parse(el('batch').value):[],b=batches.find(b=>b.run===selected[0]);
  el('availability').textContent=(aiAllowed?'AI can be switched off per search. ':'AI disabled by the server. ')+(b?'This batch: D1 '+(b.baseline?'ready':'not synced')+'; AI '+(b.ai?'indexed':'not indexed (full-text fallback)')+'.':'');
}
try{
  const [batchResponse,settingsResponse]=await Promise.all([fetch('/api/batches'),fetch('/api/settings')]);
  if(!batchResponse.ok || !settingsResponse.ok)throw Error();batches=await batchResponse.json();aiAllowed=(await settingsResponse.json()).aiEnabled;
  el('ai').checked=aiAllowed;el('ai').disabled=!aiAllowed;
  for(const b of batches)for(const v of b.views){const o=document.createElement('option');o.value=JSON.stringify([b.run,v.id]);o.textContent=b.experiment+' ('+b.notes+' notes) · '+(b.style==='article'?'Whole notes':b.chunkTokens+'-token passages')+' · '+v.label;el('batch').append(o);}
  if(!batches.length)el('status').textContent='Prepare and baseline-upload a batch first.';controls();
}catch{el('status').textContent='Could not load pilot batches.';}
el('ai').addEventListener('change',controls);el('batch').addEventListener('change',controls);
el('search').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;el('status').textContent='Searching…';el('results').replaceChildren();
  try{
    const [run,view]=JSON.parse(el('batch').value),mode=el('mode').value;
    const modes=mode==='compare'?['baseline','enhanced']:mode==='ai-all'?['keyword','vector','hybrid']:[mode];
    const response=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run,view,query:el('query').value,modes,ai:el('ai').checked,keywordMatch:el('match').value,rerank:el('rerank').checked,threshold:Number(el('threshold').value)})});
    const data=await response.json();if(!response.ok)throw Error(data.detail);
    const grid=document.createElement('div');grid.className='columns';
    for(const result of data.results){
      const col=document.createElement('section');col.className='column';const h=document.createElement('h2');h.textContent=labels[result.mode] || result.mode;col.append(h);
      const timing=document.createElement('p');timing.className='meta';timing.textContent=result.latencyMs+' ms'+(result.aiStatus?' · '+statuses[result.aiStatus]:'')+(result.usage?.rowsRead!==undefined?' · '+result.usage.rowsRead+' D1 rows read':'');col.append(timing);
      if(!result.pages.length){const empty=document.createElement('p');empty.textContent='No matches.';col.append(empty);}
      for(const page of result.pages){
        const article=document.createElement('article');article.className='hit';const title=document.createElement('a');title.href=/^https?:\\/\\//.test(page.url) || /^\\/page\\//.test(page.url)?page.url:'#';title.textContent=page.title;
        const meta=document.createElement('p');meta.className='meta';meta.textContent='Score '+Number(page.score).toPrecision(4)+' · '+(page.provenance || []).join(' + ')+' · '+page.page;
        const excerpt=document.createElement('div');excerpt.className='excerpt';excerpt.textContent=page.excerpt;article.append(title,meta,excerpt);col.append(article);
      }
      grid.append(col);
    }
    el('results').append(grid);const usage=data.usage;
    el('status').textContent=usage?'Completed · '+usage.d1.rowsRead+' D1 rows read · '+usage.aiRequests+' optional AI attempts.':'Completed original AI comparison ('+data.results.length+' requests).';
  }catch(error){el('status').textContent=error.message;}finally{button.disabled=false;}
});
</script></html>`;
