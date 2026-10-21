import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNote} from '../src/content-store.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {synthesizedNotes,synthesizedExamples} from './fixtures/header-synthesized-cases.mjs';
import {HeaderDataError,renderBio} from '../src/header-core/index.mjs';

const world=(date='1720-01-01',extraNotes={})=>headerFixture({date,baseNotes:synthesizedNotes,extraNotes});
const contains=(text,...pieces)=>{for(const piece of pieces)assert.ok(text.includes(piece),'Missing '+JSON.stringify(piece)+' in\n'+text);};

test('synthesized person separates two primary houses from an ordinary membership',()=>{
  const h=world(),a=h.services.AffiliationManager,person=h.metadata('Leda');
  assert.deepEqual(a.getPrimaryAffiliations(person).map(x=>x.org),['North House','South House']);
  assert.deepEqual(a.getNonPrimaryAffiliations(person).map(x=>x.org),['Astronomers']);
  assert.equal(a.getFormattedNonPrimaryAffiliations(person),'Member of the [[Astronomers]]');
  for(const headerType of ['static','website']){
    const text=h.render('Leda',{headerType});
    contains(text,'LEH-dah','they/them','20 years old','[[North House]], and the [[South House]]','[[Astronomers]]');
    assert.equal((text.match(/LEH-dah/g)??[]).length,1);
  }
});

test('synthesized lantern follows its carrier into a village, county and realm',()=>{
  const h=world(),text=h.render('Traveller’s Lantern',{headerType:'static'});
  contains(text,'# The Traveller’s Lantern','uncommon magical lantern','Created January 1st, 1710',
    'Carried by [[Leda]], in [[Aster]], the [[East County]], the [[North Realm]]');
});

test('synthesized lost compass remembers the container location at the last sighting',()=>{
  const h=world('1720-06-07'),text=h.render('Glass Compass',{headerType:'static'});
  assert.equal(h.services.WhereaboutsManager.getWhereabouts(h.metadata('Glass Compass')).current.location,null);
  contains(text,'Last seen in the [[Sea Chest]], the [[Loft|Observatory Loft]], [[Aster]], the [[East County]] on June 5th, 1720');
  assert.doesNotMatch(text,/Skylark|Bellport/);
  // The container really has moved; this is not a static ancestor chain.
  assert.equal(h.services.WhereaboutsManager.getWhereabouts(h.metadata('Sea Chest')).current.location,'Skylark');
});

test('synthesized destroyed pier uses its custom end status and retains the location chain',()=>{
  const h=world('1721-01-01'),metadata=h.metadata('Pier');
  assert.equal(h.services.DateManager.getPageDates(metadata).isAlive,false);
  const text=h.render('Pier',{headerType:'static'});
  contains(text,'washed away','April 1st, 1720','[[Aster]], the [[East County]], the [[North Realm]]');
});

test('synthesized two-day elapsed event preserves its dates, parent event and location',()=>{
  const h=world(),text=h.render('Bridge Opening',{headerType:'static'});
  contains(text,'April 1st, 1710','April 3rd, 1710','2 days','[[Spring Festival]]','[[Aster]]');
  const dates=h.services.DateManager.getPageDates(h.metadata('Bridge Opening'));
  assert.equal(dates.endDate.days-dates.startDate.days,2);
});

test('synthesized spirit supports explicit pronouns without inventing a species or birth date',()=>{
  const h=world(),text=h.render('Lantern Keeper',{headerType:'static'});
  contains(text,'# Lantern Keeper','spirit','xe/xem');
  assert.doesNotMatch(text,/Born|undefined|NaN|human/);
});

for(const [date,aster,bellport] of [
  ['1709-12-31','', ''],
  ['1710-01-01','Warden: [[Eve|Warden Eve]]',''],
  ['1715-01-01','Warden: [[Eve|Warden Eve]]\nWarden: [[Noor|Warden Noor]]',''],
  ['1720-12-31','Warden: [[Eve|Warden Eve]]\nWarden: [[Noor|Warden Noor]]',''],
  ['1721-01-01','Warden: [[Noor|Warden Noor]]','Steward: [[Eve|Warden Eve]]'],
])test('synthesized co-rule and transfer of office at '+date,()=>{
  const a=world(date).services.AffiliationManager;
  assert.equal(a.getLeadBy('Aster'),aster);assert.equal(a.getLeadBy('Bellport'),bellport);
});

test('synthesized plain note has a title and no fabricated bio information',()=>{
  const h=world();
  for(const headerType of ['static','website']){
    const parsed=parseNote(h.render('Field Notes',{headerType}));
    assert.equal(parsed.body.trim(),'# Field Notes');
    assert.equal(renderBio(h.runtime,{name:'Field Notes',metadata:h.metadata('Field Notes'),date:'1720-01-01',headerType}).trim(),'# Field Notes');
  }
});

test('all eight synthesized examples render both ways without mutating their shared inputs',()=>{
  const h=world(),before=JSON.stringify(h.input);
  assert.equal(synthesizedExamples.length,8);
  for(const example of [...synthesizedExamples,...synthesizedExamples.toReversed()])for(const headerType of ['static','website']){
    const first=h.render(example.path,{date:example.date,headerType});
    assert.equal(h.render(example.path,{date:example.date,headerType}),first);
    assert.doesNotMatch(first,/undefined|NaN|\[object Object\]/,example.id);
    assert.equal((parseNote(first).body.match(/^# /gm)??[]).length,1);
  }
  assert.equal(JSON.stringify(h.input),before);
});

// This oracle uses fully specified ISO dates and ordinary interval comparisons,
// independently of DateManager's normalization and AffiliationManager's filters.
const membershipDates=['1709-12-31','1710-01-01','1710-01-02','1714-12-31','1715-01-01',
  '1715-01-02','1719-12-31','1720-01-01','1720-01-02','1720-12-31','1721-01-01'];
for(const start of ['1710-01-01','1715-01-01','1720-01-01'])
  for(const end of ['1715-01-01','1720-01-01','1720-12-31'].filter(end=>end>=start))
    test('generated interval oracle: '+start+' through '+end,()=>{
      for(const date of membershipDates){
        const h=world(date),a=h.services.AffiliationManager,at=h.services.DateManager.normalizeDate(date);
        const person={tags:['person'],affiliations:[{org:'Astronomers',start,end}]};
        assert.equal(a.isAffiliated('Astronomers',person,at),start<=date&&date<=end,date);
        assert.equal(a.isOrWasAffiliated('Astronomers',person,at),start<=date,date);
        assert.equal(a.getAffiliations(person).length,start<=date?1:0,date);
      }
    });

const residences=[
  {type:'home',location:'Aster',end:'1714-12-31'},
  {type:'home',location:'Bellport',start:'1715-01-01'},
  {type:'away',location:'Skylark',start:'1720-06-01',end:'1720-06-05'},
];
const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
for(const order of orders)test('unambiguous residence/travel histories are independent of entry order: '+order.join(','),()=>{
  const w=world().services.WhereaboutsManager;
  const person={tags:['person'],born:'1700-01-01',whereabouts:order.map(i=>residences[i])};
  for(const [date,home,current] of [
    ['1714-12-31','Aster','Aster'],['1715-01-01','Bellport','Bellport'],
    ['1720-05-31','Bellport','Bellport'],['1720-06-01','Bellport','Skylark'],
    ['1720-06-05','Bellport','Skylark'],['1720-06-06','Bellport','Bellport'],
  ]){
    const at=w.getWhereabouts(person,date);
    assert.equal(at.home.location,home,date);assert.equal(at.current.location,current,date);
    assert.equal(at.origin.location,'Aster',date);
  }
});

test('death freezes the entire nested container chain rather than only the first location',()=>{
  const h=world('1720-06-07'),person={tags:['person'],born:'1700-01-01',died:'1720-06-05',whereabouts:'Sea Chest'};
  const text=h.services.OutputHandler.outputWhereabouts('Missing Traveller',person);
  contains(text,'[[Sea Chest]]','[[Loft|Observatory Loft]]','[[Aster]]');
  assert.doesNotMatch(text,/Skylark|Bellport/);
});

test('empty display defaults remove optional lines without showing empty optional punctuation',()=>{
  const h=world(),metadata={tags:['person'],species:'human',name:'Quiet',whereabouts:'Aster',
    displayDefaults:{boxInfo:'<species:s> <(()pronouns())>, <(of )primary>',wHome:'',wOrigin:'',wCurrent:''}};
  const text=h.services.OutputHandler.generateHeader('Quiet',metadata,false);
  assert.doesNotMatch(text,/\(\s*\)|,\s*(?:\n|$)|Based|Currently|Originally/);
  contains(text,'[[Humans|human]]');
});

// Acceptance contracts for fixes in the new core. The original stack is
// characterized separately and remains unchanged.
test('explicit leadership dates do not depend on the current render date',()=>{
  const early=world('1700-01-01'),late=world('1740-01-01');
  const expected='Warden: [[Eve|Warden Eve]]\nWarden: [[Noor|Warden Noor]]';
  assert.equal(late.services.AffiliationManager.getLeadBy('Aster','1720-01-01'),expected);
  assert.equal(early.services.AffiliationManager.getLeadBy('Aster','1720-01-01'),expected);
});

test('secondary residences follow their own start and end dates',()=>{
  const h=world(),person={tags:['person'],born:'1700-01-01',whereabouts:[
    {type:'home',location:'Aster'},
    {type:'secondary',location:'Loft',start:'1710-01-01',end:'1715-12-31'},
    {type:'secondary',location:'Bellport',start:'1716-01-01'},
  ]};
  for(const [date,expected] of [['1709-12-31',null],['1710-01-01','Loft'],['1715-12-31','Loft'],['1716-01-01','Bellport']])
    assert.equal(h.services.WhereaboutsManager.getWhereabouts(person,date).secondary.location,expected,date);
});

test('secondary residence display uses the same death-date clamp as the other whereabouts',()=>{
  const h=world('1720-06-07'),person={tags:['person'],born:'1700-01-01',died:'1720-06-05',whereabouts:[
    {type:'home',location:'Aster'},
    {type:'secondary',location:'Loft',end:'1720-06-05'},
    {type:'secondary',location:'Bellport',start:'1720-06-06'},
  ],displayDefaults:{wSecondary:'Other residence: <secondary:3n>'}};
  assert.equal(h.services.OutputHandler.getWhereaboutsStrings('Traveller',person).secondary,
    'Other residence: the Observatory Loft, Aster, the East County');
});

test('affiliations with different current/past sentences do not collapse into one format',()=>{
  const h=world(),person={tags:['person'],affiliations:[
    {org:'Astronomers',title:'Fellow',start:'1710-01-01',formatCurrent:'Studies at <affiliations:n>',formatPast:'Studied at <affiliations:n>'},
    {org:'Council',title:'Fellow',start:'1710-01-01',formatCurrent:'Advises <affiliations:n>',formatPast:'Advised <affiliations:n>'},
  ]};
  assert.equal(h.services.AffiliationManager.getFormattedNonPrimaryAffiliations(person),
    'Studies at the Astronomers\nAdvises the Learned Council');
});

test('name article overrides retain their meaning when the target note does not exist',()=>{
  const n=world().services.NameManager,overrides={definiteArticle:'the',indefiniteArticle:'a'};
  const known=n.getNameObject('Aster','person',overrides);
  assert.deepEqual([known.definiteArticle,known.indefiniteArticle],['the','a']);
  const missing=n.getNameObject('Unwritten Hamlet','person',overrides);
  assert.deepEqual([missing.definiteArticle,missing.indefiniteArticle],['the','a']);
});

test('a place-only filter reports a header error if excluded objects contain each other',()=>{
  const h=world('1720-01-01',{
    'Objects/Loop A.md':{tags:['object'],whereabouts:'Loop B'},
    'Objects/Loop B.md':{tags:['object'],whereabouts:'Loop A'},
  });
  assert.throws(()=>h.services.WhereaboutsManager.getWhereaboutChain({location:'Loop A'},
    h.services.DateManager.normalizeDate('1720-01-01'),'3L','object'),error=>
      error instanceof HeaderDataError && error.status===422 && error.code==='circular-location-chain' &&
      error.chain.join(',')==='Objects/Loop A.md,Objects/Loop B.md,Objects/Loop A.md');
});

test('cyclic organization parents report a header error instead of a stack overflow',()=>{
  const h=world('1720-01-01',{
    'Groups/Loop A.md':{tags:['group'],partOf:'Loop B'},
    'Groups/Loop B.md':{tags:['group'],partOf:'Loop A'},
  });
  assert.throws(()=>h.services.AffiliationManager.getPartOfs(h.metadata('Loop A'),undefined,'group'),error=>
    error instanceof HeaderDataError && error.status===422 && error.code==='circular-organization-chain');
});

test('circular location detection survives descriptive prefixes and aliases',()=>{
  const h=world('1720-01-01',{
    'Objects/Loop A.md':{tags:['object'],whereabouts:'aboard Crate B'},
    'Objects/Loop B.md':{tags:['object'],aliases:['Crate B'],whereabouts:'stored in Loop A'},
  });
  assert.throws(()=>h.services.WhereaboutsManager.getWhereaboutChain({location:'Loop A'},
    h.services.DateManager.normalizeDate('1720-01-01'),'3L','object'),error=>
      error instanceof HeaderDataError && error.code==='circular-location-chain' &&
      error.chain.join(',')==='Objects/Loop A.md,Objects/Loop B.md,Objects/Loop A.md');
});
