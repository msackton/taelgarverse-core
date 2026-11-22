import test from 'node:test';
import assert from 'node:assert/strict';
import {vaultHeaderFixture,vaultCasePath} from './helpers/vault-header-fixture.mjs';

const fixture=vaultHeaderFixture();

test('both current header layouts update the chalice location on October 5',()=>{
  for(const mode of ['obsidian','website']){
    const before=fixture.callout('Chalice of the Runepriest',{date:'1748-10-04',mode});
    const after=fixture.callout('Chalice of the Runepriest',{date:'1748-10-05',mode});
    assert.match(before,/Current location: lost/);
    assert.match(after,/Current location: \[\[Tharn Todor\]\]/);
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
  const text=h.callout('Derik III');
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
  const taviose=fixture.callout('Taviose');
  assert.ok(taviose.includes('[[Manor of Cleenseau]], the [[Barony of Aveil]], [[Sembara]], [[Greater Sembara]]'));
  const garrison=fixture.callout('Army Garrison of Cleenseau');
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
    const output=fixture.callout(name);
    for(const phrase of phrases)assert.ok(output.includes(phrase),name+' / '+phrase);
  }
});
