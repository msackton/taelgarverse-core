import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarContext} from '../src/campaign-calendar-context.mjs';
import {calendarMonth,drWeekday,drDateString,parseDRDate,drDayDate,calendarSourcePath} from '../src/campaign-calendar.mjs';

const registry={campaigns:{alpha:{name:'Alpha',code:'a',aliases:['Campaign A'],campaignRoot:'Campaigns/A'},beta:{name:'Beta',code:'b',campaignRoot:'Campaigns/B'}}};
const note=(path,metadata={})=>({path,metadata});
const session=(path,metadata={})=>note(path,{tags:['session-note'],campaign:'Alpha',DR:'1748-07-01',realWorldDate:'2025-01-01',sessionNumber:1,...metadata});

test('weekday columns agree with both vault session anchors across 34 no-leap years',()=>{
  assert.equal(drWeekday(parseDRDate('1715-05-02').start),0);
  assert.equal(drWeekday(parseDRDate('1749-04-18').start),6);
  assert.equal(drWeekday(parseDRDate('1748-07-21').start),1);
  const feb=calendarMonth(1748,2);assert.equal(feb.days,28);
  assert.equal(drDateString(feb.endExclusive),'1748-03-01');
});

test('the calendar uses website session ranking, aliases, exclusion, and latest session end date',()=>{
  const notes=[session('Campaigns/A/Old.md',{DR:'1750-01-01'}),session('Campaigns/A/New.md',{campaign:'Campaign A',realWorldDate:'2026-01-01',DR:'1748-07-19',DR_end:'1748-07-23'}),
    session('Campaigns/A/Hidden.md',{realWorldDate:'2027-01-01',DR:'1751-01-01',excludePublish:['all']}),
    session('Campaigns/B/B.md',{campaign:'Beta',DR:'1715-05-02'}),session('_templates/Session.md',{realWorldDate:'zzz',DR:null}),session('Worldbuilding/Session.md',{realWorldDate:'zzz',DR:null})];
  const state=calendarContext(notes,registry,'a');
  assert.equal(state.context.id,'alpha');assert.equal(state.context.date,'1748-07-23');assert.equal(state.context.source,'Campaigns/A/New.md');
  assert.equal(calendarContext(notes,registry,'modern').context.date,'1748-07-23');
  const missing=calendarContext([...notes,session('Campaigns/A/Undated.md',{realWorldDate:'2028-01-01',DR:null})],registry,'alpha');
  assert.equal(missing.context,undefined);assert.match(missing.error,/no full DR date/);
  assert.ok(missing.contexts.byId.has('beta'),'settings remain usable when a campaign has no date');
});

test('DR dates round-trip across month and year boundaries without leap days',()=>{
  for(const date of ['0001-01-01','1748-02-28','1748-03-01','1748-12-31','1749-01-01','9999-12-31']){
    const parsed=parseDRDate(date);
    assert.equal(drDateString(parsed.start),date);
    assert.deepEqual(drDayDate(parsed.start),{year:parsed.year,month:parsed.month,day:parsed.day});
  }
  assert.equal(parseDRDate(1748).endExclusive-parseDRDate(1748).start,365);
  for(const invalid of ['1748-02-29','1748-04-31','0000-01-01','10000-01-01',null])assert.throws(()=>parseDRDate(invalid));
  const month=calendarMonth(1748,7);assert.equal(month.days,31);assert.equal(month.offset,2);assert.equal(month.weeks,5);
});

test('custom date resolution remains independent of session dates and validates full DR dates',()=>{
  const notes=[session('Campaigns/A/Session.md')];
  const custom=calendarContext(notes,registry,'custom','1748-04-06');
  assert.equal(custom.context.kind,'custom');assert.equal(custom.context.date,'1748-04-06');assert.equal(custom.context.dateSource,'custom-setting');
  assert.equal(custom.contexts.resolve('alpha').date,'1748-07-01');
  const invalid=calendarContext(notes,registry,'custom','1748-02-29');
  assert.equal(invalid.context,undefined);assert.match(invalid.error,/no leap days/);
});

test('calendar session sources exclude templates, private folders, and generated paths',()=>{
  for(const path of ['_templates/Session.md','_DM_/Secret.md','Worldbuilding/Session.md','.obsidian/Session.md','assets/DM/Session.md','AGENTS.md'])assert.equal(calendarSourcePath(path),false,path);
  assert.equal(calendarSourcePath('Campaigns/A/Session.md'),true);
});
