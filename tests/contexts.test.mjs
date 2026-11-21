import test from 'node:test';
import assert from 'node:assert/strict';
import {Contexts} from '../src/contexts.mjs';
import {noteCampaignResolver} from '../src/campaign-ownership.mjs';
import {siteHeader,contextQuery} from '../src/header.mjs';
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
test('campaign directory defaults depend on the note type',() => {
  const resolver=noteCampaignResolver({campaigns:{
    one:{code:'one',name:'One',campaignRoot:'Campaigns/One'},
    two:{code:'two',name:'Second Campaign',campaignRoot:'Campaigns/One/Two'},
  }});
  const cases=[
    ['Campaigns/One/Recap.md',{tags:['session-note'],knownTo:['two']},'one',[],'one'],
    ['Campaigns/One/Story.md',{tags:['story'],knownTo:['two']},'one',[],'one'],
    ['Campaigns/One/Index.md',{tags:['meta'],knownTo:['two']},'one',[],'one'],
    ['Campaigns/One/Transcript.md',{tags:['source']},'one',[],'one'],
    ['Campaigns/One/Letter.md',{tags:['source'],knownTo:['two']},'one',['two'],'one'],
    ['Sources/Letter.md',{tags:['primary-source'],campaign:'Second Campaign',knownTo:['one']},'two',['one'],undefined],
    ['Campaigns/One/Treasure.md',{tags:['status/check/ai','item/weapon'],knownTo:['two','one','ONE','unknown']},undefined,['two','one'],'one'],
    ['Campaigns/One/Two/Keep.md',{tags:['place'],knownTo:[]},undefined,['two'],'two'],
    ['Campaigns/One/Vision.md',{tags:['event'],knownTo:[]},undefined,['one'],'one'],
    ['Campaigns/One/Lore.md',{tags:['background'],knownTo:['two']},undefined,['two'],'one'],
    ['Campaigns/One/Untyped.md',{},undefined,[],'one'],
    ['Campaigns/One More/Unassigned.md',{tags:['session-note']},undefined,[],undefined],
  ];
  for (const [path,metadata,campaign,knownTo,folderCampaign] of cases) {
    const resolved=resolver.resolve(path,metadata);
    assert.deepEqual([resolved.campaign,resolved.knownTo,resolved.folderCampaign],[campaign,knownTo,folderCampaign],path);
  }
});

test('session dates inherit the directory while resolving explicit IDs against the full registry',() => {
  const campaigns={campaigns:{
    one:{code:'one',name:'One',campaignRoot:'Campaigns/One'},
    two:{code:'two',name:'Two',websiteSelectable:false},
  }};
  const entries=[
    page('Campaigns/One/Session 1.md',{tags:['session-note'],sessionNumber:1,DR:'1720-01-01'}),
    page('Campaigns/One/Session 2.md',{tags:['session-note'],campaign:'unknown',sessionNumber:2,DR:'1721-01-01'}),
    page('Campaigns/One/Session 3.md',{tags:['session-note'],campaign:'Two',sessionNumber:3,DR:'1722-01-01'}),
  ];
  const website=Contexts.forWebsite({entries},campaigns,settings);
  assert.equal(website.resolve('one').source,entries[1].id);
  assert.equal(website.resolve('one').date,'1721-01-01');
  assert.throws(()=>website.resolve('custom',undefined,['Two']),{status:400});
  const local=new Contexts({entries},campaigns,settings);
  assert.equal(local.resolve('two').source,entries[2].id);
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

test('retired excludePublish does not affect latest-session selection',()=>{
  const contexts=catalogue([
    session('one',{sessionNumber:1,DR:'1720-01-01',excludePublish:['two']}),
    session('one',{sessionNumber:2,DR:'1800-01-01',excludePublish:'all'}),
    session('one',{sessionNumber:3,DR:'1801-01-01',excludePublish:['ONE']}),
    session('two',{sessionNumber:1,DR:'1730-01-01',excludePublish:['one']}),
  ]);
  assert.equal(contexts.resolve('first-campaign').date,'1801-01-01');
  assert.equal(contexts.resolve('first-campaign').source,'one-3');
  assert.equal(contexts.resolve('second-campaign').date,'1730-01-01');
  assert.equal(contexts.resolve('modern').source,'one-3');
});
test('date-only URLs remain Custom; presets reject mismatched overrides',() => {
  const contexts = catalogue([session('one',{DR:'1720-01-01'})]);
  assert.equal(contexts.resolve(undefined,'1730-01-01').id,'custom');
  assert.equal(contexts.resolve('custom').date,'1720-01-01');
  assert.throws(()=>contexts.resolve('first-campaign','1730-01-01'),{status:400});
  assert.throws(()=>contexts.resolve('missing'),{status:400});
  assert.throws(()=>contexts.resolve('custom','1720-02-29'),{status:400});
});
test('Modern and legacy Custom/date-only requests retain no campaign selection',() => {
  const contexts = catalogue([session('one',{DR:'1720-01-01'})]);
  assert.deepEqual(contexts.resolve('modern').campaigns,[]);
  assert.deepEqual(contexts.resolve('custom','1730-01-01').campaigns,[]);
  assert.deepEqual(contexts.resolve(undefined,'1730-01-01').campaigns,[]);
  assert.deepEqual(contexts.resolve('first-campaign').campaigns,['one']);
});

test('Custom selects all campaigns, a normalized subset, or none without changing preset dates',() => {
  const contexts = catalogue([session('one',{DR:'1720-01-01'})]);
  const all = contexts.resolve('custom','1730-01-01','all');
  assert.deepEqual(all.campaigns,['none','one','two']); // Includes undated presets.
  assert.equal(all.allCampaigns,true);
  assert.equal(contextQuery(all).get('campaigns'),'all');
  const subset = contexts.resolve('custom','1730-01-01',['','SECOND-CAMPAIGN,First','one']);
  assert.deepEqual(subset.campaigns,['one','two']);
  assert.equal(contextQuery(subset).get('campaigns'),'one,two');
  assert.deepEqual(contexts.resolve('custom','1730-01-01','').campaigns,[]);
  assert.equal(contexts.resolve(undefined,undefined,'all').kind,'custom');
  assert.throws(()=>contexts.resolve('custom',undefined,'unknown'),{status:400});
  assert.throws(()=>contexts.resolve('modern',undefined,'all'),{status:400});
  assert.throws(()=>contexts.resolve('first-campaign',undefined,'two'),{status:400});
  assert.deepEqual(contexts.resolve('modern').campaigns,[]);
  assert.deepEqual(contexts.resolve('first-campaign').campaigns,['one']);
});

test('Custom header preserves campaign checkboxes and offers undated campaigns; new Custom selections start with all',() => {
  const contexts = catalogue([session('one',{DR:'1720-01-01'})]);
  for (const [selection,count,all] of [['all',3,true],['one',1,false],['',0,false]]) {
    const ctx = contexts.resolve('custom','1730-01-01',selection), $ = load(siteHeader(ctx,contexts.list()),{},false);
    assert.equal($('[data-campaign-choice]:checked').length,count);
    assert.equal($('[data-campaign-all]').is(':checked'),all);
    assert.equal($('[data-campaign-choice][value=none]').is(':disabled'),false);
    assert.equal($('[data-campaign-picker] input:disabled').length,0);
    assert.equal(new URL($('.site-brand').attr('href'),'https://example.test').searchParams.get('campaigns'),selection || null);
  }
  const $ = load(siteHeader(contexts.resolve('modern'),contexts.list()),{},false);
  assert.equal($('[data-campaign-all]').is(':checked'),true);
  assert.equal($('[data-campaign-choice]:checked').length,3);
  assert.equal($('[data-campaign-picker] input:not(:disabled)').length,0);
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

test('campaign bookmarks use current IDs and reject retired spellings', () => {
  const registry = {campaigns:{
    dufr:{code:'dufr',name:'Dunmari Frontier Campaign'},
    chasm:{code:'chasm',name:'Into the Chasm'},
    dragonets:{code:'dragonets',name:'Dragonets'},
  }};
  const contexts = new Contexts({entries:[session('dufr',{DR:'1748-01-01'})]},registry,settings);
  assert.equal(contexts.resolve('dufr').id,'dufr');
  assert.throws(()=>contexts.resolve('dunmar-frontier'),{status:400});
  assert.deepEqual(contexts.resolve('custom','1748-01-01','dufr,chasm,dragonets').campaigns,
    ['chasm','dragonets','dufr']);
  for (const retired of ['dunmar-frontier','Dunmar Frontier','itc','dgnt']) {
    assert.throws(()=>contexts.resolve('custom','1748-01-01',retired),{status:400});
  }
});
