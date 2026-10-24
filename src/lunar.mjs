import {parseDRDate,drDayDate} from './campaign-calendar.mjs';

// Confirmed by the user: DR 1748-04-06 00:00 is a full moon. These are
// world-day coordinates, independent of Earth dates, timezones and leap years.
export const lunarDefinition=Object.freeze({fullMoonDate:'1748-04-06',fullMoonTime:'00:00',cycleDays:29.5,dailySampleTime:'12:00'});
export const lunarPhaseNames=['New moon','Waxing crescent','First quarter','Waxing gibbous','Full moon','Waning gibbous','Last quarter','Waning crescent'];
const anchor=parseDRDate(lunarDefinition.fullMoonDate).start;
const modulo=(value,base)=>(value%base+base)%base;
const finite=value=>{if(!Number.isFinite(value))throw new Error('Lunar time must be a finite absolute day');};

export function lunarPhase(instant) {
  finite(instant);
  // Phase 0 is new, 0.25 first quarter, 0.5 full, and 0.75 last quarter.
  const phase=modulo(instant-anchor+lunarDefinition.cycleDays/2,lunarDefinition.cycleDays)/lunarDefinition.cycleDays;
  const index=Math.round(phase*8)%8;
  return {instant,phase,index,name:lunarPhaseNames[index],illumination:(1-Math.cos(2*Math.PI*phase))/2};
}

export function lunarCrossings(from,to) {
  finite(from);finite(to);if(to<from)throw new Error('Lunar interval end precedes its start');
  // One tick is three hours. A 29.5-day cycle is exactly 236 ticks;
  // its quarters are exactly 59 ticks, avoiding accumulated rounding drift.
  const anchorTick=anchor*8,quarterTicks=59,crossings=[];
  const ids=['full','last-quarter','new','first-quarter'];
  for(let n=Math.ceil((from*8-anchorTick)/quarterTicks);;n++) {
    const tick=anchorTick+n*quarterTicks,instant=tick/8;if(instant>=to)break;
    const phaseIndex=modulo(n+2,4)*2,day=Math.floor(instant),hour=modulo(tick,8)*3;
    crossings.push({id:'moon:'+tick,kind:ids[modulo(n,4)],instant,day,phase:phaseIndex/8,name:lunarPhaseNames[phaseIndex],time:String(hour).padStart(2,'0')+':00'});
  }
  return crossings;
}

export function lunarDay(day) {
  finite(day);if(!Number.isInteger(day))throw new Error('A lunar day must be an integer absolute day');
  return {...lunarPhase(day+0.5),day,crossings:lunarCrossings(day,day+1)};
}

export function lunarDateTime(crossing) {
  const date=drDayDate(crossing.day);
  return String(date.year).padStart(4,'0')+'-'+String(date.month).padStart(2,'0')+'-'+String(date.day).padStart(2,'0')+' '+crossing.time;
}
