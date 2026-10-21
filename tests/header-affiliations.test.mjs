import test from 'node:test';
import assert from 'node:assert/strict';
import {headerFixture} from './helpers/header-fixture.mjs';
import {normalizeCampaignRegistry} from '../src/header-core/index.mjs';

test('affiliations normalize string memberships, leadership place aliases and inherited lifecycle bounds',()=>{
  const a=headerFixture().services.AffiliationManager;
  const metadata={tags:['person'],title:'Warden',born:'1700-01-01',died:'1740-01-01',
    leaderOf:[{place:'River Town'}],affiliations:['Guild']};
  const result=a.getAffiliations(metadata);
  assert.deepEqual(result.map(x=>[x.org,x.type,x.title]),[['River Town','leader','Warden'],['Guild','member','member']]);
  assert.equal(result[0].startDate.year,1);assert.equal(result[1].endDate.year,1740);
});

test('leadership can inherit reignStart and future affiliations stay out of the current list',()=>{
  const a=headerFixture().services.AffiliationManager;
  const result=a.getAffiliations({tags:['person'],reignStart:'1710-01-01',
    leaderOf:[{place:'River Town'}],affiliations:[{org:'Guild',start:'1730-01-01'}]});
  assert.equal(result.length,1);assert.equal(result[0].startDate.display,'January 1st, 1710');
});

for(const [date,active,ever] of [
  ['1709-12-31',false,false],['1710-01-01',true,true],['1720-01-01',true,true],
  ['1730-01-01',true,true],['1730-01-02',false,true],
])test('membership boundaries at '+date,()=>{
  const h=headerFixture({date}),a=h.services.AffiliationManager;
  const metadata={tags:['person'],affiliations:[{org:'Guild',start:'1710-01-01',end:'1730-01-01'}]};
  const at=h.services.DateManager.normalizeDate(date);
  assert.equal(a.isAffiliated('Guild',metadata,at),active);assert.equal(a.isOrWasAffiliated('Guild',metadata,at),ever);
});

test('primary affiliations are separated from other memberships and displayed with natural list joining',()=>{
  const a=headerFixture().services.AffiliationManager;
  const metadata={tags:['person'],affiliations:[{org:'Guild',type:'primary'},
    {org:'Federation',title:'member'},{org:'Council',title:'member'},{org:'Party',title:'member'}]};
  assert.deepEqual(a.getPrimaryAffiliations(metadata).map(x=>x.org),['Guild']);
  assert.deepEqual(a.getNonPrimaryAffiliations(metadata).map(x=>x.org),['Federation','Council','Party']);
  assert.equal(a.getFormattedNonPrimaryAffiliations(metadata),
    'Member of the [[Federation|Guild Federation]], the [[Council|High Council]], and the [[Party|Fixture Party]]');
});

test('affiliation formats distinguish current, former, bounded and custom labels',()=>{
  const h=headerFixture(),a=h.services.AffiliationManager;
  for(const [fields,expected] of [
    [{start:'1710-01-01'},'Member of the [[Guild|Glass Guild]] (since January 1st, 1710)'],
    [{end:'1710-01-01'},'Member of the [[Guild|Glass Guild]] (until January 1st, 1710)'],
    [{start:'1700-01-01',end:'1710-01-01'},'Member of the [[Guild|Glass Guild]] (January 1st, 1700 - January 1st, 1710)'],
    [{formatCurrent:'Current <affiliations:n>',formatPast:'Former <affiliations:n>',start:'1710-01-01'},'Current the Glass Guild'],
    [{formatCurrent:'Current <affiliations:n>',formatPast:'Former <affiliations:n>',end:'1710-01-01'},'Former the Glass Guild'],
    [{format:''},''],
  ])assert.equal(a.getFormattedNonPrimaryAffiliations({tags:['person'],affiliations:[{org:'Guild',...fields}]}),expected);
});

test('a custom affiliation sentence retains its member names',()=>{
  const a=headerFixture().services.AffiliationManager;
  assert.equal(a.getFormattedNonPrimaryAffiliations({tags:['person'],affiliations:[{org:'Guild',format:'Special <affiliations:n>'}]}),
    'Special the Glass Guild');
});

for(const [date,expected] of [
  ['1719-12-31','Steward: [[Earlier Mayor]] (since January 1st, 1700)'],
  ['1720-01-01','Mayor: [[Leader|Mayor Morgan]] (since January 1st, 1720)'],
  ['1729-12-31','Mayor: [[Leader|Mayor Morgan]] (since January 1st, 1720)'],
  ['1730-01-01',''],
])test('leadership succession at '+date,()=>{
  assert.equal(headerFixture({date}).services.AffiliationManager.getLeadBy('River Town'),expected);
});

test('campaign registries normalize identities and derived session folders and reject malformed entries',()=>{
  const h=headerFixture(),n=h.services.NameManager;
  for(const key of ['TC','test','Test Campaign','test-campaign'])assert.equal(n.getCampaignConfig(key).code,'test');
  assert.equal(n.getCampaignPartyPage('tc'),'Party');
  assert.equal(n.getCampaignSessionNoteFolder('test'),'Campaigns/Test/Sessions');
  assert.equal(n.getCampaignConfig('missing'),undefined);
  assert.throws(()=>normalizeCampaignRegistry({}),/campaigns object/);
  assert.throws(()=>normalizeCampaignRegistry({campaigns:{bad:{name:'Missing code'}}}),/name and code/);
  assert.throws(()=>normalizeCampaignRegistry({campaigns:{a:{name:'A',code:'x'},b:{name:'B',code:'X'}}}),/duplicated/);
});

test('party encounters use the location on the encounter date and honor campaign and person overrides',()=>{
  const h=headerFixture({date:'1730-01-01'}),e=h.services.EventManager;
  const file=h.file('Example');file.frontmatter={...file.frontmatter,campaignInfo:[
    {campaign:'test',date:'1710-06-15',type:'met'},
    {campaign:'other',date:'1725-01-01',person:'Guild',format:'Encounter <person:n> <current:1n>'},
    {campaign:'test'},
  ]};
  const result=e.getPartyMeeting(file);
  assert.equal(result.length,2);assert.equal(result[0].location,'River Town');
  assert.match(result[0].text,/Met.*Fixture Party.*June 15th, 1710.*River Town/);
  assert.equal(result[1].text,'Encounter the Glass Guild Harbor');
  assert.equal(e.getPartyMeeting(file,'test').length,1);assert.equal(e.getPartyMeeting(file,'missing').length,0);
  assert.equal(e.getPartyMeeting({frontmatter:{campaignInfo:{campaign:'test',date:'1710-06-15'}}}).length,1);
});
