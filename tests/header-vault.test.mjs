import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNote} from '../src/content-store.mjs';
import {vaultCases,vaultOutputs,vaultHeaderFixture,vaultCasePath} from './helpers/vault-header-fixture.mjs';
import {renderBio} from '../src/header-core/index.mjs';

const fixture=vaultHeaderFixture();
const isTestCase=metadata=>(metadata.tags??[]).some(tag=>/^testcase(?:\/|$)/.test(tag));
const daysInMonth=[31,28,31,30,31,30,31,31,30,31,30,31];
function adjacent(date,offset){
  let [year,month,day]=date.split('-').map(Number);day+=offset;
  if(day===0){if(--month===0){--year;month=12;}day=daysInMonth[month-1];}
  if(day>daysInMonth[month-1]){day=1;if(++month===13){++year;month=1;}}
  return [year,month,day].map((n,i)=>String(n).padStart(i?2:4,'0')).join('-');
}

test('all frozen testcase tags, including child tags, have exactly one active output matrix',()=>{
  const paths=vaultCases.cases.map(c=>c.path);
  assert.equal(paths.length,21);
  assert.equal(new Set(paths).size,paths.length);
  assert.deepEqual(paths,vaultCases.pages.filter(p=>isTestCase(p.metadata)).map(p=>p.path));
  assert.deepEqual(Object.keys(vaultOutputs),[...paths,...vaultCases.relatedCases.map(c=>c.path)]);
  assert.ok(fixture.metadata(vaultCasePath('Akan')).tags.includes('testcase/with-whereabouts'));
});

for(const example of vaultCases.cases){
  const name=example.path.split('/').at(-1);
  test('all recorded transitions have before/on/after expectations: '+name,()=>{
    assert.deepEqual(Object.keys(vaultOutputs[example.path]),example.dates);
    for(const boundary of example.boundaries){
      const d=fixture.services.DateManager;
      assert.equal(d.normalizeDate(boundary.value,boundary.isEnd).days,d.normalizeDate(boundary.date).days,boundary.field);
      for(const offset of [-1,0,1])assert.ok(example.dates.includes(adjacent(boundary.date,offset)),boundary.field+' / '+offset);
    }
  });
  for(const date of example.dates)for(const headerType of ['static','website'])
    test('tagged vault header: '+name+' / '+date+' / '+headerType,()=>{
      const expected=vaultOutputs[example.path][date][headerType];
      assert.equal(fixture.render(example.path,{date,headerType}),expected);
      assert.equal(renderBio(fixture.runtime,{name:name.replace(/\.md$/,''),metadata:fixture.metadata(example.path),date,headerType}),
        parseNote(expected).body);
    });
}

for(const example of vaultCases.relatedCases)for(const date of example.dates)for(const headerType of ['static','website'])
  test('historical kingdom header: '+example.path.split('/').at(-1)+' / '+date+' / '+headerType,()=>{
    const expected=vaultOutputs[example.path][date][headerType];
    assert.equal(fixture.render(example.path,{date,headerType}),expected);
    assert.equal(renderBio(fixture.runtime,{name:example.path.split('/').at(-1).replace(/\.md$/,''),
      metadata:fixture.metadata(example.path),date,headerType}),parseNote(expected).body);
  });

test('all tagged samples render one title and their complete details from the block',()=>{
  for(const example of vaultCases.cases)for(const headerType of ['static','website']){
    const body=parseNote(fixture.render(example.path,{headerType})).body;
    assert.match(body,/^# /);
    const actual=renderBio(fixture.runtime,{name:example.path.split('/').at(-1).replace(/\.md$/,''),
      metadata:fixture.metadata(example.path),date:'1752-01-01',headerType});
    assert.equal(actual,body);
    assert.equal((actual.match(/^# /gm)||[]).length,1,example.path);
  }
});

for(const [date,expected] of [
  ['1566-12-31',[]],
  ['1567-01-01',[['Tyrwingha','Princess Consort']]],
  // Numeric end years run through December 31, so the two consort roles overlap in 1571.
  ['1571-01-01',[['Tyrwingha','Princess Consort'],['Tyrwingha','Queen Consort']]],
  ['1572-01-01',[['Tyrwingha','Queen Consort']]],
  ['1582-01-01',[['Tyrwingha','Queen Consort'],['Sembara','Queen']]],
  ['1589-01-01',[['Tyrwingha','Queen Consort'],['Sembara','Queen'],['Tyrwingha','Queen']]],
  ['1593-01-01',[]],
])test('Elaine I has the correct concurrent active titles at '+date,()=>{
  const h=vaultHeaderFixture(date),at=h.services.DateManager.normalizeDate(date);
  const active=h.services.AffiliationManager.getNonPrimaryAffiliations(h.metadata(vaultCasePath('Elaine I')))
    .filter(a=>a.endDate.days>=at.days).map(a=>[a.org,a.title]);
  assert.deepEqual(active,expected);
});

test('Derik III groups his three kingdoms while retaining his earlier title and inherited death bounds',()=>{
  const h=vaultHeaderFixture('1520-01-01'),a=h.services.AffiliationManager;
  const metadata=h.metadata(vaultCasePath('Derik III'));
  assert.deepEqual(a.getNonPrimaryAffiliations(metadata).map(x=>[x.org,x.title]),[
    ['Vostok','Prince of the North'],['Sembara','High King'],['Tyrwingha','High King'],['Vostok','High King'],
  ]);
  const text=h.render(vaultCasePath('Derik III'),{headerType:'static'});
  assert.ok(text.includes('Prince of the North of [[Vostok]] (DR 1511 - DR 1519)'));
  assert.ok(text.includes('High King of [[Sembara]], [[Tyrwingha]], and [[Vostok]] (since DR 1519)'));
  assert.deepEqual(a.getNonPrimaryAffiliations(metadata).map(x=>x.endDate.days),
    [1519,1549,1549,1549].map(year=>h.services.DateManager.normalizeDate(year,true).days));
});

for(const [name,date,current,lastKnown] of [
  ['Akan','1748-04-07','travelling to Tokra','travelling to Tokra'],
  ['Akan','1748-04-13','Tokra','Tokra'],
  ['Sura','1735-01-01','Lakan Monastery','Lakan Monastery'],
  ['Sura','1748-06-08','Karawa','Karawa'],
  ['Sura','1748-12-27',null,'plains south of Tokra'],
  ['Hralgar','1748-11-22','Stormcaller Tower','Stormcaller Tower'],
  ['Hralgar','1748-11-23','Stormcaller Tower','Stormcaller Tower'],
  ['Hralgar','1748-11-24',null,'Stormcaller Tower'],
  ['Chalice of the Runepriest','1748-10-04','lost','lost'],
  ['Chalice of the Runepriest','1748-10-05','Tharn Todor','Tharn Todor'],
  ['Wave Dancer','1748-10-14','Wahacha','Wahacha'],
  ['Wave Dancer','1748-10-15',null,'Wahacha'],
])test('tagged sample location transition: '+name+' / '+date,()=>{
  const h=vaultHeaderFixture(date),w=h.services.WhereaboutsManager.getWhereabouts(h.metadata(vaultCasePath(name)));
  assert.equal(w.current.location,current);assert.equal(w.lastKnown.location,lastKnown);
});

test('Antonia follows the mirror through a moving ship but her encounter keeps the historical location',()=>{
  const h=vaultHeaderFixture('1752-01-01'),page=vaultCasePath('Antonia');
  const wb=h.services.OutputHandler.outputWhereabouts('Antonia',h.metadata(page));
  assert.ok(wb.includes('[[Mirror of Soul Trapping]], stored on [[Vindristjarna]], in the [[Gulf of Chardon]]'));
  const meetings=h.services.EventManager.getPartyMeeting(h.file(page));
  assert.equal(meetings.length,1);
  assert.ok(meetings[0].text.includes('[[Mirror of Soul Trapping]], [[Uzgukhar]], [[Xurkhaz]]'));
  assert.doesNotMatch(meetings[0].text,/Vindristjarna|Gulf of Chardon/);
});

test('Taviose and the Cleenseau garrison retain long place and organization chains',()=>{
  const taviose=fixture.render(vaultCasePath('Taviose'),{headerType:'static'});
  assert.ok(taviose.includes('[[Manor of Cleenseau]], the [[Barony of Aveil]], [[Sembara]], [[Greater Sembara]]'));
  const garrison=fixture.render(vaultCasePath('Army Garrison of Cleenseau'),{headerType:'static'});
  assert.ok(garrison.includes('[[Dunfry Regiment]], the [[Army of the West]], the [[Sembaran Army]], [[Sembara]]'));
  assert.ok(garrison.includes('Captain: [[Ida Rosfeld|Captain Ida Rosfeld]]'));
});

test('custom place, object and event display defaults preserve their authored sentences',()=>{
  for(const [name,phrases] of [
    ['Isingue',["Consumed by Cha'mutte's plague in DR 1545",'once part of the [[Istabor Alliance]]']],
    ['Chalice of the Runepriest',['Created in DR 1547 by the [[Bahrazel|Bahrâzel]]','Current location: [[Tharn Todor]]']],
    ['Battle of Urlich Pass',['Fought in DR 1545','Fought in [[Urlich Pass]], the [[Sentinel Range]]']],
    ['Wave Dancer',['Home area: the [[Eastern Green Sea]]','moored in the [[Wahacha|main port of Wacahca]]']],
  ]){
    const output=fixture.render(vaultCasePath(name),{headerType:'static'});
    for(const phrase of phrases)assert.ok(output.includes(phrase),name+' / '+phrase);
  }
});
