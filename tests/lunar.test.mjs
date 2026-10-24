import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDRDate} from '../src/campaign-calendar.mjs';
import {lunarDefinition,lunarPhase,lunarCrossings,lunarDay,lunarDateTime} from '../src/lunar.mjs';

const day=date=>parseDRDate(date).start,anchor=day('1748-04-06');

test('the confirmed midnight full moon repeats every 29.5 days in both directions',()=>{
  assert.equal(lunarDefinition.fullMoonTime,'00:00');assert.equal(lunarPhase(anchor).phase,0.5);assert.equal(lunarPhase(anchor).illumination,1);
  for(const n of [-10000,-100,-6,-1,0,1,6,100,10000]) {
    const full=lunarPhase(anchor+n*29.5),fresh=lunarPhase(anchor+n*29.5+14.75);
    assert.equal(full.phase,0.5);assert.equal(full.name,'Full moon');assert.equal(fresh.phase,0);assert.equal(fresh.illumination,0);
  }
  const july=lunarCrossings(day('1748-07-01'),day('1748-08-01')).find(c=>c.kind==='full');
  assert.equal(lunarDateTime(july),'1748-07-03 12:00');
  assert.equal(lunarDateTime(lunarCrossings(day('1748-09-01'),day('1748-10-01')).find(c=>c.kind==='full')),'1748-09-30 00:00');
});

test('principal phases retain exact fractional crossing times and assign midnight to the new date',()=>{
  const phases=lunarCrossings(day('1748-04-01'),day('1748-05-01'));
  assert.deepEqual(phases.map(c=>[c.kind,lunarDateTime(c)]),[
    ['full','1748-04-06 00:00'],['last-quarter','1748-04-13 09:00'],['new','1748-04-20 18:00'],['first-quarter','1748-04-28 03:00'],
  ]);
  assert.equal(lunarCrossings(anchor-1,anchor).length,0);
  assert.equal(lunarCrossings(anchor,anchor+1)[0].kind,'full');
  assert.equal(lunarCrossings(anchor+0.000001,anchor+29.5).filter(c=>c.kind==='full').length,0);
  assert.equal(lunarCrossings(anchor+29.5,anchor+30.5)[0].kind,'full');
  const before=lunarCrossings(day('1748-03-01'),anchor);
  assert.equal(lunarDateTime(before.find(c=>c.kind==='full')),'1748-03-07 12:00');
  assert.equal(lunarDateTime(before.find(c=>c.kind==='new')),'1748-03-22 06:00');
});

test('daily icons sample noon while exact events remain separate from rounded phase labels',()=>{
  const fullDay=lunarDay(anchor);assert.equal(fullDay.instant,anchor+0.5);assert.equal(fullDay.name,'Full moon');assert.ok(fullDay.illumination<1);
  assert.equal(fullDay.crossings[0].time,'00:00');
  const nextDay=lunarDay(anchor+1);assert.equal(nextDay.name,'Full moon');assert.deepEqual(nextDay.crossings,[]);
  assert.equal(lunarPhase(anchor+7.375).name,'Last quarter');assert.equal(lunarPhase(anchor-7.375).name,'First quarter');
  assert.ok(Math.abs(lunarPhase(anchor+7.375).illumination-0.5)<1e-12);
  assert.equal(day('1748-03-01')-day('1748-02-28'),1);
  assert.equal(lunarPhase(day('1748-03-01')).phase,lunarPhase(day('1748-02-28')+1).phase);
  for(const bad of [NaN,Infinity,-Infinity,'1748-04-06'])assert.throws(()=>lunarPhase(bad));
  assert.throws(()=>lunarDay(anchor+0.5));assert.throws(()=>lunarCrossings(anchor,anchor-1));
});
