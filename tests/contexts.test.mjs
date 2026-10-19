import test from 'node:test';
import assert from 'node:assert/strict';
import {Contexts} from '../src/contexts.mjs';
import {siteHeader} from '../src/header.mjs';
import {load} from 'cheerio';

const registry = {campaigns:{
  'first-campaign':{code:'one',name:'First Campaign',aliases:['First']},
  'second-campaign':{code:'two',name:'Second Campaign',aliases:[]},
  'undated-campaign':{code:'none',name:'Undated Campaign',aliases:[]},
}};
const settings = {default_date:'1750-01-01',campaigns:['one','two']};
const page = (id,metadata) => ({id,note:{metadata}});
const session = (campaign,fields) => page(campaign + '-' + (fields.sessionNumber || fields.DR),{campaign,tags:['session-note'],...fields});
const catalogue = entries => new Contexts({entries},registry,settings);
test('campaigns use DR_end from latest played session; Modern follows latest campaign',() => {
  const contexts = catalogue([
    session('First',{sessionNumber:1,realWorldDate:'2025-01-01',DR:'1740-01-01',DR_end:'1740-01-03'}),
    session('one',{sessionNumber:2,realWorldDate:'2025-02-01',DR:'1730-01-01',DR_end:'1730-01-02'}),
    session('Second Campaign',{sessionNumber:1,DR:'1735-06-01',DR_end:'1735-06-03'}),
  ]);
  assert.equal(contexts.resolve('first-campaign').date,'1730-01-02');
  assert.equal(contexts.resolve('modern').date,'1735-06-03');
  assert.equal(contexts.resolve('modern').dateSource,'latest-campaign');
  assert.deepEqual(contexts.resolve('first-campaign').campaigns,['one']);
});
test('missing played dates fall back to session number and then DR ordering',() => {
  const contexts = catalogue([
    session('one',{sessionNumber:9,DR:'1710-01-01'}),
    session('one',{sessionNumber:10,DR:'1700-01-01'}),
    session('two',{DR:'1720-01-01'}),
    session('two',{DR:'1722-01-01'}),
  ]);
  assert.equal(contexts.resolve('first-campaign').date,'1700-01-01');
  assert.equal(contexts.resolve('second-campaign').date,'1722-01-01');
});
test('undated latest sessions disable preset instead of inventing date',() => {
  const contexts = catalogue([
    session('none',{sessionNumber:1,DR:'1720-01-01'}),
    session('none',{sessionNumber:2,DR:'unknown',DR_end:null}),
  ]);
  assert.equal(contexts.list().find(c=>c.id==='undated-campaign').available,false);
  assert.throws(()=>contexts.resolve('undated-campaign'),{status:400});
  assert.equal(contexts.resolve('modern').date,'1750-01-01');
  assert.equal(contexts.resolve('modern').dateSource,'configured-fallback');
});
test('only session notes supply campaign dates',() => {
  const contexts = catalogue([
    page('Campaigns/First.md',{tags:['meta'],campaign:'one',DR:'1800-01-01',DR_end:'1801-01-01',realWorldDate:'2099-01-01'}),
    session('one',{sessionNumber:1,DR:'1720-05-06'}),
  ]);
  assert.equal(contexts.resolve('first-campaign').date,'1720-05-06');
  assert.equal(contexts.resolve('first-campaign').label,'First Campaign');
  assert.equal(contexts.resolve('first-campaign').source,'one-1');
  assert.equal(contexts.resolve('modern').date,'1720-05-06');
});

test('session exclusions apply to their own campaign before selecting its date and source',()=>{
  const contexts=catalogue([
    session('one',{sessionNumber:1,DR:'1720-01-01',excludePublish:['two']}),
    session('one',{sessionNumber:2,DR:'1800-01-01',excludePublish:'all'}),
    session('one',{sessionNumber:3,DR:'1801-01-01',excludePublish:['ONE']}),
    session('two',{sessionNumber:1,DR:'1730-01-01',excludePublish:['one']}),
  ]);
  assert.equal(contexts.resolve('first-campaign').date,'1720-01-01');
  assert.equal(contexts.resolve('first-campaign').source,'one-1');
  assert.equal(contexts.resolve('second-campaign').date,'1730-01-01');
  assert.equal(contexts.resolve('modern').source,'two-1');
});
test('date-only URLs remain Custom; presets reject mismatched overrides',() => {
  const contexts = catalogue([session('one',{DR:'1720-01-01'})]);
  assert.equal(contexts.resolve(undefined,'1730-01-01').id,'custom');
  assert.equal(contexts.resolve('custom').date,'1720-01-01');
  assert.throws(()=>contexts.resolve('first-campaign','1730-01-01'),{status:400});
  assert.throws(()=>contexts.resolve('missing'),{status:400});
  assert.throws(()=>contexts.resolve('custom','1720-02-29'),{status:400});
});
test('Modern and Custom have no campaign selection, including date-only requests',() => {
  const contexts = catalogue([session('one',{DR:'1720-01-01'})]);
  assert.deepEqual(contexts.resolve('modern').campaigns,[]);
  assert.deepEqual(contexts.resolve('custom','1730-01-01').campaigns,[]);
  assert.deepEqual(contexts.resolve(undefined,'1730-01-01').campaigns,[]);
  assert.deepEqual(contexts.resolve('first-campaign').campaigns,['one']);
});
test('header shows selector and hides/disables date input except Custom',() => {
  const contexts = catalogue([session('one',{DR:'1720-01-01'})]);
  for (const id of ['modern','first-campaign','custom']) {
    const context = contexts.resolve(id), $ = load(siteHeader(context,contexts.list()),{},false);
    assert.equal($('header .site-brand').text(),'TaelgarVerse');
    assert.equal($('header select option[selected]').val(),id);
    assert.equal($('#context-date').attr('type'),'date');
    assert.equal($('[data-custom-date]').is('[hidden]'),id!=='custom');
    assert.equal($('#context-date').is('[disabled]'),id!=='custom');
  }
});
