import {escapeHtml} from './common.mjs';
import {indexColumnHeading,indexTableColumns} from './index-columns.mjs';

const formattedParts=(parts,link)=>parts.map(part=>typeof part==='string' ? escapeHtml(part) : link(part)).join('');
const indexName=(item,link)=>item.person ? formattedParts(item.person,link) : link(item)+
  (item.pronunciation ? ' <span class="taelgar-index-pronunciation">('+escapeHtml(item.pronunciation)+')</span>' : '');

// Shared markup; hosts supply website URLs or native Obsidian links.
export function indexGrid(result,link,options={}) {
  const cards=result.items.map(item=>'<li class="taelgar-index-card">'+
    (item.image ? '<img class="taelgar-index-image" src="'+escapeHtml(item.image)+'" alt="'+escapeHtml(item.name)+'" width="440" height="180" loading="lazy" decoding="async">' : '')+
    indexName(item,link)+
    (item.info ? '<p>'+ (formattedParts(item.info,link) || '—')+'</p>' : item.type ? '<p>'+escapeHtml(item.type)+'</p>' : '')+
    (item.currentLocation ? '<p class="taelgar-index-detail">Current Location: '+(formattedParts(item.currentLocation,link) || 'Unknown')+'</p>' : '')+
    (item.home ? '<p class="taelgar-index-detail">Home: '+(formattedParts(item.home,link) || 'Unknown')+'</p>' : '')+'</li>').join('');
  return indexSection(result,cards ? '<ul class="taelgar-index-grid">'+cards+'</ul>' : '',true,options);
}

export function indexTable(result,link,options={}) {
  const columns=indexTableColumns(result.from,result.columns);
  const headings=columns.map(column=>result.columnHeadings?.[column]?.trim() ?? indexColumnHeading(result.from,column));
  const cell=(item,column)=>{
    if(column==='name')return indexName(item,link);
    const value=item[column];
    const missing=['region','currentLocation','home','origin'].includes(column) ? 'Unknown' : '—';
    if(Array.isArray(value))return formattedParts(value,link) || missing;
    if(column==='region' && value)return link(value);
    return escapeHtml(value || missing);
  };
  const rows=result.items.map(item=>'<tr>'+columns.map(column=>'<td>'+cell(item,column)+'</td>').join('')+'</tr>').join('');
  return indexSection(result,rows ? '<div class="taelgar-index-table-scroll"><table class="taelgar-index-table"><thead><tr>'+headings.map(heading=>'<th scope="col">'+escapeHtml(heading)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>' : '',false,options);
}

export function indexView(result,link,mode='grid',options={}) {
  return (mode==='table' ? indexTable : indexGrid)(result,link,options);
}

function indexSection(result,content,showCount=true,{heading=false}={}) {
  const noun = result.items.length === 1 ? result.from : result.label.toLowerCase();
  const empty = 'No '+result.label.toLowerCase()+' found for this date.';
  const headingText = typeof heading === 'string' ? heading.trim() : result.label;
  const label = result.target ? headingText+' — '+result.target : headingText;
  return '<section class="taelgar-index" aria-label="'+escapeHtml(label)+'">'+
    (heading ? '<h2>'+escapeHtml(headingText)+'</h2>' : '')+
    (showCount ? '<p class="taelgar-index-count">'+result.items.length+' '+noun+'</p>' : '')+
    (content || '<p>'+empty+'</p>')+
    result.warnings.map(message=>'<p class="taelgar-index-warning">'+escapeHtml(message)+'</p>').join('')+'</section>';
}

export const indexError = error => '<p class="taelgar-index-error" role="status">Index unavailable: '+escapeHtml(error.message)+'</p>';
