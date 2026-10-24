import {Contexts} from './contexts.mjs';
import {calendarSourcePath} from './campaign-calendar.mjs';

// Both adapters use Contexts, including its latest-session ranking and exclusions.
export function calendarContext(notes,registry,selected='modern',customDate) {
  notes=notes.filter(note=>calendarSourcePath(note.path));
  const entries=notes.map(note=>({id:note.path,slug:note.path,note:{metadata:note.metadata}}));
  const store={entries,bySlug:new Map(entries.map(entry=>[entry.slug,entry]))};
  const contexts=new Contexts(store,registry,{default_date:'1750-01-01'});
  if(selected!=='modern' && !contexts.byId.has(selected)) {
    const code=contexts.campaignIdentities.get(String(selected).trim().toLowerCase());
    selected=contexts.list().find(context=>context.kind==='campaign' && context.campaigns[0]===code)?.id??selected;
  }
  let context,error;
  try{
    context=contexts.resolve(selected,selected==='custom'?customDate:undefined);
    if(context.kind==='custom')context.dateSource='custom-setting';
  }catch(cause){error=cause.message;}
  return {notes,registry,contexts,context,error};
}
