import {dateKey} from './common.mjs';
import {drMonthNames,parseDRDate} from './campaign-calendar.mjs';

const list = value => Array.isArray(value) ? value : value == null ? [] : [value];
const emptyValues = new Set(['','unknown','none','undated','null','—','n/a']);
const isoDate=/^(\d{4})(?:-(\d\d)(?:-(\d\d))?)?$/;

function numericDate(text,calendar) {
  const match=isoDate.exec(text);
  if (!match) return null;
  const [,year,month,day]=match;
  if (calendar==='dr') {
    try { dateKey(text,true); } catch { return null; }
  } else {
    const iso=[year,month || '01',day || '01'].join('-');
    const parsed=new Date(iso);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10)!==iso) return null;
  }
  const last=month ? calendar==='dr' ? [31,28,31,30,31,30,31,31,30,31,30,31][Number(month)-1] :
    new Date(Date.UTC(2000+Number(year)%400,Number(month),0)).getUTCDate() : 31;
  return {
    start:[year,month || '01',day || '01'].join('-'),
    end:[year,month || '12',day || String(last)].join('-'),
  };
}

function makeDate(value,calendar,source) {
  if (value && typeof value==='object') {
    const evidence=[...list(value.evidence),...list(source)];
    if (value.alternatives) {
      const alternatives=list(value.alternatives).map(item=>makeDate(item,calendar,source)).filter(Boolean);
      return {alternatives,qualifier:value.qualifier,evidence};
    }
    if (value.from && value.through) {
      const from=numericDate(value.from,calendar),through=numericDate(value.through,calendar);
      if (!from || !through || from.start>through.end) throw new Error('Invalid '+calendar+' date window '+value.from+' to '+value.through+'.');
      return {text:value.from+' to '+value.through, start:from.start,end:through.end,
        window:{from:value.from,through:value.through},qualifier:value.qualifier || 'window',evidence};
    }
    const item=makeDate(value.on ?? value.label,calendar,null);
    return item && {...item,qualifier:value.qualifier,evidence};
  }
  const text=String(value ?? '').trim();
  if (emptyValues.has(text.toLowerCase())) return null;
  return {text,...numericDate(text,calendar),evidence:list(source)};
}

export function campaignDates(value,calendar,source) {
  return list(value).map(item=>makeDate(item,calendar,source)).filter(Boolean);
}

const dateIdentity=item=>JSON.stringify([item.text,item.qualifier,item.alternatives?.map(dateIdentity)]);
export function mergeCampaignDates(groups, overrides) {
  const byDate=new Map();
  for (const item of groups.flat()) {
    const key=dateIdentity(item),previous=byDate.get(key);
    byDate.set(key,previous ? {...previous,evidence:[...new Set([...previous.evidence,...item.evidence])]} : item);
  }
  const candidates=[...byDate.values()];
  if (overrides !== undefined) {
    const conflicts=candidates.filter(item=>!overrides.some(override=>dateIdentity(override)===dateIdentity(item)));
    return {dates:overrides,conflicts};
  }
  return {dates:candidates.length>1 ? [{alternatives:candidates,evidence:[]}] : candidates,conflicts:[]};
}

export function dateSpan(rows,startField,endField=startField) {
  const dated=item=>item.start && item.end;
  const starts=rows.flatMap(row=>row[startField].length ? row[startField] : row[endField]).filter(dated);
  const ends=rows.flatMap(row=>row[endField].length ? row[endField] : row[startField]).filter(dated);
  const first=starts.sort((a,b)=>a.start.localeCompare(b.start))[0];
  const last=ends.sort((a,b)=>b.end.localeCompare(a.end))[0];
  return first || last ? {first,last} : null;
}

function displayDateParts(text,calendar) {
  if(!numericDate(text,calendar)) return null;
  const [,year,month,day]=isoDate.exec(text);
  return {year,month:month && drMonthNames[Number(month)-1].slice(0,3),day:day && Number(day)};
}

function dateLabel({year,month,day}) {
  if(!month) return year;
  return day ? `${month} ${day}, ${year}` : `${month} ${year}`;
}

function duration(from,through,calendar) {
  const ordinal=date=>calendar==='dr' ? parseDRDate(date).start : Date.parse(date)/86_400_000;
  const startYear=Number(from.slice(0,4)),endYear=Number(through.slice(0,4)),monthDay=from.slice(4);
  const anniversary=year=>{
    const prefix=String(year).padStart(4,'0');
    const date=prefix+monthDay;
    return monthDay==='-02-29' && !numericDate(date,calendar) ? prefix+'-02-28' : date;
  };
  let years=endYear-startYear;
  if(anniversary(endYear)>through) years--;
  const days=ordinal(through)-ordinal(anniversary(startYear+years));
  const yearLabel=years===1 ? '1 year' : `${years} years`;
  const dayLabel=days===1 ? '1 day' : `${days} days`;
  return years ? [yearLabel,days ? dayLabel : ''].filter(Boolean).join(', ') : dayLabel;
}

function displayDateText(value,calendar) {
  const parts=displayDateParts(value,calendar);
  return parts ? dateLabel(parts)+(calendar==='dr' ? ' DR' : '') : value;
}

function displayRange(from,through,calendar,includeDuration) {
  if(from===through) return displayDateText(from,calendar);
  const first=displayDateParts(from,calendar),last=displayDateParts(through,calendar);
  if(!first?.day || !last?.day || from>through)
    return displayDateText(from,calendar)+' – '+displayDateText(through,calendar);
  const end=dateLabel(last)+(calendar==='dr' ? ' DR' : '');
  const span=first.year!==last.year ? dateLabel(first)+' – '+end :
    first.month!==last.month ? `${first.month} ${first.day} – ${end}` :
      `${first.month} ${first.day}–${last.day}, ${last.year}`+(calendar==='dr' ? ' DR' : '');
  return includeDuration ? span+' ('+duration(from,through,calendar)+')' : span;
}

export function formatCampaignDate(item,calendar,options={}) {
  if(!item) return '';
  const label=item.alternatives ? item.alternatives.map(date=>formatCampaignDate(date,calendar,options)).join(' or ') :
    item.window ? displayRange(item.window.from,item.window.through,calendar,options.includeDuration) : displayDateText(item.text,calendar);
  return item.qualifier ? label+' · '+item.qualifier : label;
}

export function formatCampaignDates(start,calendar,end=[],options={}) {
  if(start.length===1 && end.length===1 && [...start,...end].every(item=>item.text && !item.qualifier && !item.window))
    return displayRange(start[0].text,end[0].text,calendar,options.includeDuration);
  const from=start.map(item=>formatCampaignDate(item,calendar,options)).join('; ');
  const through=end.map(item=>formatCampaignDate(item,calendar,options)).join('; ');
  return from && through && from!==through ? from+' – '+through : from || through;
}
