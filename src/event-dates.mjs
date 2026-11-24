import {dateKey} from './common.mjs';
import {DateManager} from './header-core/dates.mjs';

const dates = new DateManager({});
const monthLengths = [31,28,31,30,31,30,31,31,30,31,30,31];
const monthOffsets = monthLengths.map((_,month)=>monthLengths.slice(0,month).reduce((sum,days)=>sum+days,0));

export function eventISO(key) {
  const value=String(key).padStart(8,'0');
  return value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6);
}

export function eventDate(value) {
  if(typeof value!=='number' && typeof value!=='string')return null;
  const text=String(value).trim();
  let start;
  try{start=dateKey(text,true);}catch{return null;}
  const [year,month,day]=text.split('-').map(Number);
  const end=day ? start : month ? start-1+monthLengths[month-1] : year*10000+1231;
  const label=day ? dates.normalizeDate(eventISO(start)).display : month ? dates.DR_MONTHS[month]+' '+year : 'DR '+year;
  return {start,end,label,precision:day?'day':month?'month':'year'};
}

export function eventDateRange(value,endValue,{uncertainStart=false,uncertainEnd=false}={}) {
  const split=typeof value==='string'?value.split(/\s+to\s+/i):[value];
  if(split.length>2 || split.length===2 && endValue!=null && endValue!=='')return null;
  const first=eventDate(split[0]);
  const last=split.length===2 ? eventDate(split[1]) : endValue!=null && endValue!=='' ? eventDate(endValue) : first;
  if(!first || !last || last.end<first.start)return null;
  const firstLabel=uncertainStart?'('+first.label+')':first.label;
  const lastLabel=uncertainEnd?'('+last.label+')':last.label;
  const label=first.label===last.label ? (uncertainStart || uncertainEnd?'('+first.label+')':first.label) : firstLabel+' - '+lastLabel;
  return {start:first.start,end:last.end,label,precision:first.precision};
}

export function eventWindow(value,endValue=value) {
  function bound(input,key) {
    if(typeof input==='number' && Number.isInteger(input) ||
      typeof input==='string' && /^\d{4}(?:-\d{2}-\d{2})?$/.test(input.trim())) {
      const result=eventDate(input);
      if(result)return result;
    }
    throw new Error(key+' must be a DR year or YYYY-MM-DD date.');
  }
  const start=bound(value,'yearStart').start,end=bound(endValue,'yearEnd').end;
  if(start>end)throw new Error('yearEnd must be on or after yearStart.');
  return {start,end};
}

const seasons={spring:90,summer:180,fall:270,autumn:270,winter:330};
const times={midnight:0,'just after midnight':.01,'pre-dawn':.04,predawn:.04,dawn:.08,'just after dawn':.09,
  morning:.2,'mid-morning':.3,midmorning:.3,midday:.5,noon:.5,'mid-day':.5,'just after noon':.51,
  afternoon:.65,'mid-afternoon':.7,midafternoon:.7,evening:.8,night:.9};

export function eventQualifier(text) {
  const value=text.trim().toLowerCase();
  const match=/^(early|mid|late) (.*)$/.exec(value);
  const base=match?.[2] ?? value;
  if(Object.hasOwn(seasons,base))return {season:seasons[base]+(match?.[1]==='early'?-20:match?.[1]==='late'?20:0)};
  if(Object.hasOwn(times,value))return {time:times[value]};
  if(match && ['morning','afternoon','evening','night'].includes(base))
    return {time:times[base]+(match[1]==='early'?-.02:match[1]==='late'?.02:0)};
  return null;
}

export function eventSort(key,precision,qualifier) {
  const year=Math.floor(key/10000),month=Math.floor(key%10000/100),day=key%100;
  const adjustment=precision==='year' ? qualifier?.season : precision==='day' ? qualifier?.time : 0;
  return year*365+monthOffsets[month-1]+day+(adjustment ?? 0);
}
