const daysBeforeMonth=[0,31,59,90,120,151,181,212,243,273,304,334];
// Taelgar has no leap days. Do not use the browser's Gregorian Date arithmetic
// or assign Earth weekdays to DR dates.
export function interactionDay(date) {
  const [year,month,day]=date.split('-').map(Number);
  return (year-1)*365+daysBeforeMonth[month-1]+day-1;
}
function fromDay(ordinal) {
  const year=Math.floor(ordinal/365)+1,day=ordinal%365;
  let month=11;while(daysBeforeMonth[month]>day)month--;
  return String(year).padStart(4,'0')+'-'+String(month+1).padStart(2,'0')+'-'+String(day-daysBeforeMonth[month]+1).padStart(2,'0');
}
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function interactionDateLabel(event) {
  if (!event.start) return (event.sessionLabel ? event.sessionLabel+' · ' : '')+'Date unrecorded';
  if (event.precision==='year') return event.start.slice(0,4);
  if (event.precision==='month') return months[Number(event.start.slice(5,7))-1]+' '+event.start.slice(0,4);
  return event.start===event.end ? event.start : event.start+'–'+event.end;
}
export function interactionParts(events) {
  const beats=[],references=[];
  for(const event of events)(event.kind==='reference' ? references : beats).push(event);
  references.sort((a,b)=>a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return {beats,references};
}
export function groupInteractions(events,mode='auto') {
  if(mode==='auto')mode=events.length<=6 ? 'event' : 'session';
  if(mode==='event')return events.map(event=>({key:event.id,title:event.title,dateLabel:interactionDateLabel(event),events:[event]}));
  const origin=Math.min(...events.filter(event=>event.start).map(event=>interactionDay(event.start))),buckets=new Map();
  for(const event of events){
    let key,title;
    if(mode==='session') {key=event.session || 'authored:'+event.id;title=event.sessionLabel || event.title;}
    else if(!event.start){key='undated:'+(event.session || 'unknown');title=interactionDateLabel(event);}
    else if(mode==='day' && event.start===event.end){key=event.start;title=event.start;}
    else if(mode==='week' && Math.floor((interactionDay(event.start)-origin)/7)===Math.floor((interactionDay(event.end)-origin)/7)){
      const start=origin+Math.floor((interactionDay(event.start)-origin)/7)*7;key='week:'+start;title=fromDay(start)+'–'+fromDay(start+6);
    } else {key='range:'+event.start+':'+event.end;title=interactionDateLabel(event);}
    if(!buckets.has(key))buckets.set(key,{key,title,events:[]});buckets.get(key).events.push(event);
  }
  return [...buckets.values()].map(group=>({...group,dateLabel:group.events.length+' '+(group.events.length===1?'entry':'entries')}));
}
