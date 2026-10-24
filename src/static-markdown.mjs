import {indexImageTarget} from './index-images.mjs';
// Static exports share the native query models and emit ordinary Markdown.
const link=item=>item?.path?'[['+item.path+'|'+item.name+']]':item?.name || '';
const parts=value=>(value || []).map(part=>typeof part==='string'?part:part.kind==='image'?'![['+(indexImageTarget(part.target) || '')+']]':part.kind?'':link(part)).join('');
const cell=value=>String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r?\n/g,'<br>').replace(/\|/g,'\\|');
export function indexMarkdown(result) {
  const headers=result.columns.map(column=>column.label),rows=result.items.map(item=>item.cells.map(parts));
  const table=['| '+headers.map(cell).join(' | ')+' |','| '+headers.map(()=>'---').join(' | ')+' |',
    ...rows.map(row=>'| '+row.map(cell).join(' | ')+' |')].join('\n');
  return (rows.length?table:'No '+result.label.toLowerCase()+' found for this date.')+
    (result.warnings.length?'\n\n'+result.warnings.map(w=>'> '+w).join('\n'):'');
}

export function interactionsMarkdown(groups) {
  return groups.map(({group,links})=>{
    const native=(url,label)=>links.has(url)?'[['+links.get(url)+'|'+label+']]':label || '';
    return '### '+group.label+'\n\n'+(group.known?'Known to party.\n\n':'')+
      (group.events.length?group.events.map(event=>'- '+(event.start?event.start+' DR — ':'')+
        native(event.sessionUrl || event.url,event.sessionLabel || event.title)+
        (event.text?' — '+event.text.replace(/\r?\n/g,' '):'')).join('\n'):'No recorded interactions.');
  }).join('\n\n');
}
