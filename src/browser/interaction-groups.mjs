const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const interactionKindLabel=kind=>kind==='session-reference' ? 'Session reference' : kind==='reference' ? 'Campaign reference' : 'Encounter';
export function interactionDateLabel(event) {
  if (!event.start) return (event.sessionLabel ? event.sessionLabel+' · ' : '')+'Date unrecorded';
  if (event.precision==='year') return event.start.slice(0,4);
  if (event.precision==='month') return months[Number(event.start.slice(5,7))-1]+' '+event.start.slice(0,4);
  return event.start===event.end ? event.start : event.start+'–'+event.end;
}
export function interactionParts(events) {
  const sessions=[],references=[];
  for(const event of events)(event.kind==='reference' ? references : sessions).push(event);
  references.sort((a,b)=>a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return {sessions,references};
}
