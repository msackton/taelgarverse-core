import test from 'node:test';
import assert from 'node:assert/strict';
import {headerFixture} from './helpers/header-fixture.mjs';

const dates=()=>headerFixture().services.DateManager;
for(const [input,display] of [
  ['1720-01-01','January 1st, 1720'],['1720-01-02','January 2nd, 1720'],
  ['1720-01-03','January 3rd, 1720'],['1720-01-11','January 11th, 1720'],
  ['1720-01-12','January 12th, 1720'],['1720-01-13','January 13th, 1720'],
  ['1720-01-21','January 21st, 1720'],['1720-12-31','December 31st, 1720'],
  [{year:1720,month:0,day:1},'January 1st, 1720'],
  [{year:1720,month:11,day:31},'December 31st, 1720'],
  [{isLuxonDateTime:true,year:1720,month:1,day:1},'January 1st, 1720'],
])test('date normalization: '+JSON.stringify(input),()=>{
  const value=dates().normalizeDate(input,false);
  assert.equal(value.display,display);assert.equal(value.year,1720);
  assert.equal(value.sort,value.days);assert.equal(value.isNormalizedDate,true);
});

test('DR arithmetic has 365-day years, inclusive month boundaries, and no leap day',()=>{
  const d=dates(),day=value=>d.normalizeDate(value).days;
  assert.equal(day('1721-01-01')-day('1720-01-01'),365);
  assert.equal(day('1720-03-01')-day('1720-02-28'),1);
  assert.equal(day('1721-01-01')-day('1720-12-31'),1);
  assert.equal(day('1720-05-01')-day('1720-04-30'),1);
});

test('calendar objects without a month use the documented default month',()=>{
  const d=dates();
  assert.equal(d.normalizeDate({year:1720,day:1},false).days,d.normalizeDate('1720-01-01').days);
  assert.equal(d.normalizeDate({year:1720},true).days,d.normalizeDate('1720-12-31').days);
});

test('legacy partial-date conventions remain explicit, including quoted versus numeric years',()=>{
  const d=dates(),day=value=>d.normalizeDate(value).days;
  // These differ today. Preserve the distinction during extraction; changing
  // the interpretation of existing YAML requires a separate behavior decision.
  for(const [input,isEnd,expected] of [
    [1720,false,'1720-01-01'],[1720,true,'1720-12-31'],
    ['1720',false,'1720-12-31'],['1720',true,'1720-01-01'],
    ['1720-05',false,'1720-05-31'],['1720-05',true,'1720-05-01'],
  ])assert.equal(d.normalizeDate(input,isEnd).days,day(expected),JSON.stringify([input,isEnd]));
  assert.equal(d.normalizeDate('1720-05').display,'May 1720');
  assert.equal(d.normalizeDate(1720).display,'DR 1720');
  for(const value of ['0001','9999',1,9999])assert.equal(d.normalizeDate(value).isHiddenDate,true);
  for(const value of [undefined,'',0])assert.equal(d.normalizeDate(value),undefined);
  const normalized=d.normalizeDate('1720-05-06');assert.equal(d.normalizeDate(normalized),normalized);
});

for(const [date,created,alive,age] of [
  ['1699-12-31',false,false,undefined],['1700-01-01',true,true,0],
  ['1700-01-02',true,true,1],['1720-01-01',true,true,7300],
])test('birth boundary and age at '+date,()=>{
  const d=headerFixture({date}).services.DateManager;
  const actual=d.getPageDates({tags:['person'],born:'1700-01-01'});
  assert.equal(actual.isCreated,created);assert.equal(actual.isAlive,alive);
  if(created)assert.equal(actual.age,age);
});

test('death and destruction end dates are inclusive and age stops advancing afterward',()=>{
  for(const fields of [{born:'1700-01-01',died:'1740-01-01'},{created:'1700-01-01',destroyed:'1740-01-01'}]){
    const on=headerFixture({date:'1740-01-01'}).services.DateManager.getPageDates(fields);
    const after=headerFixture({date:'1750-01-01'}).services.DateManager.getPageDates(fields);
    assert.equal(on.isAlive,true);assert.equal(after.isAlive,false);
    assert.equal(on.age,14600);assert.equal(after.age,14600);
  }
});

test('frontmatter lifecycle dates take precedence over Dataview inline timeline fields',()=>{
  const d=dates();
  const page={DR:'1800-01-01',DR_end:'1801-01-01',file:{frontmatter:{tags:['person'],born:'1700-01-01'}}};
  const actual=d.getPageDates(page);
  assert.equal(actual.startDate.display,'January 1st, 1700');assert.equal(actual.endDate,undefined);
  assert.equal(actual.age,7300);
  const both=d.getPageDates({tags:['person'],born:'1700-01-01',DR:'1800-01-01',DR_end:'1801-01-01'});
  assert.equal(both.startDate.year,1700);assert.equal(both.endDate,undefined);
});

test('a lone DR means a one-day event, but does not end a person or place',()=>{
  const d=dates();
  for(const tag of ['person','place','group']){
    const actual=d.getPageDates({tags:[tag],DR:'1710-01-01'});
    assert.equal(actual.isAlive,true);assert.equal(actual.endDate,undefined);
  }
  const event=d.getPageDates({tags:['event'],DR:'1710-01-01'});
  assert.equal(event.isAlive,false);assert.equal(event.startDate.days,event.endDate.days);
  assert.equal(d.getPageDates({tags:['event'],DR:'1710-01-01',DR_end:null}).endDate,undefined);
});

test('explicit render date overrides a note date and incomplete metadata has stable defaults',()=>{
  const d=dates();
  assert.equal(d.getTargetDateForPage({pageTargetDate:'1800-01-01'}).display,'January 1st, 1720');
  const empty=d.getPageDates({});assert.equal(empty.isCreated,true);assert.equal(empty.isAlive,true);
  assert.equal(empty.startDate,undefined);assert.equal(empty.endDate,undefined);assert.equal(empty.age,undefined);
});

for(const [date,expected] of [
  ['1700-01-01','1 day'],['1700-01-02','1 day'],['1700-01-03','2 days'],
  ['1700-02-01','1 months'],['1701-01-01','12 months'],['1702-01-01','2 years'],
])test('legacy age wording at '+date,()=>{
  const h=headerFixture({date});
  const output=h.services.TokenParser.formatDisplayString('<age>',h.file('Example'));
  assert.equal(output,expected);
});
