import test from 'node:test';
import assert from 'node:assert/strict';
import {headerFixture} from './helpers/legacy-header-fixture.mjs';

// Characterize the original defects without correcting the current stack.
// The desired behavior is tested as ordinary acceptance tests against the new core.
test('legacy calendar objects still reproduce the missing-month defect',()=>{
  assert.equal(Number.isNaN(headerFixture().services.DateManager.normalizeDate({year:1720},true).days),true);
});
test('legacy numeric ranges still reproduce reordered filter digits',()=>{
  const h=headerFixture();
  assert.equal(h.services.TokenParser.formatDisplayString('<home:2-3n>',h.file('Example')),
    'the River Town, the Old County, the Green Kingdom, the Wide Region');
});
test('legacy custom affiliation sentences still reproduce duplicated text',()=>{
  const a=headerFixture().services.AffiliationManager;
  assert.equal(a.getFormattedNonPrimaryAffiliations({tags:['person'],affiliations:[{org:'Guild',format:'Special <affiliations:n>'}]}),'Special Special');
});
test('legacy explicit leadership dates still depend on the override date',()=>{
  assert.equal(headerFixture({date:'1700-01-01'}).services.AffiliationManager.getLeadBy('River Town','1725-01-01'),'');
  assert.match(headerFixture({date:'1740-01-01'}).services.AffiliationManager.getLeadBy('River Town','1725-01-01'),/Mayor Morgan/);
});
test('legacy secondary residences are still selected at the origin date',()=>{
  const h=headerFixture({date:'1720-01-01'}),person={born:'1700-01-01',whereabouts:[
    {type:'secondary',location:'Harbor',start:'1710-01-01'},
  ]};
  assert.equal(h.services.WhereaboutsManager.getWhereabouts(person).secondary.location,null);
});
test('legacy grouping still merges different affiliation sentences',()=>{
  const a=headerFixture().services.AffiliationManager;
  assert.equal(a.getFormattedNonPrimaryAffiliations({tags:['person'],affiliations:[
    {org:'Guild',start:'1710-01-01',formatCurrent:'Studies at <affiliations:n>',formatPast:'Studied at <affiliations:n>'},
    {org:'Council',start:'1710-01-01',formatCurrent:'Advises <affiliations:n>',formatPast:'Advised <affiliations:n>'},
  ]}),'Studies at the Glass Guild, and the High Council');
});
test('legacy unresolved names still swap article overrides',()=>{
  const name=headerFixture().services.NameManager.getNameObject('Unwritten Hamlet','person',{definiteArticle:'the',indefiniteArticle:'a'});
  assert.deepEqual([name.definiteArticle,name.indefiniteArticle],['a','the']);
});
test('legacy excluded location cycles still overflow the stack',()=>{
  const h=headerFixture({extraNotes:{
    'Objects/Loop A.md':{tags:['object'],whereabouts:'Loop B'},'Objects/Loop B.md':{tags:['object'],whereabouts:'Loop A'},
  }});
  assert.throws(()=>h.services.WhereaboutsManager.getWhereaboutChain({location:'Loop A'},
    h.services.DateManager.normalizeDate('1720-01-01'),'3L','object'),RangeError);
});
test('legacy organization cycles still overflow the stack',()=>{
  const h=headerFixture({extraNotes:{
    'Groups/Loop A.md':{tags:['group'],partOf:'Loop B'},'Groups/Loop B.md':{tags:['group'],partOf:'Loop A'},
  }});
  assert.throws(()=>h.services.AffiliationManager.getPartOfs(h.metadata('Loop A'),undefined,'group'),RangeError);
});
