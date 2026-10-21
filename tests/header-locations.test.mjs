import test from 'node:test';
import assert from 'node:assert/strict';
import {headerFixture} from './helpers/header-fixture.mjs';

test('locations normalize scalar homes, legacy primary/place/region fields and place partOf',()=>{
  const w=headerFixture().services.WhereaboutsManager;
  assert.equal(w.getWhereaboutsList({whereabouts:'River Town'})[0].type,'home');
  assert.equal(w.getWhereaboutsList({whereabouts:[{type:'primary',place:'River Town',region:'Old County'}]})[0].location,'River Town, Old County');
  assert.equal(w.getWhereaboutsList({tags:['place'],partOf:'Old County'})[0].location,'Old County');
  assert.equal(w.getWhereaboutsList({tags:['person'],partOf:'Guild'}).length,0);
  assert.equal(w.getWhereaboutsList({whereabouts:[{location:'  '}]})[0].location,null);
});

for(const [date,home,current] of [
  ['1720-12-31','River Town','River Town'],['1721-01-01','Harbor','Harbor'],
  ['1730-01-09','Harbor','Harbor'],['1730-01-10','Harbor','Old County'],
  ['1730-01-12','Harbor','Old County'],['1730-01-13','Harbor','Harbor'],
])test('home and travel boundaries at '+date,()=>{
  const h=headerFixture({date}),actual=h.services.WhereaboutsManager.getWhereabouts(h.metadata('Example'));
  assert.equal(actual.home.location,home);assert.equal(actual.current.location,current);
  assert.equal(actual.origin.location,'River Town');
});

test('expired travel retains the last known location while an explicit unknown location stays unknown',()=>{
  const w=headerFixture({date:'1720-01-05'}).services.WhereaboutsManager;
  const actual=w.getWhereabouts({whereabouts:[{location:'Harbor',start:'1720-01-01',end:'1720-01-03'}]});
  assert.equal(actual.current.location,null);assert.equal(actual.lastKnown.location,'Harbor');
  const unknown=w.getWhereabouts({whereabouts:[{type:'home',location:'Harbor'},{start:'1720-01-04',location:null}]});
  assert.equal(unknown.home.location,'Harbor');assert.equal(unknown.current.location,null);
  assert.equal(unknown.lastKnown.location,'Harbor');
});

test('secondary locations do not replace the primary home or current location',()=>{
  const w=headerFixture().services.WhereaboutsManager;
  const actual=w.getWhereabouts({whereabouts:[{type:'home',location:'River Town'},{type:'secondary',location:'Harbor'}]});
  assert.equal(actual.home.location,'River Town');assert.equal(actual.current.location,'River Town');
  assert.equal(actual.secondary.location,'Harbor');
});

test('ties use the first home for origin and last listed home for current residence',()=>{
  const w=headerFixture().services.WhereaboutsManager;
  const actual=w.getWhereabouts({whereabouts:[{type:'home',location:'River Town'},{type:'home',location:'Harbor'}]});
  assert.equal(actual.origin.location,'River Town');assert.equal(actual.home.location,'Harbor');
  assert.equal(actual.current.location,'Harbor');
});

test('location chains preserve nesting, depth limits, prepositions and region filters',()=>{
  const h=headerFixture(),format=template=>h.services.TokenParser.formatDisplayString(template,h.file('Example'));
  assert.equal(format('<home:3Frq>'),'in the [[River Town]], the [[Old County]], the [[Kingdom|Green Kingdom]]');
  assert.equal(format('<home:1n>'),'the River Town');
  assert.equal(format('<home:3n>'),'the River Town, the Old County, the Green Kingdom');
  const home=h.services.WhereaboutsManager.getWhereabouts(h.metadata('Example')).home;
  const chain=h.services.WhereaboutsManager.getWhereaboutChain(home,h.services.DateManager.normalizeDate('1720-01-01'),'2-3','person');
  assert.deepEqual(chain.map(item=>item.name.name),['Old County','Green Kingdom']);
  assert.equal(format('<home:Rn>'),'the Wide Region');
  assert.equal(format('<home:fn>'),'the Old County, the Green Kingdom, the Wide Region');
});

test('template range filters preserve numeric order',()=>{
  const h=headerFixture();
  assert.equal(h.services.TokenParser.formatDisplayString('<home:2-3n>',h.file('Example')),'the Old County, the Green Kingdom');
});

test('unknown locations remain readable and do not invent links or ancestry',()=>{
  const h=headerFixture();
  const file={name:'Example',frontmatter:{tags:['person'],whereabouts:'Missing Hamlet'}};
  const actual=h.services.TokenParser.formatDisplayString('<home:3Frq>',file);
  assert.equal(actual,'the Missing Hamlet');assert.doesNotMatch(actual,/\[\[|Old County|Kingdom/);
});

test('dead people keep whereabouts at death rather than a later location entry',()=>{
  const h=headerFixture({date:'1750-01-01'});
  const metadata={...h.metadata('Example'),whereabouts:[
    {type:'home',location:'River Town',end:'1740-12-31'},
    {type:'home',location:'Harbor',start:'1741-01-01'},
  ]};
  const output=h.services.OutputHandler.getWhereaboutsStrings('Example',metadata);
  assert.match(output.home,/Lived in the \[\[River Town\]\]/);assert.doesNotMatch(output.home,/Harbor/);
});

test('per-entry format overrides and secondary location text survive rendering',()=>{
  const h=headerFixture();
  const metadata={tags:['person'],whereabouts:[{type:'home',location:'Harbor',homeFormat:'Residence: <home:1n>'},
    {type:'secondary',location:'Old County',secondaryFormat:'Also <secondary:1n>'}],displayDefaults:{wSecondary:'Other: <secondary:1n>'}};
  const output=h.services.OutputHandler.outputWhereabouts('Example',metadata);
  assert.match(output,/Residence: Harbor/);assert.match(output,/Other: the Old County/);
});

for(const [filter,names] of [
  ['P',['Carrier']],['I',['Container']],['O',['Glass Guild']],
  ['L',['River Town','Old County','Green Kingdom','Wide Region']],
  ['l',['Carrier','Container','Glass Guild']],
  ['p',['Container','Glass Guild','River Town','Old County','Green Kingdom','Wide Region']],
  ['i',['Carrier','Glass Guild','River Town','Old County','Green Kingdom','Wide Region']],
  ['o',['Carrier','Container','River Town','Old County','Green Kingdom','Wide Region']],
])test('location chain type filter '+filter,()=>{
  const h=headerFixture({extraNotes:{
    'People/Carrier.md':{tags:['person'],whereabouts:'Container'},
    'Objects/Container.md':{tags:['object'],whereabouts:'Guild'},
  }});
  const chain=h.services.WhereaboutsManager.getWhereaboutChain({location:'Carrier'},
    h.services.DateManager.normalizeDate('1720-01-01'),filter,'person');
  assert.deepEqual(chain.map(item=>item.name.name),names);
});

test('last-known chains follow the location ancestry as of the last sighting, not the current date',()=>{
  const h=headerFixture({extraNotes:{'Moving House.md':{tags:['place'],name:'Moving House',whereabouts:[
    {type:'home',location:'Old County',end:'1715-12-31'},
    {type:'home',location:'New County',start:'1716-01-01'},
  ]}}});
  const file={name:'Example',frontmatter:{tags:['person'],whereabouts:[{location:'Moving House',start:'1710-01-01',end:'1711-01-01'}]}};
  assert.equal(h.services.TokenParser.formatDisplayString('<lastknown:3n>',file,h.services.DateManager.normalizeDate('1720-01-01')),
    'the Moving House, the Old County, the Green Kingdom');
});
