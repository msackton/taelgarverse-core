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
import {imageDOM} from './helpers/image-dom.mjs';
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
  assert.deepEqual(campaignInteractions(index,store,store.resolve('Person'),context('1720-01-05',['mawar']),registry),[{code:'mawar',label:'Mawar Adventures',known:false,events:[]}]);
  assert.deepEqual(interactionDate('1720'),{start:'1720-01-01',end:'1720-12-31',precision:'year'});
  assert.equal(interactionDate('1720-02-29'),null);
});

test('renamed, duplicate, excluded and malformed session notes cannot affect recap beats',()=>{
  const expected=sample(),actual=sample({'Campaigns/Clee/Session 12.1.md':session,'Campaigns/Clee/Old session.md':session+'\n%% broken'});
  actual.store.lookup('Campaigns/Clee/Session 12.1.md').entry.note.metadata.excludePublish=['clee'];
  const beats=events=>events.map(({sessionUrl,...beat})=>beat);
  assert.deepEqual(beats(eventsFor(actual.store,actual.index)),beats(eventsFor(expected.store,expected.index)));
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

test('session links prefer the registry path, preserve context, and omit ambiguous or unavailable destinations',()=>{
  const campaigns={campaigns:{cleenseau:{...registry.campaigns.cleenseau,notePattern:'Session {session_padded}.md'}}};
  const {store}=sample({'Campaigns/Clee/Session 12.1.md':session,'Campaigns/Clee/Legacy.md':session});
  const index=compileInteractionIndex(store,campaigns,null,[parseSessionRecap(recap)]);
  const ctx={...context('1720-01-05',['clee'],true),pov:true};
  const events=()=>campaignInteractions(index,store,store.resolve('Person'),ctx,campaigns)[0].events;
  assert.match(events()[0].sessionUrl,/session-12\.1\?date=1720-01-05&campaigns=clee&dm=1&pov=1/);
  store.lookup('Campaigns/Clee/Session 12.1.md').entry.note.metadata.excludePublish=['clee'];
  assert.match(events()[0].sessionUrl,/legacy\?/);
  store.lookup('Campaigns/Clee/Legacy.md').entry.note.metadata.excludePublish=['clee'];
  assert.equal(events()[0].sessionUrl,null);assert.equal(events().length,4);
  const ambiguous=compileInteractionIndex(store,registry,null,[parseSessionRecap(recap)]);
  for(const entry of store.bySlug.values())delete entry.note.metadata.excludePublish;
  assert.equal(eventsFor(store,ambiguous)[0].sessionUrl,null);
});

test('missing recaps fall back to explicit links in the official session note, with dates and distinct provenance',()=>{
  const campaigns={campaigns:{cleenseau:{...registry.campaigns.cleenseau,notePattern:'Session {session_padded}.md'}}};
  const store=storeFor({'Person.md':person,'Other.md':'---\ntags: [person]\n---\n# Other',
    'Campaigns/Clee/Session 12.1.md':session+'\n[[Person]]\n%%^Campaign:mawar%%[[Other]]%%^End%%',
    'Campaigns/Clee/Legacy.md':session.replace('[[Person]]','[[Other]]')});
  const backlinks=buildBacklinkIndex(store),index=compileInteractionIndex(store,campaigns,backlinks,[]);
  const events=ctx=>campaignInteractions(index,store,store.resolve('Person'),ctx,campaigns)[0]?.events || [];
  assert.equal(events(context('1720-01-02')).length,0,'a session range waits until its end');
  const [event]=events(context());
  assert.equal(events(context()).length,1,'repeated links produce one session reference');
  assert.equal(event.kind,'session-reference');assert.equal(event.id,'session:clee:12.1');
  assert.equal(event.start,'1720-01-01');assert.equal(event.end,'1720-01-03');assert.equal(event.precision,'range');
  assert.equal(event.text,'');assert.equal(event.transcriptUrl,null);
  assert.match(event.sessionUrl,/session-12\.1\?date=1720-01-05&campaigns=clee/);
  assert.doesNotMatch(JSON.stringify(index),/Completely different generated prose/);
  assert.equal(campaignInteractions(index,store,store.resolve('Other'),context(),campaigns)[0].events.length,0,'the legacy duplicate cannot add evidence');
  assert.equal(campaignInteractions(index,store,store.resolve('Other'),context('1720-01-05',['clee','mawar']),campaigns)[0].events.length,1);
  const groups=campaignInteractions(index,store,store.resolve('Person'),context(),campaigns);
  const parsed=parseHTML('<html><body>'+interactionSummary(groups)+interactionView(groups)+'</body></html>').document;
  assert.match(parsed.querySelector('.campaign-interaction-summary').textContent,/1 session reference/);
  assert.doesNotMatch(parsed.querySelector('.campaign-interaction-summary').textContent,/encounter/);
  assert.match(parsed.querySelector('.interaction-fallback').textContent,/Session 12\.1/);
  assert.doesNotMatch(parsed.querySelector('.interaction-fallback').textContent,/Linked in|Session reference|Story order|spacing compressed/);
  const root=parsed.querySelector('[data-interaction-campaign]');mountInteractions(root);
  assert.ok(root.querySelector('.interaction-mark.session-reference'));
  assert.match(root.querySelector('.interaction-dot').getAttribute('aria-label'),/^Session reference:/);
  root.querySelector('.interaction-dot').click();
  const popup=root.querySelector('.interaction-detail');
  assert.equal(popup.querySelectorAll('p').length,1,'only the date is shown above the title and session link');
  assert.equal(popup.querySelector('.interaction-sources a').textContent,'Session 12.1');
  assert.doesNotMatch(popup.textContent,/Linked in|Session reference|Story order|spacing compressed|Legacy/);
  const older=[{...groups[0],events:[{...event,text:'Linked in the official session note.'}]}];
  const olderPage=parseHTML('<html><body>'+interactionView(older)+'</body></html>').document;
  assert.doesNotMatch(olderPage.querySelector('.interaction-fallback').textContent,/Linked in/);
  const olderRoot=olderPage.querySelector('[data-interaction-campaign]');mountInteractions(olderRoot);olderRoot.querySelector('.interaction-dot').click();
  assert.doesNotMatch(olderRoot.querySelector('.interaction-detail').textContent,/Linked in/,'old indexes also omit boilerplate');
  store.lookup('Campaigns/Clee/Session 12.1.md').entry.note.metadata.tags.push('meta');
  assert.equal(events(context()).length,0,'meta also filters an existing fallback projection');
  store.lookup('Campaigns/Clee/Session 12.1.md').entry.note.metadata.tags.pop();
  store.lookup('Campaigns/Clee/Session 12.1.md').entry.note.metadata.excludePublish=['clee'];
  assert.equal(events(context()).length,0,'an unavailable official note does not switch to a legacy duplicate');
});

test('recap presence suppresses whole-session fallbacks even for empty, invalid, duplicate and hidden beats',()=>{
  const store=storeFor({'Person.md':person,'Legacy.md':session}),backlinks=buildBacklinkIndex(store);
  const eventList=bundles=>eventsFor(store,compileInteractionIndex(store,registry,backlinks,bundles));
  assert.equal(eventList([])[0].kind,'session-reference','one legacy metadata candidate is accepted');
  const bundle=parseSessionRecap(recap);
  for(const bundles of [[bundle],[{...bundle,scenes:[]}],[bundle,bundle],[{...bundle,scenes:[{...bundle.scenes[0],short:''}]}],
    [{...bundle,scenes:[{...bundle.scenes[0],people:['Someone Else']}]}],
    [{key:'_sessions/cleenseau/cleenseau-012.1/cleaned/broken-session-recap.md',invalid:true}]]) {
    assert.ok(eventList(bundles).every(event=>event.kind!=='session-reference'));
  }
  const duplicate=storeFor({'Person.md':person,'Legacy.md':session,'Other legacy.md':session});
  assert.equal(eventsFor(duplicate,compileInteractionIndex(duplicate,registry,buildBacklinkIndex(duplicate),[])).length,0);
  store.resolve('Legacy').note.metadata.DR='unknown';delete store.resolve('Legacy').note.metadata.DR_end;
  const undated=eventList([])[0];assert.equal(undated.start,null);assert.equal(undated.precision,'undated');
});

test('recap date and both source links appear in browser details and the no-JS fallback',()=>{
  const {store,index}=sample({'Session.md':session});
  index.transcripts['recap:clee:12.1:recap-001']='Person: A polished conversation.';
  const groups=campaignInteractions(index,store,store.resolve('Person'),context(),registry);
  const {document}=parseHTML('<html><body>'+interactionView(groups)+'</body></html>'),root=document.querySelector('[data-interaction-campaign]');
  assert.match(root.querySelector('.interaction-fallback li').textContent,/1720-01-01 DR/);
  assert.equal(root.querySelectorAll('.interaction-fallback li:first-child .interaction-sources a').length,2);
  mountInteractions(root);
  assert.equal(root.querySelector('.interaction-detail').hidden,true);
  root.querySelector('.interaction-dot').click();
  assert.match(root.querySelector('.interaction-detail').textContent,/1720-01-01 DR/);
  assert.deepEqual([...root.querySelectorAll('.interaction-detail .interaction-sources a')].map(link=>link.textContent),['Session 12.1','Transcript']);
  assert.equal(root.querySelector('.interaction-detail a').getAttribute('href'),groups[0].events[0].sessionUrl);
});

test('only non-session campaign-folder backlinks supplement recap beats and preserve occurrence visibility',()=>{
  const {store,index}=sample({
    'Campaigns/Clee/Handout.md':'---\ntags: [source]\n---\n# Handout\n[[Person]]',
    'Campaigns/Clee/Secrets.md':'---\ntags: [source]\n---\n# Secrets\n%%^Campaign:none%%[[Person]]%%^End%%',
    'Campaigns/Clee/Later.md':'---\ntags: [source]\n---\n# Later\n%%^Date:1720-01-06%%[[Person]]%%^End%%',
    'Campaigns/Mawar/Handout.md':'---\ntags: [source]\n---\n# Mawar\n[[Person]]',
    'Campaigns/Unknown/Handout.md':'---\ntags: [source]\n---\n# Unknown\n[[Person]]',
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

test('untagged, meta and background sources are excluded from both new and older compiled reference lists',()=>{
  const material={
    'Untagged':'knownTo: clee',
    'Empty tags':'tags: []',
    'Meta':'tags: [meta, source]',
    'Nested meta':'tags: "#Meta/index"',
    'Background':'tags: [object, background/lore]',
    'Allowed':'tags: [source/letter]',
  };
  const notes=Object.fromEntries(Object.entries(material).map(([name,metadata])=>['Campaigns/Clee/'+name+'.md','---\n'+metadata+'\n---\n[[Person]]']));
  const {store,index}=sample(notes);
  const references=eventsFor(store,index).filter(event=>event.kind==='reference');
  assert.deepEqual(references.map(event=>event.title),['Allowed']);
  assert.equal(index.byTarget.person.filter(event=>event.kind==='reference').length,1);
  const older=structuredClone(index);
  for(const name of Object.keys(material).filter(name=>name!=='Allowed')) {
    const source=store.lookup('Campaigns/Clee/'+name+'.md').entry.slug;
    older.byTarget.person.push({id:'reference:clee:'+source,kind:'reference',source,campaign:'clee',when:[{}]});
  }
  assert.deepEqual(eventsFor(store,older).filter(event=>event.kind==='reference').map(event=>event.title),['Allowed']);
  assert.equal(eventsFor(store,older).filter(event=>event.kind==='encounter').length,3);
  store.lookup('Campaigns/Clee/Allowed.md').entry.note.metadata.tags=['source','background'];
  assert.equal(eventsFor(store,index).filter(event=>event.kind==='reference').length,0,'changed metadata also filters an existing index');
});

test('the website shows only knownTo campaigns in the active context, even when other campaigns have recap records',()=>{
  const {store}=sample(),clee=parseSessionRecap(recap),mawar={...parseSessionRecap(recap),campaign:'Mawar Adventures'};
  const index=compileInteractionIndex(store,registry,null,[clee,mawar]);
  const engine=new RenderEngine({settings:{default_date:'1720-01-05'},store,headers:{registry},renderHeader:()=>'',navigationSource:null,interactionIndex:index});
  assert.ok(campaignInteractions(index,store,store.resolve('Person'),context('1720-01-05',['mawar']),registry)[0].events.length);
  for(const {knownTo,selected,expected,date='1720-01-05'} of [
    {knownTo:['Clee'],selected:['clee','mawar'],expected:['clee']},
    {knownTo:['Clee'],selected:['mawar'],expected:[]},
    {knownTo:['clee','mawar'],selected:[],expected:[]},
    {knownTo:'Mawar Adventures',selected:['clee','mawar'],expected:['mawar']},
    {knownTo:['Clee','Mawar Adventures'],selected:['clee','mawar'],expected:['clee','mawar']},
    {knownTo:[],selected:['clee','mawar'],expected:[]},
    {knownTo:undefined,selected:['clee'],expected:[]},
    {knownTo:['clee'],selected:['clee'],expected:['clee'],date:'1719-12-31'},
  ]) {
    store.resolve('Person').note.metadata.knownTo=knownTo;
    const result=engine.render('Person',date,'custom',false,undefined,selected);
    assert.deepEqual(result.interactions.map(group=>group.code),expected);
    const parsed=parseHTML('<html><body>'+result.html+'</body></html>').document;
    assert.equal(parsed.querySelectorAll('#campaign-interactions > h2').length,expected.length?1:0);
    assert.equal(parsed.querySelector('#campaign-interactions select[aria-label="Campaign"]'),null);
    if(!expected.length)assert.equal(parsed.querySelector('#campaign-interactions,.campaign-interaction-summary'),null);
    else if(date==='1719-12-31')assert.equal(result.interactions[0].events.length,0,'knowledge alone still displays for an intersecting campaign');
    else assert.ok(result.interactions.every(group=>group.events.length && group.known));
  }
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

test('an explicit Obsidian placement fence does not duplicate the website history or leave an empty code frame',()=>{
  const {store,index}=sample();store.resolve('Person').note.body+='\n\n```taelgar-interactions\n```';
  const engine=new RenderEngine({settings:{default_date:'1720-01-05'},store,headers:{registry},renderHeader:()=>'',navigationSource:null,interactionIndex:index});
  const result=engine.render('Person','1720-01-05','custom',false,undefined,['clee']);
  assert.equal((result.html.match(/id="campaign-interactions"/g) || []).length,1);
  assert.doesNotMatch(result.html,/language-taelgar-interactions/);
});

test('knowledge-only, reference-only and timeline views share campaign headings and knowledge status',()=>{
  const {store}=sample(),groups=campaignInteractions(null,store,store.resolve('Person'),context(),registry);
  assert.equal(groups[0].events.length,0);
  const {document}=parseHTML('<html><body>'+interactionSummary(groups)+interactionView(groups)+'</body></html>');
  assert.equal(document.querySelector('.interaction-campaign-header h3').textContent,'Cleenseau');
  assert.equal(document.querySelector('.interaction-knowledge').textContent,'Known to party');
  assert.ok(document.querySelector('.campaign-interactions--knowledge-only'));
  assert.equal(document.querySelector('#campaign-interactions > h2').textContent,'Campaign interactions');
  assert.equal(document.querySelector('.interaction-controls,.interaction-plot,.interaction-detail,script'),null);
  assert.ok(document.querySelector(document.querySelector('.campaign-interaction-summary a').getAttribute('href')),'the header link still reaches the footnote');
  const actual=sample(),recorded=campaignInteractions(actual.index,actual.store,actual.store.resolve('Person'),context(),registry);
  const empty={code:'other',label:'Other <img src=x>',known:true,events:[]};
  const mixed=parseHTML('<html><body>'+interactionView([...recorded,empty])+'</body></html>').document;
  assert.equal(mixed.querySelector('.interaction-campaign-header').outerHTML,document.querySelector('.interaction-campaign-header').outerHTML);
  assert.equal(mixed.querySelectorAll('[data-interaction-campaign]').length,1);
  assert.equal(mixed.querySelectorAll('.interaction-campaign-header h3')[1].textContent,'Other <img src=x>');
  assert.equal(mixed.querySelector('img,.campaign-interactions--knowledge-only'),null);
  assert.ok(mixed.querySelector('h2'));
  const emptyOnly=parseHTML('<html><body>'+interactionView([...groups,empty])+'</body></html>').document;
  assert.equal(emptyOnly.querySelectorAll('.interaction-campaign-header').length,2);
  assert.equal(emptyOnly.querySelector('h2').textContent,'Campaign interactions');
  assert.equal(emptyOnly.querySelector('script,.interaction-controls,.interaction-plot'),null);
});

test('campaign material uses typed links outside the dots and encounter counts, including without JavaScript',()=>{
  const material={};
  for(let i=0;i<27;i++)material['Campaigns/Clee/Reference '+String(i).padStart(2,'0')+'.md']='---\ntags: ['+(i===0?'object/weapon':i===1?'source':i===2?'story, source':'other')+']\nDR: 1710-01-01\n---\n[[Person]]';
  const {store,index}=sample(material),groups=campaignInteractions(index,store,store.resolve('Person'),context(),registry);
  const references=groups[0].events.filter(event=>event.kind==='reference');
  assert.equal(references.length,27);
  assert.deepEqual(references.slice(0,4).map(event=>event.referenceType),['item','document','story','reference']);
  assert.ok(references.every(event=>event.start===null),'document dates never become encounter dates');
  const {document}=parseHTML('<html><body>'+interactionSummary(groups)+interactionView(groups)+'</body></html>');
  const root=document.querySelector('[data-interaction-campaign]');
  assert.equal(root.querySelectorAll('.interaction-fallback li').length,3);
  assert.equal(root.querySelectorAll('.interaction-reference-links a').length,27);
  assert.equal(root.querySelectorAll('.interaction-reference-body > .interaction-reference-links a').length,13);
  assert.equal(root.querySelectorAll('.interaction-reference-more a').length,14);
  assert.match(root.querySelector('summary').textContent,/14 more references/);
  assert.deepEqual([...root.querySelectorAll('.interaction-reference-label')].map(node=>node.textContent),['Items','Stories','Sources','References']);
  assert.equal(root.querySelector('[data-reference-kind="story"] a').textContent,'Reference 02');
  assert.equal(root.querySelector('[data-reference-kind="document"] a').textContent,'Reference 01');
  assert.match(root.querySelector('.interaction-reference-links a').getAttribute('href'),/date=1720-01-05&campaigns=clee/);
  assert.match(document.querySelector('.campaign-interaction-summary').textContent,/3 encounters, 27 references/);
  assert.equal(JSON.parse(root.querySelector('[data-interaction-records]').textContent).events.length,3);
  mountInteractions(root);
  assert.equal(root.querySelectorAll('.interaction-dot').length,3,'references do not force automatic session grouping');
  assert.match(root.querySelector('.interaction-breadcrumb').textContent,/^3 recorded entries/);
  assert.equal(root.querySelector('.interaction-references').hidden,false);
  assert.doesNotMatch(root.querySelector('.interaction-detail').textContent,/Reference 0/);
  const referencesOnly=[{...groups[0],events:references}];
  const compact=parseHTML('<html><body>'+interactionView(referencesOnly)+'</body></html>').document;
  assert.ok(compact.querySelector('.campaign-interactions--compact'));
  assert.equal(compact.querySelector('h2').textContent,'Campaign interactions');
  assert.equal(compact.querySelector('.interaction-plot,.interaction-controls,.interaction-detail,script'),null);
  assert.equal(compact.querySelectorAll('.interaction-reference-links a').length,27);
  assert.equal(compact.querySelector('.interaction-campaign-header').outerHTML,root.querySelector('.interaction-campaign-header').outerHTML);
  const unflagged=parseHTML('<html><body>'+interactionView([{...referencesOnly[0],known:false}])+'</body></html>').document;
  assert.equal(unflagged.querySelector('.interaction-campaign-header h3').textContent,'Cleenseau');
  assert.equal(unflagged.querySelector('.interaction-knowledge'),null);
});

test('related material has one row per nonempty type with independently sorted and expandable lists',()=>{
  const notes={'Campaigns/Clee/Item.md':'---\ntags: [object]\n---\n[[Person]]'};
  for(const number of [11,4,2,10,1,9,3,8,5,7,6]) {
    const label=String(number).padStart(2,'0');
    notes['Campaigns/Clee/Story '+label+'.md']='---\ntags: [source, "#Story/ballad"]\n---\n[[Person]]';
    notes['Campaigns/Clee/Source '+label+'.md']='---\ntags: [source]\n---\n[[Person]]';
  }
  const {store,index}=sample(notes),groups=campaignInteractions(index,store,store.resolve('Person'),context(),registry);
  const {document}=parseHTML('<html><body>'+interactionView(groups)+'</body></html>');
  assert.deepEqual([...document.querySelectorAll('[data-reference-kind]')].map(row=>row.dataset.referenceKind),['item','story','document']);
  for(const [type,name] of [['story','Story'],['document','Source']]) {
    const row=document.querySelector('[data-reference-kind="'+type+'"]');
    assert.deepEqual([...row.querySelectorAll('a')].map(link=>link.textContent),Array.from({length:11},(_,number)=>name+' '+String(number+1).padStart(2,'0')));
    assert.equal(row.querySelectorAll('.interaction-reference-body > .interaction-reference-links a').length,10);
    assert.equal(row.querySelector('summary').textContent,'Show 1 more '+name.toLowerCase());
    assert.equal(row.querySelector('details a').textContent,name+' 11');
  }
  const links=[...document.querySelectorAll('.interaction-reference-links a')].map(link=>link.getAttribute('href'));
  assert.equal(links.length,23);assert.equal(new Set(links).size,23,'a story tagged source appears only in Stories');
  assert.equal(document.querySelector('[data-reference-kind="item"] details'),null);
});

test('undated recap beats retain their session when grouped by date, without borrowing a beat date',()=>{
  const {store}=sample(),bundle=parseSessionRecap(recap);bundle.scenes=[{...bundle.scenes[0],date:null,end:null}];
  const later={...structuredClone(bundle),number:'13',date:'1720-01-07',end:null};
  const index=compileInteractionIndex(store,registry,null,[later,bundle]);
  const events=eventsFor(store,index,context('1720-01-08'));
  assert.deepEqual(events.map(event=>event.sessionLabel),['Session 12.1','Session 13']);
  assert.ok(events.every(event=>event.start===null && event.end===null && event.precision==='undated'));
  for(const mode of ['session','day','week','event']) {
    const grouped=groupInteractions(events,mode);
    assert.equal(grouped.length,2,mode+' retains separate sessions');
    assert.deepEqual(grouped.flatMap(group=>group.events.map(event=>event.id)),events.map(event=>event.id));
  }
  const grouped=groupInteractions(events,'day');
  assert.match(grouped[0].title,/Session 12\.1 · Date unrecorded/);
  const {document}=parseHTML('<html><body>'+interactionView([{label:'Cleenseau',known:true,events}])+'</body></html>');
  assert.equal(document.querySelector('.interaction-fallback li > span').textContent,'Date unrecorded');
  assert.match(document.querySelector('.interaction-fallback').textContent,/Session 12\.1/);
  const root=document.querySelector('[data-interaction-campaign]');mountInteractions(root);
  assert.match(root.querySelector('.interaction-dot-date').textContent,/Session 12\.1 · Date unrecorded/);
  root.querySelector('.interaction-dot').click();
  assert.match(root.querySelector('.interaction-detail').textContent,/Session dates: 1720-01-01–1720-01-03 DR/);
  assert.doesNotMatch(root.querySelector('.interaction-dot-date').textContent,/1720-01-01/);
});

test('reference labels are escaped and unrecognized reference types use a neutral icon',()=>{
  const events=[{id:'ref',kind:'reference',referenceType:'__proto__',title:'<img src=x onerror=bad()>',url:'/page/ref?campaigns=clee&dm=1'}];
  const {document}=parseHTML('<html><body>'+interactionView([{label:'Campaign <a>',known:true,events}])+'</body></html>');
  assert.equal(document.querySelector('img,script'),null);
  assert.equal(document.querySelector('.interaction-reference-links a').textContent,'<img src=x onerror=bad()>');
  assert.equal(document.querySelector('.interaction-reference-label').textContent,'References');
  assert.equal(document.querySelector('.interaction-campaign-header h3').textContent,'Campaign <a>');
});

test('dot grouping retains 27 entries, respects spans/undated records, and uses the no-leap-day DR calendar',()=>{
  const events=Array.from({length:27},(_,i)=>({id:String(i),title:'Interaction '+i,start:'1720-01-'+String(1+Math.floor(i/3)).padStart(2,'0'),end:'1720-01-'+String(1+Math.floor(i/3)).padStart(2,'0'),precision:'day',session:'s'+Math.floor(i/5),sessionLabel:'Session '+Math.floor(i/5)}));
  for(const mode of ['auto','session','day','week','event'])assert.equal(groupInteractions(events,mode).flatMap(group=>group.events).length,27);
  assert.equal(groupInteractions(events,'auto').length,6);assert.equal(groupInteractions(events,'day').length,9);assert.equal(groupInteractions(events,'week').length,2);
  assert.equal(groupInteractions(events.slice(0,3),'auto').length,3);
  assert.equal(interactionDay('1720-03-01')-interactionDay('1720-02-28'),1);
  const span={...events[0],end:'1720-01-10',precision:'range'};
  assert.match(groupInteractions([span],'day')[0].title,/1720-01-01–1720-01-10/);
  assert.equal(groupInteractions([{...span,start:null,end:null}],'week')[0].title,'Session 0 · Date unrecorded');
});

test('browser dots select details and zoom into/out of groups, with an accessible no-JS fallback',()=>{
  const events=Array.from({length:27},(_,i)=>({id:String(i),kind:'encounter',title:'Interaction '+i,text:'Original text '+i,start:'1720-01-01',end:'1720-01-01',precision:'day',session:'s'+Math.floor(i/5),sessionLabel:'Session '+Math.floor(i/5),sourceTitle:'Session',url:'/page/session?context=cleenseau'}));
  const groups=[{label:'Cleenseau',code:'clee',known:true,events}],markup=interactionView(groups);
  const {document}=parseHTML('<html><body>'+interactionSummary(groups)+markup+'</body></html>');
  const root=document.querySelector('[data-interaction-campaign]');
  assert.equal(root.querySelectorAll('.interaction-fallback li').length,27);
  mountInteractions(root);assert.equal(root.querySelector('.interaction-fallback').hidden,true);
  assert.equal(root.querySelector('select'),null,'grouping is automatic without a selector');
  assert.equal(root.querySelector('.interaction-controls').hidden,true,'zoom out is absent until zoomed in');
  assert.equal(root.querySelector('.interaction-detail').hidden,true,'nothing is expanded on initial render');
  assert.equal(root.querySelectorAll('.interaction-dot').length,6);
  root.querySelector('.interaction-dot').click();assert.equal(root.querySelectorAll('.interaction-dot').length,5);
  assert.equal(root.querySelector('.interaction-controls').hidden,false);
  assert.equal(root.querySelector('.interaction-detail').hidden,true,'zooming does not open details');
  root.querySelectorAll('.interaction-dot')[4].click();assert.equal(root.querySelector('.interaction-detail h4').textContent,'Interaction 4');
  root.querySelector('[data-interaction-back]').click();assert.equal(root.querySelectorAll('.interaction-dot').length,6);
  assert.equal(root.querySelector('.interaction-controls').hidden,true);
  assert.equal(JSON.parse(root.querySelector('[data-interaction-records]').textContent).events.length,27);
  const hostile=interactionView([{...groups[0],events:[{...events[0],title:'</script><img src=x onerror=alert(1)>',text:'<script>bad</script>'}]}]);
  const parsed=parseHTML('<html><body>'+hostile+'</body></html>').document;
  assert.equal(parsed.querySelectorAll('img').length,0);assert.equal(parsed.querySelectorAll('script').length,1);
  assert.equal(JSON.parse(parsed.querySelector('script').textContent).events[0].title,JSON.parse(JSON.stringify([{...events[0],title:'</script><img src=x onerror=alert(1)>'}]))[0].title);
});

test('dot popups show source links, dismiss accessibly, stay in the viewport, and clean up when unmounted',()=>{
  const event={id:'one',kind:'encounter',title:'An encounter',text:'Authored recap text.',start:'1720-01-01',end:'1720-01-01',precision:'day',sessionLabel:'Session 1',sourceTitle:'At the Inn',sessionUrl:'/page/session',transcriptUrl:'/campaign-transcripts/one'};
  const markup=interactionView([{code:'clee',label:'Cleenseau',known:true,events:[event]}]);
  const dom=imageDOM(markup+markup+'<button id="outside">Elsewhere</button>'),{document,window,click}=dom;
  Object.defineProperty(window,'innerWidth',{value:400,configurable:true});Object.defineProperty(window,'innerHeight',{value:600,configurable:true});
  const roots=[...document.querySelectorAll('[data-interaction-campaign]')],disposers=roots.map(root=>mountInteractions(root));
  const [first,second]=roots.map(root=>({dot:root.querySelector('.interaction-dot'),popup:root.querySelector('.interaction-detail')}));
  roots[0].getBoundingClientRect=()=>({left:20,top:100});
  first.dot.getBoundingClientRect=()=>({left:350,right:394,top:500,bottom:544,width:44,height:44});
  first.popup.getBoundingClientRect=()=>({width:300,height:240});
  assert.equal(first.popup.hidden,true);assert.equal(first.dot.getAttribute('aria-expanded'),'false');
  assert.notEqual(first.popup.id,second.popup.id,'multiple campaign views have unique dialog identities');
  click(first.dot);
  assert.equal(first.popup.hidden,false);assert.equal(first.popup.getAttribute('role'),'dialog');
  assert.equal(first.dot.getAttribute('aria-controls'),first.popup.id);assert.equal(first.dot.getAttribute('aria-expanded'),'true');
  assert.equal(first.popup.style.left,'68px');assert.equal(first.popup.style.top,'152px','the popup flips above a dot near the bottom edge');
  assert.match(first.popup.textContent,/1720-01-01 DR/);assert.equal(first.popup.querySelectorAll('a').length,2);
  assert.equal(document.activeElement,first.popup.querySelector('button'));
  click(first.popup.querySelector('a'));assert.equal(first.popup.hidden,false,'source links remain clickable');
  click(document.querySelector('#outside'));assert.equal(first.popup.hidden,true);assert.equal(first.dot.getAttribute('aria-expanded'),'false');
  click(first.dot);dom.event(document,'keydown',{key:'Escape'});
  assert.equal(first.popup.hidden,true);assert.equal(document.activeElement,first.dot);
  click(first.dot);click(first.dot);assert.equal(first.popup.hidden,true,'clicking the same dot toggles the popup');
  click(first.dot);click(second.dot);assert.equal(first.popup.hidden,true);assert.equal(second.popup.hidden,false,'only one popup remains open across campaigns');
  click(second.popup.querySelector('button'));assert.equal(second.popup.hidden,true);assert.equal(document.activeElement,second.dot);
  click(first.dot);disposers[0]();assert.equal(first.popup.hidden,true);
  dom.event(document,'keydown',{key:'Escape'});assert.notEqual(document.activeElement,first.dot,'unmount removes the global Escape handler');
  disposers[1]();
});

test('native interaction popovers escape scroll clipping and close on zoom out or disposal',()=>{
  const events=Array.from({length:9},(_,number)=>({id:String(number),kind:'encounter',title:'Encounter '+number,start:'1720-01-01',end:'1720-01-01',precision:'day',session:'session-'+Math.floor(number/3)}));
  const dom=imageDOM(interactionView([{code:'clee',label:'Cleenseau',events}]));
  const root=dom.document.querySelector('[data-interaction-campaign]'),popup=root.querySelector('.interaction-detail');
  let opens=0,closes=0;popup.showPopover=()=>{opens++;};popup.hidePopover=()=>{closes++;};
  const dispose=mountInteractions(root);
  assert.equal(popup.getAttribute('popover'),'manual');assert.equal(opens,0);
  assert.equal(root.querySelector('select'),null);
  dom.click(root.querySelector('.interaction-dot'));assert.equal(opens,0,'a grouped dot zooms without opening details');
  dom.click(root.querySelector('.interaction-dot'));assert.equal(opens,1);
  dom.click(root.querySelector('[data-interaction-back]'));
  assert.equal(popup.hidden,true);assert.equal(closes,1);
  dom.click(root.querySelector('.interaction-dot'));assert.equal(opens,1,'automatic grouping is restored after zooming out');
  dom.click(root.querySelector('.interaction-dot'));assert.equal(opens,2);dispose();assert.equal(closes,2);
});

test('Node recap reader imports only supported recap files and ignores private source artifacts',()=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  const directory=fs.mkdtempSync(path.join(ROOT,'.cache','interactions-'));
  try {
    const cleaned=path.join(directory,'_sessions','cleenseau','cleenseau-012.1','cleaned');fs.mkdirSync(cleaned,{recursive:true});
    fs.writeFileSync(path.join(cleaned,'cleenseau-012.1-session-recap.md'),recap);
    fs.writeFileSync(path.join(cleaned,'cleenseau-012.1-source-cleaned.md'),'private transcript');
    fs.mkdirSync(path.join(cleaned,'beat-transcripts'));
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','approved.md'),'# Beat\n- Source Transcript: /private/raw.md\n## Transcript\n%% u0001-u0003 %%\nPerson: Polished words.');
    const linked=recap.replace('- Locations: Inn','- Locations: Inn\n- Polished Transcript: beat-transcripts/approved.md')
      .replace('### recap-002 | A secret','### recap-002 | A secret\n- Polished Transcript: ../cleenseau-012.1-source-cleaned.md')
      .replace('### recap-003 | Returning','### recap-003 | Returning\n- Polished Transcript: beat-transcripts/missing.md');
    fs.writeFileSync(path.join(cleaned,'cleenseau-012.1-session-recap.md'),linked);
    const result=readInteractionBundles({vault_dir:directory});assert.equal(result.bundles.length,1);
    assert.equal(result.bundles[0].number,'12.1');assert.equal(result.bundles[0].scenes.length,4);
    assert.doesNotMatch(JSON.stringify(result),/private transcript|Long narrative|long account/);
    assert.equal(result.bundles[0].scenes[0].transcript,'Person: Polished words.');
    assert.equal(result.bundles[0].scenes[1].transcript,undefined);
    assert.equal(result.bundles[0].scenes[2].transcript,undefined);
    assert.doesNotMatch(JSON.stringify(result.bundles),/private\/raw|u0001|Source Transcript|transcriptPath/);
    assert.match(result.warnings.join('\n'),/invalid polished transcript reference/);
    const broken=path.join(directory,'_sessions','cleenseau','cleenseau-013','cleaned');fs.mkdirSync(broken,{recursive:true});
    fs.writeFileSync(path.join(broken,'cleenseau-013-session-recap.md'),'Malformed recap');
    const invalid=readInteractionBundles({vault_dir:directory});
    assert.ok(invalid.bundles.some(bundle=>bundle.invalid && bundle.key.includes('cleenseau-013')));
    const store=storeFor({'Person.md':person,'Session.md':session.replace('12.1','13')});
    assert.equal(eventsFor(store,compileInteractionIndex(store,registry,buildBacklinkIndex(store),invalid.bundles)).some(event=>event.kind==='session-reference'),false);
  } finally {const resolved=fs.realpathSync(directory);assert.ok(isInside(fs.realpathSync(path.join(ROOT,'.cache')),resolved));assert.ok(path.basename(resolved).startsWith('interactions-'));fs.rmSync(resolved,{recursive:true});}
});
