import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {targetPath} from '../src/common.mjs';
import {buildBacklinkIndex} from '../src/backlinks.mjs';
import {compileInteractionIndex,campaignInteractions,interactionDate} from '../src/campaign-interactions.mjs';
import {parseSessionRecap,readInteractionBundles} from '../src/session-interactions.mjs';
import {interactionSummary,interactionView} from '../src/interaction-view.mjs';
import {groupInteractions,interactionDay} from '../src/browser/interaction-groups.mjs';
import {mountInteractions} from '../src/browser/interactions.mjs';
import {RenderEngine,document} from '../src/render-engine.mjs';
import {ROOT,isInside} from '../src/config.mjs';

const registry={campaigns:{cleenseau:{code:'clee',name:'Cleenseau',aliases:['Clee'],campaignRoot:'Campaigns/Clee'},mawar:{code:'mawar',name:'Mawar Adventures',campaignRoot:'Campaigns/Mawar'}}};
function storeFor(notes){return new ContentStore(Object.entries(notes).map(([id,source])=>{
  const note=parseNote(source),target=targetPath(id);return {id,note,target,slug:target.slice(0,-3),name:path.posix.basename(id,'.md'),title:note.metadata.name || path.posix.basename(id,'.md')};
}));}
const context=(date='1720-01-05',campaigns=['clee'],dm=false)=>({id:'custom',kind:'custom',date,campaigns,dm});
const person='---\ntags: [person]\nknownTo: [clee]\ncampaignInfo: [{campaign: clee, date: 1720-01-01, type: Fought alongside}]\n---\n# Person\nBiography.';
const session='---\ntags: [session-note]\ncampaign: Cleenseau\nsessionNumber: 12.1\nDR: 1720-01-01\nDR_end: 1720-01-03\n---\n# Session\n[[Person]]\nCompletely different generated prose.';
const recap=['# Session Recap','## Session Header','- Campaign: Cleenseau','- Session Number: 12.1','- Desc Title: At the Inn','- DR Date: 1720-01-01 to 1720-01-03','## Recap',
  '### recap-001 | Meeting','- Date: 1720-01-01','- NPCs: Person, [[Person]]','- Locations: Inn','#### Short','The party met [[Person]] at the inn.','#### Long','Long narrative that is neither Short nor published prose.',
  '### recap-002 | A secret','- Date: 1720-01-02','- NPCs: Person','#### Short','%%^Campaign:none%%Person revealed a secret.%%^End%%','#### Long','Secret long narrative.',
  '### recap-003 | Returning','- Date: 1720-01-03','- NPCs: Person','#### Short','%%^Date:1720-01-04%%Person returned to town.%%^End%%','#### Long','A longer account.',
  '### recap-004 | Another beat','- Date: 1720-01-03','- NPCs: Person','#### Short','An authoritative independent beat.','#### Long','Another long account.',
  '## Cast','### NPCs','- Another (mentioned): a person named in conversation','## Source Files','- Cleaned Source: /private/transcript.md'].join('\n');
function sample(extra={}){const store=storeFor({'Person.md':person,'Another.md':'---\ntags: [person]\n---\n# Another',...extra});const index=compileInteractionIndex(store,registry,buildBacklinkIndex(store),[parseSessionRecap(recap,'recap')]);return {store,index};}
const eventsFor=(store,index,ctx=context())=>campaignInteractions(index,store,store.resolve('Person'),ctx,registry)[0]?.events || [];

test('recap beats exist without session notes and use Short independently of Long or cast mentions',()=>{
  const {store,index}=sample(),events=eventsFor(store,index);
  assert.equal(index.version,2);
  assert.deepEqual(events.map(event=>event.title),['Meeting','Returning','Another beat']);
  assert.equal(events[0].text,'The party met Person at the inn.');
  assert.equal(events[0].sourceTitle,'At the Inn');assert.equal(events[0].sessionLabel,'Session 12.1');assert.equal(events[0].url,null);
  assert.equal(index.byTarget.another,undefined);
  assert.doesNotMatch(JSON.stringify(index),/Long narrative|long account|private\/transcript|Source Range|session-recap\.md/);
  assert.equal(campaignInteractions(index,store,store.resolve('Person'),context(),registry)[0].known,true);
  assert.equal(events.some(event=>event.kind==='authored'),false);
  assert.deepEqual(campaignInteractions(index,store,store.resolve('Person'),context('1720-01-05',[]),registry),[]);
  assert.deepEqual(campaignInteractions(index,store,store.resolve('Person'),context('1720-01-05',['mawar']),registry),[]);
  assert.deepEqual(interactionDate('1720'),{start:'1720-01-01',end:'1720-12-31',precision:'year'});
  assert.equal(interactionDate('1720-02-29'),null);
});

test('renamed, duplicate, excluded and malformed session notes cannot affect recap beats',()=>{
  const expected=sample(),actual=sample({'Campaigns/Clee/Session 12.1.md':session,'Campaigns/Clee/Old session.md':session+'\n%% broken'});
  actual.store.lookup('Campaigns/Clee/Session 12.1.md').entry.note.metadata.excludePublish=['clee'];
  assert.deepEqual(eventsFor(actual.store,actual.index),eventsFor(expected.store,expected.index));
  const plain=compileInteractionIndex(actual.store,registry,buildBacklinkIndex(actual.store));
  assert.equal(eventsFor(actual.store,plain).length,0);
});

test('the recap owns its campaign/date/DM conditions and date intervals',()=>{
  const {store,index}=sample();
  assert.deepEqual(eventsFor(store,index,context('1720-01-02')).map(event=>event.title),['Meeting']);
  assert.deepEqual(eventsFor(store,index,context('1720-01-03')).map(event=>event.title),['Meeting','Another beat']);
  assert.equal(eventsFor(store,index,context('1720-01-05',['clee'],true)).length,4);
  const bundle=parseSessionRecap(recap);bundle.scenes[0].short='Public. %%^Campaign:mawar%%Mawar detail.%%^End%%';
  const compiled=compileInteractionIndex(store,registry,buildBacklinkIndex(store),[bundle]);
  assert.equal(eventsFor(store,compiled)[0].text,'Public.');
  assert.equal(eventsFor(store,compiled,context('1720-01-05',['clee','mawar']))[0].text,'Public. Mawar detail.');
  bundle.scenes[0].date='1721-01-01';bundle.scenes[0].end='1720-01-01';
  const inverted=compileInteractionIndex(store,registry,null,[bundle]);
  assert.match(inverted.warnings.join('\n'),/inverted dates for recap-001/);
  assert.equal(eventsFor(store,inverted).some(event=>event.title==='Meeting'),false);
  bundle.scenes[0].date=null;bundle.scenes[0].end=null;
  const undated=compileInteractionIndex(store,registry,null,[bundle]);
  assert.equal(eventsFor(store,undated,context('1720-01-02')).some(event=>event.title==='Meeting'),false);
  const event=eventsFor(store,undated).find(event=>event.title==='Meeting');
  assert.equal(event.precision,'undated');assert.equal(event.start,null);
});

test('only non-session campaign-folder backlinks supplement recap beats and preserve occurrence visibility',()=>{
  const {store,index}=sample({
    'Campaigns/Clee/Handout.md':'# Handout\n[[Person]]',
    'Campaigns/Clee/Secrets.md':'# Secrets\n%%^Campaign:none%%[[Person]]%%^End%%',
    'Campaigns/Clee/Later.md':'# Later\n%%^Date:1720-01-06%%[[Person]]%%^End%%',
    'Campaigns/Mawar/Handout.md':'# Mawar\n[[Person]]',
    'Campaigns/Unknown/Handout.md':'# Unknown\n[[Person]]',
    'World.md':'# World\n[[Person]]',
    'Outside.md':'---\ncampaign: Cleenseau\n---\n[[Person]]',
    'Campaigns/Clee/Session.md':session,
    'Campaigns/Clee/Old session.md':session.replace('tags: [session-note]','tags: []')
  });
  const references=eventsFor(store,index).filter(event=>event.kind==='reference');
  assert.equal(references.length,1);assert.equal(references[0].title,'Handout');
  assert.equal(references[0].precision,'undated');assert.match(references[0].url,/campaigns\/clee\/handout/);
  assert.equal(eventsFor(store,index,context('1720-01-06',['clee'],true)).filter(event=>event.kind==='reference').length,3);
  store.lookup('Campaigns/Clee/Handout.md').entry.note.metadata.excludePublish=['clee'];
  assert.equal(eventsFor(store,index).some(event=>event.kind==='reference'),false);
  const legacy={...index,backlinkVersion:1};
  assert.equal(eventsFor(store,legacy,context('1720-01-06',['clee','mawar'],true)).some(event=>event.kind==='reference'),false);
  assert.equal(eventsFor(store,legacy,context('1720-01-06',['clee','mawar'],true)).filter(event=>event.kind==='encounter').length,4);
});

test('ambiguous names, duplicate recap identities and duplicate beat IDs are diagnosed without arbitrary selection',()=>{
  const bundle=parseSessionRecap(recap),store=storeFor({'A/Person.md':person,'B/Person.md':person});
  const ambiguous=compileInteractionIndex(store,registry,null,[bundle]);
  assert.match(ambiguous.warnings.join('\n'),/ambiguous person Person/);assert.equal(Object.keys(ambiguous.byTarget).length,0);
  const normal=sample().store,duplicated=compileInteractionIndex(normal,registry,null,[bundle,bundle]);
  assert.equal(Object.keys(duplicated.byTarget).length,0);assert.match(duplicated.warnings.join('\n'),/duplicate recap identity/);
  bundle.scenes.push({...bundle.scenes[0]});
  const repeated=compileInteractionIndex(normal,registry,null,[bundle]);
  assert.match(repeated.warnings.join('\n'),/duplicate beat recap-001/);
  assert.equal(eventsFor(normal,repeated).some(event=>event.title==='Meeting'),false);
});

test('missing Short and malformed recap comments omit only that beat, without falling back to Long',()=>{
  const {store}=sample(),bundle=parseSessionRecap(recap);
  bundle.scenes[0].short='';bundle.scenes[1].short='%% broken';
  const index=compileInteractionIndex(store,registry,null,[bundle]);
  assert.match(index.warnings.join('\n'),/missing visible Short/);assert.match(index.warnings.join('\n'),/recap-002 omitted/);
  assert.deepEqual(eventsFor(store,index).map(event=>event.title),['Returning','Another beat']);
});

test('serialized projections are stable across requests and rendering retains recap data without header event extraction',()=>{
  const {store,index}=sample(),before=JSON.stringify(index),loaded=JSON.parse(before);
  assert.deepEqual(eventsFor(store,loaded),eventsFor(store,index));
  eventsFor(store,index,context('1722-01-01',['clee','mawar'],true));assert.equal(JSON.stringify(index),before);
  const engine=new RenderEngine({settings:{default_date:'1720-01-05'},store,headers:{registry},renderHeader:()=>'',navigationSource:null,backlinkIndex:buildBacklinkIndex(store),interactionIndex:index});
  const result=engine.render('Person','1720-01-05','custom',false,undefined,['clee']);
  assert.match(result.html,/campaign-interactions/);assert.equal(result.interactions[0].events.length,3);
  assert.match(document(result,[]),/theme\/interactions\.js/);
});

test('dot grouping retains 27 entries, respects spans/undated records, and uses the no-leap-day DR calendar',()=>{
  const events=Array.from({length:27},(_,i)=>({id:String(i),title:'Interaction '+i,start:'1720-01-'+String(1+Math.floor(i/3)).padStart(2,'0'),end:'1720-01-'+String(1+Math.floor(i/3)).padStart(2,'0'),precision:'day',session:'s'+Math.floor(i/5),sessionLabel:'Session '+Math.floor(i/5)}));
  for(const mode of ['auto','session','day','week','event'])assert.equal(groupInteractions(events,mode).flatMap(group=>group.events).length,27);
  assert.equal(groupInteractions(events,'auto').length,6);assert.equal(groupInteractions(events,'day').length,9);assert.equal(groupInteractions(events,'week').length,2);
  assert.equal(groupInteractions(events.slice(0,3),'auto').length,3);
  assert.equal(interactionDay('1720-03-01')-interactionDay('1720-02-28'),1);
  const span={...events[0],end:'1720-01-10',precision:'range'};
  assert.match(groupInteractions([span],'day')[0].title,/1720-01-01–1720-01-10/);
  assert.equal(groupInteractions([{...span,start:null,end:null}],'week')[0].title,'Date unrecorded');
});

test('browser dots select details and zoom into/out of groups, with an accessible no-JS fallback',()=>{
  const events=Array.from({length:27},(_,i)=>({id:String(i),kind:'encounter',title:'Interaction '+i,text:'Original text '+i,start:'1720-01-01',end:'1720-01-01',precision:'day',session:'s'+Math.floor(i/5),sessionLabel:'Session '+Math.floor(i/5),sourceTitle:'Session',url:'/page/session?context=cleenseau'}));
  const groups=[{label:'Cleenseau',code:'clee',known:true,events}],markup=interactionView(groups);
  const {document,window}=parseHTML('<html><body>'+interactionSummary(groups)+markup+'</body></html>');
  const root=document.querySelector('[data-interaction-campaign]');
  assert.equal(root.querySelectorAll('.interaction-fallback li').length,27);
  mountInteractions(root);assert.equal(root.querySelector('.interaction-fallback').hidden,true);
  assert.equal(root.querySelectorAll('.interaction-dot').length,6);
  root.querySelector('.interaction-dot').click();assert.equal(root.querySelectorAll('.interaction-dot').length,5);
  root.querySelectorAll('.interaction-dot')[4].click();assert.equal(root.querySelector('.interaction-detail h4').textContent,'Interaction 4');
  root.querySelector('[data-interaction-back]').click();assert.equal(root.querySelectorAll('.interaction-dot').length,6);
  const select=root.querySelector('select');select.querySelector('option[value="event"]').selected=true;select.dispatchEvent(new window.Event('change'));
  assert.equal(root.querySelectorAll('.interaction-dot').length,27);
  const hostile=interactionView([{...groups[0],events:[{...events[0],title:'</script><img src=x onerror=alert(1)>',text:'<script>bad</script>'}]}]);
  const parsed=parseHTML('<html><body>'+hostile+'</body></html>').document;
  assert.equal(parsed.querySelectorAll('img').length,0);assert.equal(parsed.querySelectorAll('script').length,1);
  assert.equal(JSON.parse(parsed.querySelector('script').textContent).events[0].title,JSON.parse(JSON.stringify([{...events[0],title:'</script><img src=x onerror=alert(1)>'}]))[0].title);
});

test('Node recap reader imports only supported recap files and ignores private source artifacts',()=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  const directory=fs.mkdtempSync(path.join(ROOT,'.cache','interactions-'));
  try {
    const cleaned=path.join(directory,'_sessions','cleenseau','cleenseau-012.1','cleaned');fs.mkdirSync(cleaned,{recursive:true});
    fs.writeFileSync(path.join(cleaned,'cleenseau-012.1-session-recap.md'),recap);
    fs.writeFileSync(path.join(cleaned,'cleenseau-012.1-source-cleaned.md'),'private transcript');
    const result=readInteractionBundles({vault_dir:directory});assert.equal(result.bundles.length,1);
    assert.equal(result.bundles[0].number,'12.1');assert.equal(result.bundles[0].scenes.length,4);
    assert.doesNotMatch(JSON.stringify(result),/private transcript|Long narrative|long account/);
  } finally {const resolved=fs.realpathSync(directory);assert.ok(isInside(fs.realpathSync(path.join(ROOT,'.cache')),resolved));assert.ok(path.basename(resolved).startsWith('interactions-'));fs.rmSync(resolved,{recursive:true});}
});
