import {escapeHtml} from './common.mjs';
import {cardPositions} from './index-columns.mjs';
const image=part=>part.src?'<img class="taelgar-index-image" src="'+escapeHtml(part.src)+'" alt="'+escapeHtml(part.name || '')+'" loading="lazy" decoding="async">':'';
const formattedParts=(parts,link)=>parts.map(part=>typeof part==='string'?escapeHtml(part):part.kind==='image'?image(part):part.kind? '':link(part)).join('');
function gridContent(result,link) {
  return result.items.length?'<ul class="taelgar-index-grid">'+result.items.map(item=>'<li class="taelgar-index-card">'+
    (result.cards.image && item.image?image({src:item.image,name:item.name}):'')+
    cardPositions.map(position=>{
      const content=item.card[position].map(parts=>formattedParts(parts,link)).filter(Boolean).map(text=>'<p>'+text+'</p>').join('');
      return content?'<div class="taelgar-index-card-'+position+'">'+content+'</div>':'';
    }).join('')+'</li>').join('')+'</ul>':'';
}
function tableContent(result,link) {
  return result.items.length?'<div class="taelgar-index-table-scroll"><table class="taelgar-index-table"><thead><tr>'+
    result.columns.map(column=>'<th scope="col">'+escapeHtml(column.label)+'</th>').join('')+'</tr></thead><tbody>'+
    result.items.map(item=>'<tr>'+item.cells.map(parts=>'<td>'+formattedParts(parts,link)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'';
}
function section(result,content,{heading=false,count=false}={}) {
  return '<section class="taelgar-index" aria-label="'+escapeHtml(result.label+(result.target?' — '+result.target:''))+'">'+
    (heading?'<h2>'+escapeHtml(result.label)+'</h2>':'')+
    (count?'<p class="taelgar-index-count">'+result.items.length+' '+escapeHtml(result.label.toLowerCase())+'</p>':'')+
    (content || '<p>No '+escapeHtml(result.label.toLowerCase())+' found for this date.</p>')+
    result.warnings.map(message=>'<p class="taelgar-index-warning">'+escapeHtml(message)+'</p>').join('')+'</section>';
}
export const indexGrid=(result,link,options={})=>section(result,gridContent(result,link),{count:result.cards.count,...options});
export const indexTable=(result,link,options={})=>section(result,tableContent(result,link),options);
export const indexView=(result,link,mode=result.options?.mode || 'grid',options={})=>(mode==='table'?indexTable:indexGrid)(result,link,options);
export function indexPopupShell({index,label,target,url},content='') {
  return '<details class="taelgar-index-popup" data-index="'+escapeHtml(index || '')+'"'+
    (content?'':' data-index-lazy')+(url?' data-index-url="'+escapeHtml(url)+'"':'')+'><summary aria-haspopup="dialog">'+escapeHtml(label)+'</summary>'+
    '<div class="taelgar-index-panel"><div class="taelgar-index-heading"><h2>'+escapeHtml(label+(target?' — '+target:''))+'</h2>'+
    '<button type="button" class="taelgar-index-close" aria-label="Close index" hidden>×</button></div><div class="taelgar-index-content">'+
    (content || (url?'<noscript><a href="'+escapeHtml(url)+'">View '+escapeHtml(label)+'</a></noscript>':''))+'</div></div></details>';
}
export const indexPopup=(result,link)=>indexPopupShell(result,indexView(result,link));
export const indexError=error=>'<p class="taelgar-index-error" role="status">Index unavailable: '+escapeHtml(error.message)+'</p>';
