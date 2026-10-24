export const CALENDAR_REGISTRY='_scripts/session_note_campaigns.json';
export const drMonthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const drWeekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const weekdayAnchor={date:'1715-05-02',weekday:0,source:'Campaigns/Addermarch Campaign/Addermarch - Session 03.md',corroboration:'Campaigns/Dunmari Frontier Campaign/Session Notes/Session 95 (DuFr).md'};
const months=[31,28,31,30,31,30,31,31,30,31,30,31];
const modulo=(value,base)=>(value%base+base)%base;

// Engineering epoch: day 0 is DR 1-01-01. No creation-date or year-zero claim.
export function parseDRDate(value) {
  if(typeof value!=='string' && typeof value!=='number')throw new Error('Use a DR year, YYYY-MM, or YYYY-MM-DD date');
  const match=/^(\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(String(value).trim());
  if(!match)throw new Error('Invalid DR date: '+String(value));
  const year=Number(match[1]),month=Number(match[2]||1),day=Number(match[3]||1);
  if(year<1 || year>9999 || month<1 || month>12 || day<1 || day>months[month-1])throw new Error('Invalid DR date: '+String(value)+' (DR has no leap days)');
  const precision=match[3]?'day':match[2]?'month':'year';
  const start=(year-1)*365+months.slice(0,month-1).reduce((a,b)=>a+b,0)+day-1;
  const endExclusive=start+(precision==='year'?365:precision==='month'?months[month-1]:1);
  return {year,month,day,precision,original:value,start,endExclusive};
}

export function drDayDate(day) {
  const absolute=Math.floor(day),year=Math.floor(absolute/365)+1;
  let rest=absolute-(year-1)*365,month=0;
  while(month<11 && rest>=months[month])rest-=months[month++];
  return {year,month:month+1,day:rest+1};
}

export function calendarSourcePath(source) {
  const normalized=source.replaceAll('\\','/'),parts=normalized.split('/'),folders=parts.slice(0,-1);
  return !parts.some(part=>part.startsWith('.')) && !folders.some(part=>part.startsWith('_') || part.toLowerCase()==='worldbuilding') && parts.at(-1)!=='AGENTS.md' && !/^assets?\/dm(?:\/|$)/i.test(normalized);
}
export const drWeekday=day=>modulo(day-parseDRDate(weekdayAnchor.date).start+weekdayAnchor.weekday,7);
export const drDateString=day=>{const date=drDayDate(day);return String(date.year).padStart(4,'0')+'-'+String(date.month).padStart(2,'0')+'-'+String(date.day).padStart(2,'0');};

export function calendarMonth(year,month) {
  const period=parseDRDate(String(year)+'-'+String(month).padStart(2,'0'));
  const days=period.endExclusive-period.start,offset=drWeekday(period.start);
  return {year,month,start:period.start,endExclusive:period.endExclusive,days,offset,weeks:Math.ceil((offset+days)/7)};
}
