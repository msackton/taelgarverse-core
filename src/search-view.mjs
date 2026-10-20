import {escapeHtml,contextQuery} from './common.mjs';
import {searchTypes} from './search-types.mjs';

export function searchForm(query,context,type=''){
  const fields=[...contextQuery(context)].map(([key,value])=>'<input type="hidden" name="'+key+'" value="'+escapeHtml(value)+'">').join('');
  return '<form class="search-form" action="/" role="search" aria-label="Search Taelgar">'+fields+
    '<label for="search-query">Search Taelgar</label><div class="search-input-row"><input id="search-query" type="search" name="q" maxlength="256" value="'+escapeHtml(query)+'" placeholder="Names, phrases, or words from a note" aria-describedby="search-help"><button>Search</button></div>'+
    '<div class="search-filters"><label for="search-type">Content type</label><select id="search-type" name="type"><option value="">All content</option>'+
    searchTypes.map(([value,label])=>'<option value="'+value+'"'+(value===type?' selected':'')+'>'+label+'</option>').join('')+'</select></div>'+
    '<p id="search-help">Use quotes for an exact phrase. Other words match together, including word beginnings.</p></form>';
}
export const searchErrorView=(query,context,message,type='')=>'<section class="search-page"><h1>Search Taelgar</h1>'+searchForm(query.slice(0,256),context,type)+'<p class="search-notice" role="alert">'+escapeHtml(message)+'</p></section>';
function highlighted({excerpt,highlights}){
  let html='',position=0;
  for(const {start,end} of highlights){
    html+=escapeHtml(excerpt.slice(position,start))+'<mark>'+escapeHtml(excerpt.slice(start,end))+'</mark>';position=end;
  }
  return html+escapeHtml(excerpt.slice(position));
}
export function searchView(data){
  const {query,context,results,offset,limit,hasMore,type=''}=data;
  const url=next=>{const params=contextQuery(context);params.set('q',query);if(type)params.set('type',type);params.set('limit',String(limit));if(next)params.set('offset',String(next));return '/?'+params;};
  const previous=offset?'<a rel="prev" href="'+escapeHtml(url(Math.max(0,offset-limit)))+'">Previous</a>':'';
  const next=hasMore && offset+limit<=1000?'<a rel="next" href="'+escapeHtml(url(offset+limit))+'">Next</a>':'';
  return '<section class="search-page" aria-labelledby="search-title"><h1 id="search-title">'+(query?'Search results':'Browse pages')+'</h1>'+searchForm(query,context,type)+
    (data.notice?'<p class="search-notice" role="status">'+escapeHtml(data.notice)+'</p>':'')+
    '<p class="search-summary" role="status">'+(results.length?(offset+1)+'–'+(offset+results.length)+(query?' matching results.':' in the page index.'):'No matching pages.')+'</p>'+
    (results.length?'<ol class="search-results" start="'+(offset+1)+'">'+results.map(item=>'<li class="search-result"><h2><a href="'+escapeHtml(item.url)+'">'+escapeHtml(item.title)+'</a></h2>'+
      '<p class="search-path">'+escapeHtml(item.page.replaceAll('/',' / '))+'</p>'+(item.excerpt?'<p class="search-excerpt">'+highlighted(item)+'</p>':'')+'</li>').join('')+'</ol>':
      '<p>Try fewer words, another name, or a different context'+(type?' or content type':'')+'.</p>')+
    (previous || next?'<nav class="search-pagination" aria-label="Search result pages">'+previous+next+'</nav>':'')+'</section>';
}
