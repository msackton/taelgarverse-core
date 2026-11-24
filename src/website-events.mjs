import {availableInContext} from './content-store.mjs';
import {escapeHtml,pageUrl} from './common.mjs';
import {eventColumns,parseEvents,queryEvents} from './events.mjs';
import {renderEventInline,wikiTarget} from './markdown.mjs';

const byId=(store,path)=>[...(store.canonical.get(path) || [])].find(entry=>entry.id===path);

export function renderEventBlock(source,env) {
  // Generated rows are absent from search and authored backlink compilation.
  if(!env.getEvents)return '';
  const error=message=>'<p class="taelgar-index-error">'+escapeHtml(message)+'</p>';
  try {
    const options=parseEvents(source);
    if(options.show==='obsidian')return '';
    const index=env.getEvents();
    if(index===undefined)return ''; // The request will render again after loading the artifact.
    if(index===null)return error('Timeline data is unavailable for this publication.');
    const byPath=path=>byId(env.store,path);
    const rows=queryEvents(index,env.headers,options,{sourcePath:env.entry.id,date:env.date,context:env.context,
      resolve:target=>byPath(target)?.id ?? byPath(target+'.md')?.id ?? wikiTarget(env,target).entry?.id,
      visible:path=>availableInContext(byPath(path),env.context)});
    const table=rows.length ? '<div class="taelgar-index-table-scroll"><table class="taelgar-index-table"><thead><tr>'+
      eventColumns.map(column=>'<th scope="col">'+column+'</th>').join('')+'</tr></thead><tbody>'+
      rows.map(row=>{
        const entry=byPath(row.path),text=renderEventInline(row.text,{...env,entry,pageLinks:undefined});
        return '<tr><td>'+escapeHtml(row.label)+'</td><td>'+text+'</td><td><a href="'+
          escapeHtml(pageUrl(entry.slug,env.date,env.context))+'">'+escapeHtml(row.file)+'</a></td></tr>';
      }).join('')+'</tbody></table></div>' : '<p><em>No events found.</em></p>';
    return '<section class="taelgar-index taelgar-events" aria-label="Events">'+(options.heading?'<h2>Events</h2>':'')+table+'</section>';
  } catch(error) {
    env.warnings.push(error.message);
    return '<p class="taelgar-index-error">Timeline unavailable: '+escapeHtml(error.message)+'</p>';
  }
}
