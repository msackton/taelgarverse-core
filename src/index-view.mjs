import {escapeHtml} from './common.mjs';

const formattedParts=(parts,link)=>parts.map(part=>typeof part==='string' ? escapeHtml(part) : link(part)).join('');
const indexName=(item,link)=>item.person ? formattedParts(item.person,link) : link(item)+
  (item.pronunciation ? ' <span class="taelgar-index-pronunciation">('+escapeHtml(item.pronunciation)+')</span>' : '');
const memberAttributes=(result,item)=>result.type==='members' ? ' data-index-member'+
  (item.deceased ? ' data-index-deceased'+(!result.includeHistorical ? ' hidden' : '') : '') : '';

// Shared markup; hosts supply website URLs or native Obsidian links.
export function indexGrid(result,link,options={}) {
  const members=result.type==='members';
  const cards=result.items.map(item=>'<li class="taelgar-index-card"'+memberAttributes(result,item)+'>'+
    (item.image ? '<img class="taelgar-index-image" src="'+escapeHtml(item.image)+'" alt="'+escapeHtml(item.name)+'" width="440" height="180" loading="lazy" decoding="async">' : '')+
    indexName(item,link)+
    (item.info ? '<p>'+ (formattedParts(item.info,link) || '—')+'</p>' : item.description ? '<p>'+escapeHtml(item.description)+'</p>' : '')+
    (members ? item.firstSentence ? '<p class="taelgar-index-detail">'+escapeHtml(item.firstSentence)+'</p>' : '' : item.lastKnown ? '<p class="taelgar-index-detail">Current Location: '+(formattedParts(item.lastKnown,link) || 'Unknown')+'</p>' : '')+
    (!members && item.home ? '<p class="taelgar-index-detail">Home: '+(formattedParts(item.home,link) || 'Unknown')+'</p>' : '')+
    (item.details ? '<p class="taelgar-index-detail">'+escapeHtml(item.details)+'</p>' : '')+'</li>').join('');
  return indexSection(result,cards ? '<ul class="taelgar-index-grid"'+(members ? ' data-index-results' : '')+'>'+cards+'</ul>' : '',true,options);
}

export function indexTable(result,link,options={}) {
  const settlements=result.type==='settlements',features=result.type==='rivers' || result.type==='places';
  const headings=settlements ? ['Place','Region','Type Of','Population'] : features ? [result.type==='rivers' ? 'River' : 'Place','Type Of'] : ['Person','Info','Current Location','Home'];
  const formatted=parts=>formattedParts(parts,link);
  const rows=result.items.map(item=>{
    const name=indexName(item,link);
    const cells=settlements ? [name,item.region ? link(item.region) : 'Unknown',escapeHtml(item.settlementType || '—'),escapeHtml(item.population || '—')] : features ? [name,escapeHtml(item.placeType || '—')] :
      [name,formatted(item.info) || '—',formatted(item.lastKnown) || 'Unknown',formatted(item.home) || 'Unknown'];
    return '<tr'+memberAttributes(result,item)+'>'+cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>';
  }).join('');
  return indexSection(result,rows ? '<div class="taelgar-index-table-scroll"'+(result.type==='members' ? ' data-index-results' : '')+'><table class="taelgar-index-table"><thead><tr>'+headings.map(heading=>'<th scope="col">'+heading+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>' : '',false,options);
}

export function indexView(result,link,mode='grid',options={}) {
  return (mode==='table' ? indexTable : indexGrid)(result,link,options);
}

function indexSection(result,content,showCount=true,{heading=false}={}) {
  const noun=result.items.length===1 ? result.label.toLowerCase().slice(0,-1) : result.label.toLowerCase();
  const toggle=result.type==='members' && result.showHistoricalToggle;
  const empty='<p class="taelgar-index-empty"'+(result.items.some(item=>!item.deceased || result.includeHistorical) ? ' hidden' : '')+'>No '+result.label.toLowerCase()+' found for this date.</p>';
  return '<section class="taelgar-index" aria-label="'+escapeHtml(result.label+' — '+result.target)+'">'+
    (heading ? '<h2>'+escapeHtml(result.label)+'</h2>' : '')+
    (toggle ? '<label class="taelgar-index-historical-control"><input type="checkbox" data-index-include-historical'+(result.includeHistorical ? ' checked' : '')+'> Include historical members</label>' : '')+
    (showCount && result.type!=='members' ? '<p class="taelgar-index-count">'+result.items.length+' '+noun+'</p>' : '')+
    (content || (!toggle ? empty : ''))+(toggle ? empty : '')+
    result.warnings.map(message=>'<p class="taelgar-index-warning">'+escapeHtml(message)+'</p>').join('')+'</section>';
}

export function indexPopupShell({type,label,target,url},content='') {
  return '<details class="taelgar-index-popup" data-index-type="'+escapeHtml(type || '')+'"'+
    (content ? '' : ' data-index-lazy')+(url ? ' data-index-url="'+escapeHtml(url)+'"' : '')+'><summary aria-haspopup="dialog">'+escapeHtml(label)+'</summary>'+
    '<div class="taelgar-index-panel"><div class="taelgar-index-heading"><h2>'+escapeHtml(label+' — '+target)+'</h2>'+
    '<button type="button" class="taelgar-index-close" aria-label="Close index" hidden>×</button></div><div class="taelgar-index-content">'+
    (content || (url ? '<noscript><a href="'+escapeHtml(url)+'">View '+escapeHtml(label)+'</a></noscript>' : ''))+'</div></div></details>';
}

export function indexPopup(result,link) {
  if (!result.items.length) return '';
  return '<details class="taelgar-index-popup"><summary aria-haspopup="dialog">'+escapeHtml(result.label)+(result.type==='members' ? '' : ' ('+result.items.length+')')+'</summary>'+
    '<div class="taelgar-index-panel"><div class="taelgar-index-heading"><h2>'+escapeHtml(result.label+' — '+result.target)+'</h2>'+
    '<button type="button" class="taelgar-index-close" aria-label="Close index" hidden>×</button></div>'+indexGrid(result,link)+'</div></details>';
}

export const indexError = error => '<p class="taelgar-index-error" role="status">Index unavailable: '+escapeHtml(error.message)+'</p>';
