import test from 'node:test';
import assert from 'node:assert/strict';
import {instantiate} from '../src/worker-headers.mjs';
import {headerFixture} from './helpers/legacy-header-fixture.mjs';

// These original query helpers are not called by the new bio block. Exercise
// their existing contracts explicitly, without claiming a real Dataview host.
function withDataview(pages,callback) {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'DataviewAPI');
  globalThis.DataviewAPI={page:target=>pages[target]};
  try{return callback();}
  finally{if(descriptor)Object.defineProperty(globalThis,'DataviewAPI',descriptor);else delete globalThis.DataviewAPI;}
}

test('legacy age, lifecycle and template helpers delegate to the same date and display rules',()=>{
  const h=headerFixture(),u=h.services.util;
  assert.equal(u.age(h.metadata('Example')),7300);assert.equal(u.isAlive(h.metadata('Example')),true);
  assert.equal(u.age(h.metadata('Example'),'1750-01-01'),14600);
  assert.equal(u.isAlive(h.metadata('Example'),'1750-01-01'),false);
  assert.equal(u.s('<home:1n>',h.file('Example')),'the River Town');
  assert.equal(u.s('<home:1n>',h.file('Example'),'1730-01-01'),'Harbor');
});

test('legacy location membership follows ancestors, home, secondary and last-known switches',()=>{
  const h=headerFixture({date:'1730-01-11'}),u=h.services.util,metadata=h.metadata('Example');
  assert.equal(u.inLocation('Old County',metadata,false,false),true);
  assert.equal(u.inLocation('Kingdom',metadata,false,false),true);
  assert.equal(u.homeLocation('New County',metadata,false),true);
  assert.equal(u.inOrHomeLocation('New County',metadata,false),true);
  assert.equal(u.inLocation('Nowhere',metadata,false,false),false);
  assert.equal(u.inLocation('Old County',h.metadata('Example'),false,false,'1750-01-01'),false);
  assert.equal(u.homeLocation('Harbor',metadata,true,'1750-01-01'),true);
  const expired={tags:['person'],whereabouts:[{location:'River Town',start:'1710-01-01',end:'1711-01-01'}]};
  assert.equal(u.inLocation('Old County',expired,false,false),false);
  assert.equal(u.inLocation('Old County',expired,false,true),true);
  assert.equal(u.inLocation('Harbor',{whereabouts:[{type:'secondary',location:'Harbor'}]},false,false),true);
  assert.equal(u.homeLocation('Harbor',{},false),false);
});

test('legacy location accessors and link existence return stable empty and populated values',()=>{
  const h=headerFixture(),u=h.services.util;
  assert.equal(u.originExists(h.metadata('Example')),true);assert.equal(u.originExists({}),false);
  assert.equal(u.currentLocation(h.metadata('Example')),'River Town');assert.equal(u.currentLocation({}),undefined);
  assert.equal(u.originLocation(h.metadata('Example')),'River Town');assert.equal(u.originLocation({}),false);
  assert.equal(u.isLinked('River Town'),true);assert.equal(u.isLinked('Port'),true);
  assert.equal(u.isLinked('Missing'),false);assert.equal(u.isLinked(undefined),true);
});

test('legacy affiliation wrappers preserve explicit date handling',()=>{
  const h=headerFixture(),u=h.services.util;
  const file={frontmatter:{tags:['person'],affiliations:[{org:'Guild',start:'1710-01-01',end:'1715-01-01'}]}};
  assert.equal(u.isAffiliated('Guild',file),false);assert.equal(u.isOrWasAffiliated('Guild',file),true);
  assert.equal(u.isAffiliated('Guild',file,'1712-01-01'),true);
  assert.equal(u.isOrWasAffiliated('Guild',file,'1700-01-01'),false);
});

test('legacy person links consider inlinks for people, and only outlinks for places',()=>{
  const u=headerFixture().services.util,target={link:'Example'};
  assert.equal(u.isLinkedToPerson({frontmatter:{tags:['person']},inlinks:['Example']},target),true);
  assert.equal(u.isLinkedToPerson({frontmatter:{tags:['place']},inlinks:['Example']},target),false);
  assert.equal(u.isLinkedToPerson({frontmatter:{tags:['place']},outlinks:['Example']},target),true);
  assert.equal(u.isLinkedToPerson({frontmatter:{}},target),false);
});

test('legacy party knowledge can use explicit encounters, allowed tags or session backlinks',()=>{
  const u=headerFixture().services.util;
  assert.equal(u.isKnownToParty('Example',{campaignInfo:[{campaign:'TEST'}]},'test',false,false),true);
  assert.equal(u.isKnownToParty('Example',{tags:['test-known']},'test',true,false),true);
  for(const tag of ['test-unknown','test-unaware','test-unsorted'])assert.equal(u.isKnownToParty('Example',{tags:[tag]},'test',true,false),false);
  assert.equal(u.isKnownToParty('Example',{tags:['test-known']},'test',false,false),false);
  withDataview({Example:{file:{inlinks:[{path:'Campaigns/Test/Sessions/1.md'}]}}},()=>{
    assert.equal(u.isKnownToParty('Example',{},'test',false,true),true);
    assert.equal(u.isKnownToParty('Example',{},'other',false,true),false);
  });
});

test('legacy campaign interactions sort sessions, show aliases, filter noise and flag missing knowledge',()=>{
  const h=headerFixture(),session=(name,date,folder,extra={})=>({tags:['session-note'],DR:date,
    file:{name,path:folder+'/'+name+'.md'},...extra});
  const pages={
    late:session('Third','1725-01-01','Campaigns/Test/Sessions'),
    first:session('First','1710-01-01','Campaigns/Test/Sessions',{descTitle:'Opening'}),
    middle:session('Second','1720-01-01','Campaigns/Test/Sessions'),
    other:session('Other','1715-01-01','Campaigns/Other/Episodes'),
    noise:{tags:['person'],file:{name:'Noise',path:'People/Noise.md'}},
  };
  const page={knownTo:['other'],file:{inlinks:['late',{path:'first'},'noise','missing','other','middle']}};
  withDataview(pages,()=>{
    const all=h.services.OutputHandler.outputCampaignInteractions('Example',page);
    assert.match(all,/### \[\[Party\]\]/);assert.match(all,/Suggested knownTo: test/);
    assert.doesNotMatch(all,/Suggested knownTo: other|Noise|missing/);
    assert.match(all,/First encountered: \[\[First\|Opening\]\]/);
    assert.match(all,/Most recent encounter: \[\[Third\]\]/);assert.match(all,/Other mentions:\n- \[\[Second\]\]/);
    const filtered=h.services.OutputHandler.outputCampaignInteractions('Example',page,'TC');
    assert.doesNotMatch(filtered,/### other|\[\[Other\]\]/);
    assert.equal(h.services.OutputHandler.outputCampaignInteractions('Example',page,'unknown'),'_No session-note links found._');
    assert.equal(h.services.OutputHandler.outputCampaignInteractions('Example',{file:{inlinks:[]}}),'_No session-note links found._');
  });
});

test('the original metadata loader reads the configured folder and normalizes campaign identity',async()=>{
  const h=headerFixture(),services={state:{}},reads=[];
  instantiate({customJS:services,app:{vault:{configDir:'.custom',adapter:{async read(file){
    reads.push(file);return JSON.stringify(file.endsWith('metadata.json')?h.input.coreMeta:h.input.registry);
  }}}}});
  await services.init.invoke();
  assert.deepEqual(reads,['.custom/metadata.json','_scripts/session_note_campaigns.json']);
  assert.equal(services.state.coreMeta.campaigns[0].code,'test');
  assert.equal(services.state.campaignRegistry[0].sessionNoteFolder,'Campaigns/Test/Sessions');
});
