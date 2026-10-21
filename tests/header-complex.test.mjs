import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHeaderSnapshot,renderHeader} from '../src/header-core/index.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {complexNotes,complexRenderCases} from './fixtures/header-complex-cases.mjs';

const expected=JSON.parse(fs.readFileSync(new URL('./fixtures/header-complex-outputs.json',import.meta.url),'utf8'));
const history=date=>headerFixture({date,extraNotes:complexNotes});
assert.deepEqual(Object.keys(expected),complexRenderCases.map(c=>c.id),'every complex output must have an active test');

for(const example of complexRenderCases)for(const headerType of ['static','website'])
  test('complex complete header: '+example.id+' / '+headerType,()=>{
    assert.equal(history(example.date).render(example.path,{headerType}),expected[example.id][headerType]);
  });

for(const [date,offices] of [
  ['1707-12-31',[]],['1708-01-01',[['Citadel','Castellan']]],
  ['1712-01-01',[['Citadel','Castellan'],['Harbor','Admiral']]],
  ['1719-12-31',[['Citadel','Castellan'],['Harbor','Admiral']]],
  ['1720-01-01',[['Harbor','Admiral'],['March','Regent']]],
  ['1724-12-31',[['Harbor','Admiral'],['March','Regent']]],
  ['1725-01-01',[['March','Regent']]],
])test('one person has different active offices across several places: '+date,()=>{
  const h=history(date),at=h.services.DateManager.normalizeDate(date),a=h.services.AffiliationManager;
  const active=a.getNonPrimaryAffiliations(h.metadata('Serin')).filter(x=>x.type==='leader'&&x.endDate.days>=at.days);
  assert.deepEqual(active.map(x=>[x.org,x.title]),offices);
  assert.deepEqual(a.getPrimaryAffiliations(h.metadata('Serin')).map(x=>x.org),['House Vale']);
});

for(const [place,date,ruler] of [
  ['Citadel','1707-12-31',''],
  ['Citadel','1708-01-01','Castellan: [[Serin|Warden Serin Vale]] (since January 1st, 1708)'],
  ['Citadel','1719-12-31','Castellan: [[Serin|Warden Serin Vale]] (since January 1st, 1708)'],
  ['Citadel','1720-01-01','Keeper: [[Ilan|Keeper Ilan]] (since January 1st, 1720)'],
  ['Citadel','1720-01-02','Keeper: [[Ilan|Keeper Ilan]] (since January 1st, 1720)'],
  ['Harbor','1724-12-30','Admiral: [[Serin|Warden Serin Vale]] (since January 1st, 1712)'],
  ['Harbor','1724-12-31','Admiral: [[Serin|Warden Serin Vale]] (since January 1st, 1712)'],
  ['Harbor','1725-01-01','Admiral: [[Mara|Admiral Mara]] (since January 1st, 1725)'],
  ['March','1719-12-31',''],
  ['March','1720-01-01','Regent: [[Serin|Warden Serin Vale]] (since January 1st, 1720)'],
])test('reverse leadership follows each place independently: '+place+' / '+date,()=>{
  assert.equal(history(date).services.AffiliationManager.getLeadBy(place),ruler);
});

test('concurrent memberships group naturally, while past offices and custom current memberships stay separate',()=>{
  const h=history('1720-01-01'),actual=h.services.AffiliationManager.getFormattedNonPrimaryAffiliations(h.metadata('Serin'));
  assert.equal(actual,[
    'Castellan of [[Citadel]] (January 1st, 1708 - December 31st, 1719)',
    'Admiral of [[Harbor]] (since January 1st, 1712)',
    'Regent of the [[March|Border March]] (since January 1st, 1720)',
    'Fellow of the [[Guild|Glass Guild]], and the [[Academy|Royal Academy]] (January 1st, 1705 - December 31st, 1715)',
    'Serving the High Council since January 1st, 1716',
  ].join('\n'));
  assert.doesNotMatch(actual,/House Vale/);
});

test('a distant border change updates the home chain even when the person and town do not move',()=>{
  const before=history('1714-12-31'),after=history('1715-01-01');
  const format=h=>h.services.TokenParser.formatDisplayString('<home:4n>',h.file('Serin'));
  assert.equal(format(before),'Citadel, the Old County, the Border March, the Old Kingdom');
  assert.equal(format(after),'Citadel, the Old County, the Border March, the New Kingdom');
  for(const h of [before,after])assert.equal(h.services.WhereaboutsManager.getWhereabouts(h.metadata('Serin')).home.location,'Citadel');
});

test('a carried object follows person, ship, anchorage and regional ancestry on the requested date',()=>{
  for(const [date,location] of [['1718-06-14','Bay'],['1718-06-15','Cove']]){
    const h=history(date),at=h.services.DateManager.normalizeDate(date);
    const home=h.services.WhereaboutsManager.getWhereabouts(h.metadata('Star Glass')).home;
    const chain=h.services.WhereaboutsManager.getWhereaboutChain(home,at,'8','object');
    assert.deepEqual(chain.map(x=>x.name.linkTarget),['Serin','Aurora',location,'Sea','Region']);
  }
});

test('a transferred object keeps its original owner ancestry at creation and its new vault ancestry now',()=>{
  const h=history('1721-01-01'),text=h.render('Star Glass',{headerType:'static'});
  assert.ok(text.includes('First held by [[Serin|Warden Serin Vale]], in [[Citadel]], the [[Old County]], the [[March|Border March]], the [[Old Kingdom]]'));
  assert.ok(text.includes('Kept in the [[Vault|Great Vault]], [[Citadel]], the [[New County]], the [[March|Border March]], the [[New Kingdom]]'));
});

test('display defaults resolve global, type, note and per-location formats in a complex chain',()=>{
  const base=history('1715-01-01');
  const h=headerFixture({date:'1715-01-01',extraNotes:complexNotes,displayRules:{
    requiredDisplayDefaults:{...base.input.coreMeta.requiredDisplayDefaults,wHome:'Global <home:1n>'},
    typeDisplayDefaults:{...base.input.coreMeta.typeDisplayDefaults,
      person:{...base.input.coreMeta.typeDisplayDefaults.person,wHome:'Type <home:1n>'}},
  }});
  const n=h.services.NameManager,w=h.services.OutputHandler;
  assert.equal(n.getDisplayData({}).wHome,'Global <home:1n>');
  assert.equal(n.getDisplayData({tags:['person']}).wHome,'Type <home:1n>');
  assert.equal(n.getDisplayData(h.metadata('Serin')).wHome,'Seat: <home:4rq>');
  assert.ok(w.outputWhereabouts('Serin',h.metadata('Serin')).includes('Seat: in [[Citadel]]'));
  const moved=history('1720-01-01');
  assert.ok(moved.services.OutputHandler.outputWhereabouts('Serin',moved.metadata('Serin')).includes('Court: in [[Harbor]]'));
  const hidden={...h.metadata('Serin'),displayDefaults:{...h.metadata('Serin').displayDefaults,wHome:''}};
  assert.equal(w.getWhereaboutsStrings('Serin',hidden).home.trim(),'');
});

test('per-leg aliases and prepositions survive the full carried-object chain without losing the link target',()=>{
  const h=history('1718-06-15'),text=h.render('Star Glass',{headerType:'static'});
  assert.ok(text.includes('by [[Serin|Warden Serin Vale]], in [[Aurora]], moored at the [[Cove|hidden anchorage]]'));
  assert.doesNotMatch(text,/\[\[hidden anchorage\]\]|Open Bay/);
});

test('secondary locations and an explicit unknown road coexist with a known home',()=>{
  const h=history('1725-03-02'),w=h.services.WhereaboutsManager.getWhereabouts(h.metadata('Serin'));
  assert.equal(w.home.location,'Harbor');assert.equal(w.current.location,null);
  assert.equal(w.secondary.location,'Academy');
  const output=h.services.OutputHandler.outputWhereabouts('Serin',h.metadata('Serin'));
  assert.ok(output.includes('Expedition: on the northern road'));
  assert.ok(output.includes('Court: in [[Harbor]]'));
  assert.ok(output.includes('Also maintains rooms with the [[Academy|Royal Academy]], in [[Citadel]], the [[New County]]'));
});

test('historical encounters use the ship anchorage at the meeting date across later home and border changes',()=>{
  const texts=[];
  for(const date of ['1718-06-14','1718-06-15','1720-01-01','1725-03-02']){
    const h=history(date),meetings=h.services.EventManager.getPartyMeeting(h.file('Serin'));
    assert.equal(meetings.length,1);texts.push(meetings[0].text);
  }
  assert.ok(texts.every(t=>t===texts[0]));
  assert.equal(texts[0],'Met with the [[Party|Fixture Party]] on June 15th, 1718 in [[Aurora]], moored at the [[Cove|hidden anchorage]]');
});

test('indexing and full scans agree across complex multi-office histories without state leaking between renders',()=>{
  const h=history('1752-01-01'),before=JSON.stringify(h.input);
  const full=createHeaderSnapshot({...h.input,indexAffiliations:false});
  for(const example of [...complexRenderCases,...complexRenderCases.toReversed()])for(const headerType of ['static','website']){
    const request={source:'---\n---\n',name:example.path.split('/').at(-1).replace(/\.md$/,''),
      metadata:h.metadata(example.path),date:example.date,headerType};
    const actual=renderHeader(h.runtime,request);
    assert.equal(actual,renderHeader(full,request),example.id+' / '+headerType);
    assert.equal(actual,expected[example.id][headerType],example.id+' / '+headerType);
  }
  assert.equal(JSON.stringify(h.input),before);
});
