import {Engine} from '../src/engine.mjs';
import {preparedPart} from './helpers/compiled-publication.mjs';
import {writeCampaignIndex} from './helpers/write-campaign-index.mjs';
import {testSettings} from './helpers/test-settings.mjs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../src/config.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {compileRuntime} from '../scripts/compile-runtime.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {openSnapshot} from '../src/runtime-snapshot.mjs';
import {ContentStore,parseNote,availableInContext,compileAvailability} from '../src/content-store.mjs';
import {Navigation} from '../src/navigation.mjs';
import {validatePublicationUploads,prunePublication} from '../scripts/content-retention.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {indexSources,featureIndexNotes} from './fixtures/indexes.mjs';

let directory,report,objects,settings;
class Bucket {
  constructor(source=objects) {
    this.objects=new Map(source);this.calls=[];
  }
  async get(key,{range}={}) {
    this.calls.push(key);const data=this.objects.get(key);
    if(data===undefined)return null;
    const bytes=Buffer.from(data);
    return {size:bytes.length,text:async()=>bytes.toString(),json:async()=>JSON.parse(bytes),
      body:new Blob([range ? bytes.subarray(range.offset,range.offset+range.length) : bytes]).stream()};
  }
}
const environment=bucket=>({CONTENT:bucket,ASSETS:{fetch:async()=>new Response('theme')}});
const request=(worker,bucket,url,options)=>worker.fetch(new Request(new URL(url,'https://taelgar.org'),options),environment(bucket));
function recompiledBucket({reverse=false,revision=report.revision,...options}={}) {
  const source=new Engine(settings),render=preparedPart(report,'render');
  const manifest=JSON.parse(fs.readFileSync(report.runtimeFile,'utf8'));
  const assets=Object.keys(manifest.assets).flatMap(key=>preparedPart(report,key));
  const entries=[...render.entries.filter(entry=>entry.note),...assets];
  if(reverse)entries.reverse();
  const index={entries,settings:manifest.settings,registry:source.headers.registry,coreMeta:source.headers.coreMeta,
    warnings:manifest.warnings,backlinks:source.backlinkIndex,interactions:render.interactions,campaignRecords:render.campaignRecords,
    navigationSource:fs.readFileSync(settings.nav_source,'utf8'),homeSource:render.home.source,
    campaignHomes:{frontier:fs.readFileSync(path.join(settings.vault_dir,'_website/frontier.md'),'utf8')}};
  const compiled=compileRuntime(index,source.store,options),bucket=new Bucket();
  for(const key of bucket.objects.keys())if(key.includes('/runtime/') || key.endsWith('/runtime.json'))bucket.objects.delete(key);
  for(const [file,json] of compiled.objects)bucket.objects.set('revisions/'+revision+'/'+file,json);
  bucket.objects.set('revisions/'+revision+'/runtime.json',JSON.stringify({...compiled.manifest,revision}));
  bucket.objects.set('published/current.json',JSON.stringify({revision}));
  return bucket;
}
before(async()=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  directory=fs.mkdtempSync(path.join(ROOT,'.cache','runtime-snapshot-'));
  fs.mkdirSync(path.join(directory,'.obsidian'));fs.mkdirSync(path.join(directory,'_scripts'));fs.mkdirSync(path.join(directory,'_website'));
  const {input}=headerFixture();
  fs.writeFileSync(path.join(directory,'.obsidian/metadata.json'),JSON.stringify(input.coreMeta));
  writeCampaignIndex(directory,{campaigns:{
    frontier:{code:'dufr',name:'Frontier',campaignRoot:'Campaigns/Frontier'},
    adder:{code:'adma',name:'Adder'},
    prologue:{code:'prologue',name:'Prologue'},
    crossover:{code:'crossover',name:'Crossover',continuity:['main','alternate']},
    alternate:{code:'alternate',name:'Alternate',continuity:['alternate']},
    selective:{code:'selective',name:'Selective',canon:'selective'},
    noncanon:{code:'noncanon',name:'Noncanon',canon:'noncanonical'},
  }});
  const notes={
    'Person.md':'---\ntags: [person]\nborn: 1700-01-01\naliases: [Traveler]\n---\n> [!taelgar-header]\n\n# Person body\n\n[[Future]] [[Other]] [[Twin]]\n\n![[Other#Section]]\n\n%% hidden note %%\n%%^Campaign:dufr%%frontier paragraph%%^End%%',
    'Other.md':'---\naliases: [Twin]\n---\n## Section\n\nA nested paragraph. [[Person]] ![[Third]]\n\n%% secret nested %%',
    'Third.md':'---\naliases: [Twin]\n---\nNested leaf.',
    'Future.md':'---\nPOV: 1750s\ncreated: 1740\nexcludePublish: [adma]\n---\nFuture body.',
    'Session.md':'---\ntags: [session-note]\ncampaign: dufr\nDR: 1745-01-01\n---\nSession.',
    'Adder Session.md':'---\ntags: [session-note]\ncampaign: adma\nDR: 1740-01-01\n---\nSession.',
    'Alternate Session.md':'---\ntags: [session-note]\ncampaign: alternate\nDR: 1850-01-01\n---\n[[Other]]',
    'Crossover Session.md':'---\ntags: [session-note]\ncampaign: crossover\nDR: 1860-01-01\n---\n[[Other]]',
  };
  Object.assign(notes,JSON.parse(fs.readFileSync(new URL('./fixtures/backlinks.json',import.meta.url),'utf8')));
  Object.assign(notes,indexSources(featureIndexNotes),{
    'Timeline.md':'# Timeline\n\n```taelgar-events\nyearStart: 1730\nyearEnd: 1760\nincludeLifecycle: true\nincludeTravel: true\n```',
    'History/Chronicle.md':'---\ntags: [background]\n---\n- (DR:: 1730-03-01): **Public record** [[./Witness|witness]].\n- (DR:: 1760): Future record.\n\n%%^Campaign:dufr%%\n- (DR:: 1731-01-01): Frontier record.\n%%^End%%\n\n%%^Campaign:none%%\n- (DR:: 1731-01-01): Private record.\n%%^End%%',
    'History/Witness.md':'A witness.',
    'History/Hidden Event.md':'---\nnoPublish: true\nDR: 1731\n---\nUnpublished event.',
    'Index Guide.md':'# Index Guide\n\n```taelgar-index\ntype: whereabouts\nfrom: person\nvia: home\ntarget: Town\n```\n\n```taelgar-index\ntype: whereabouts\nfrom: group\nvia: current\ntarget: Guild\nshow: obsidian\n```',
    'Index Embed.md':'# Index Embed\n\n![[Index Guide]]',
    'Index Table.md':'```taelgar-index\ntype: whereabouts\nfrom: person\nvia: home\ntarget: Realm\nmode: table\n```',
    'Settlement Table.md':'```taelgar-index\ntype: whereabouts\nfrom: place\nvia: current\nwhere: {typeOf: settlement}\nscope: historical\ncolumns: [name, region, type, population]\ntarget: Realm\nmode: table\n```',
  });
  for(const [file,source] of Object.entries(notes)){
    fs.mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});
    fs.writeFileSync(path.join(directory,file),source);
  }
  fs.writeFileSync(path.join(directory,'sound.mp3'),'fixture sound bytes');
  fs.mkdirSync(path.join(directory,'portraits'));fs.copyFileSync(new URL('../node_modules/leaflet/dist/images/marker-icon.png',import.meta.url),path.join(directory,'portraits/alice.png'));
  fs.writeFileSync(path.join(directory,'_website/home.md'),'# Welcome\n\nA home ![[Other]]');
  fs.writeFileSync(path.join(directory,'_website/frontier.md'),'---\ncampaigns: [dufr]\nenforcePoV: 1\n---\n# Frontier\n\n![[Other]]');
  fs.writeFileSync(path.join(directory,'_website/navigation.md'),'- [Home](index.md)\n- World\n    - {glob: .}\n');
  settings={...testSettings(),vault_dir:directory,source_dir:directory,home_source:path.join(directory,'_website/home.md'),nav_source:path.join(directory,'_website/navigation.md'),respect_pov_dates:true};
  report=await prepareContent(settings,path.join(directory,'output'),{commit:'a'.repeat(40),dirty:false});
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  validatePublicationUploads(report.revision,uploads);
  objects=new Map(uploads.map(item=>[item.key,fs.readFileSync(item.file)]));
  objects.set('published/current.json',fs.readFileSync(report.pointerFile));
});
after(()=>fs.rmSync(directory,{recursive:true,force:true}));

test('website presets, Modern, and Custom require main as the sole continuity',async()=>{
  const worker=createWorker(),bucket=new Bucket();
  const catalogue=await (await request(worker,bucket,'/api/contexts')).json();
  assert.deepEqual(catalogue.contexts.map(context=>context.id),['modern','adma','dufr','prologue','custom']);
  assert.equal(catalogue.contexts[0].date,'1745-01-01');
  assert.equal(catalogue.contexts.find(context=>context.id==='prologue').available,false);
  const html=await (await request(worker,bucket,'/')).text();
  assert.match(html,/<option value="prologue" disabled>/);
  assert.match(html,/name="campaigns" value="prologue" data-campaign-choice/);
  assert.doesNotMatch(html,/(?:name="campaigns" |<option )value="(?:alternate|crossover|selective|noncanon)"/);
  const all=await (await request(worker,bucket,'/api/page?page=Other&campaigns=all')).json();
  assert.deepEqual(all.campaigns,['adma','dufr','prologue']);
  assert.ok(!all.backlinks.some(link=>['alternate-session','crossover-session'].includes(link.page)));
  assert.equal((await request(worker,bucket,'/api/page?page=Other&context=crossover')).status,400);
  for(const campaign of ['Alternate','Crossover','selective','noncanon']) {
    assert.equal((await request(worker,bucket,'/api/page?page=Other&campaigns='+campaign)).status,400);
  }
});

test('compiled Workers calculate visible indexes from metadata and preserve inline blocks through publication',async()=>{
  const bucket=new Bucket(),worker=createWorker();
  const response=await request(worker,bucket,'/api/page?page=Places/Realm.md&date=1720-01-01&campaigns=dufr&pov=1');
  assert.equal(response.status,200);const result=await response.json();
  assert.doesNotMatch(result.html,/taelgar-index-buttons|data-index-lazy/);
  assert.doesNotMatch(result.html,/People\/(?:Hidden|Campaign Secret)|Dead|Future|Visitor/);
  assert.equal(bucket.calls.filter(key=>key.includes('/runtime/notes/')).length,1,'metadata indexes do not fetch candidate bodies');
  const embedded=await request(worker,bucket,'/api/page?page=Index Embed&date=1720-01-01&campaigns=dufr&pov=1');
  assert.equal(embedded.status,200);const page=await embedded.json();assert.match(page.html,/Alice Example/);
  assert.doesNotMatch(page.html,/Treasurer/,'Obsidian-only inline indexes are absent on the website');
  const table=await request(worker,bucket,'/api/page?page=Index Table&date=1720-01-01&campaigns=dufr&pov=1');
  assert.equal(table.status,200);const tabular=await table.json();
  assert.match(tabular.html,/Alice Example.*she\/her AL-iss/s);assert.match(tabular.html,/Townfolk human/);
  assert.match(tabular.html,/Person<\/th>.*Info<\/th>.*Current Location<\/th>.*Home<\/th>/s);
  assert.doesNotMatch(tabular.html,/Visitor|January 1st, 1720/);assert.match(tabular.html,/Other Realm<\/a><\/td>/);
  assert.doesNotMatch(tabular.html,/taelgar-index-image|People\/Hidden/);
  const settlements=await request(worker,bucket,'/api/page?page=Settlement Table&date=1720-01-01&campaigns=dufr&pov=1');
  assert.equal(settlements.status,200);const places=await settlements.json();
  assert.match(places.html,/Place<\/th>.*Region<\/th>.*Type Of<\/th>.*Population<\/th>/s);
  assert.match(places.html,/Ruin/);assert.match(places.html,/pop\. 1,234/);
});

test('cold health, assets and contexts never read rendering, navigation or note data',async()=>{
  for(const url of ['/health','/api/contexts','/assets/sound.mp3','/assets/missing.mp3','/openapi.json']){
    const bucket=new Bucket(),response=await request(createWorker(),bucket,url);
    assert.equal(response.status,url.includes('missing')?404:200,url);
    assert.ok(bucket.calls.every(key=>key==='published/current.json' || key.startsWith('assets/') || key.endsWith('/runtime.json') || /\/runtime\/assets\//.test(key)),JSON.stringify(bucket.calls));
  }
});

test('search and lazy navigation load compact metadata without initializing article rendering',async()=>{
  const bucket=new Bucket(),worker=createWorker();
  assert.equal((await request(worker,bucket,'/api/search?q=Person')).status,200);
  assert.ok(!bucket.calls.some(key=>key.endsWith('/navigation.json')));
  const snapshot=await openSnapshot(bucket,report.revision),navigation=await snapshot.navigation();
  const branch=navigation.roots.find(node=>node.children.length).id;
  assert.equal((await request(worker,bucket,'/api/navigation?branch='+branch)).status,200);
  assert.equal((await request(worker,bucket,'/browse/'+branch)).status,200);
  assert.ok(!bucket.calls.some(key=>/\/(?:headers|render|backlinks)\.json$/.test(key) || /\/notes\//.test(key)));
});

test('cold articles reuse their catalog for navigation without reading search metadata',async()=>{
  const bucket=new Bucket(),worker=createWorker();
  assert.equal((await request(worker,bucket,'/page/person')).status,200);
  assert.ok(!bucket.calls.some(key=>key.endsWith('/search-metadata.json')));
  const render=JSON.parse(bucket.objects.get('revisions/'+report.revision+'/runtime/render.json'));
  assert.ok(render.entries.every(entry=>!Object.hasOwn(entry,'searchMetadata')));
  assert.ok(render.entries.filter(entry=>entry.note).every(entry=>Number.isSafeInteger(entry.note.prepared)));
  // Search must still use the richer catalog after navigation is initialized
  // with article entries; both request orders share one cached navigation tree.
  const a=await request(worker,bucket,'/?q=Traveler'),b=await request(createWorker(),new Bucket(),'/?q=Traveler');
  assert.equal(await a.text(),await b.text());
});

test('bitset views preserve visibility, links and public navigation IDs at byte boundaries',async()=>{
  const snapshot=await openSnapshot(new Bucket(),report.revision),store=await snapshot.searchStore();
  const source=fs.readFileSync(settings.nav_source,'utf8'),original=new Navigation(store,source);
  const compiled=original.compile([{date:'1900-01-01',campaigns:[]},{date:'1901-01-01',campaigns:[]}]);
  assert.equal(compiled.views.length,2);assert.equal(compiled.visibility.length,1);
  const loaded=Navigation.hydrate(store,compiled);
  for(const date of ['1729-12-31','1745-01-01','1900-01-01','1901-01-01'])for(const campaigns of [[],['dufr'],['adma']])for(const pov of [false,true]){
    const context={date,campaigns,pov},a=original.view(context,'person'),b=loaded.view(context,'person');
    assert.deepEqual([...a.visible].map(([id,node])=>[id,!!node.entry]).sort(),[...b.visible].map(([id,node])=>[id,!!node.entry]).sort());
    assert.equal(original.sidebar(a),loaded.sidebar(b));assert.equal(original.breadcrumbs(a),loaded.breadcrumbs(b));
    assert.equal(original.sections(a),loaded.sections(b));
  }
});

test('numeric backlink shards preserve date, campaign, DM and source availability during concurrent renders',async()=>{
  const bucket=recompiledBucket({backlinkShardBytes:1}),worker=createWorker(),standard=new Bucket(),standardWorker=createWorker();
  const urls=[];
  for(const page of ['Backlink Target','Backlink Empty','Person'])for(const date of ['1729-12-31','1730-01-01','1755-01-01'])for(const campaigns of ['dufr','adma','all'])for(const dm of [0,1]){
    urls.push('/api/page?'+new URLSearchParams({page,date,campaigns,dm}));
  }
  for(const page of ['Backlink Target','Backlink Empty','Person']){
    const warm=await request(worker,bucket,'/api/page?'+new URLSearchParams({page}));
    assert.equal(warm.status,200);
  }
  await Promise.all(urls.map(async url=>{
    const a=await request(worker,bucket,url),b=await request(standardWorker,standard,url);
    assert.equal(a.status,200,url);assert.equal(await a.text(),await b.text(),url);
  }));
  const reads=bucket.calls.filter(key=>key.includes('/runtime/backlinks/'));
  assert.equal(reads.length,3);assert.equal(new Set(reads).size,3);
  const fresh=recompiledBucket({backlinkShardBytes:1});
  assert.equal((await request(createWorker(),fresh,'/page/adder-session')).status,200);
  assert.ok(!fresh.calls.some(key=>key.includes('/runtime/backlinks/')));
  const hidden=recompiledBucket({backlinkShardBytes:1});
  assert.equal((await request(createWorker(),hidden,'/page/person?date=1600-01-01')).status,404);
  assert.ok(!hidden.calls.some(key=>/\/runtime\/(?:backlinks|notes)\//.test(key)));
});

test('compact shard failures retry, note cache stays bounded, and numeric IDs stay revision-local',async()=>{
  const bucket=recompiledBucket({backlinkShardBytes:1,noteShardBytes:1}),worker=createWorker();
  const url='/api/page?page=Backlink%20Target&campaigns=all&dm=1';
  const expected=await (await request(worker,bucket,url)).text();
  const key=bucket.calls.find(key=>key.includes('/runtime/backlinks/')),original=bucket.objects.get(key);
  bucket.objects.set(key,'{}');
  const retryWorker=createWorker();assert.equal((await request(retryWorker,bucket,url)).status,503);
  bucket.objects.set(key,original);assert.equal(await (await request(retryWorker,bucket,url)).text(),expected);
  const snapshot=await openSnapshot(bucket,report.revision),{store}=await snapshot.renderer();
  const entries=[...store.bySlug.values()];assert.ok(entries.length>20);
  for(const entry of entries)await store.getNote(entry);
  assert.ok(snapshot.cache.size<=16);
  const before=bucket.calls.length;await store.getNote(entries[0]);assert.equal(bucket.calls.length,before+1);
  const next=recompiledBucket({reverse:true,revision:'c'.repeat(64),backlinkShardBytes:1});
  for(const [key,value] of next.objects)bucket.objects.set(key,value);
  assert.equal(await (await request(worker,bucket,url)).text(),expected);
});

test('raw-only and format 1 revisions fail closed without consulting the former index',async()=>{
  for(const version of [null,1]){
    const bucket=new Bucket(),prefix='revisions/'+report.revision+'/';
    bucket.objects.set(prefix+'index.json','{}');
    if(version===null)bucket.objects.delete(prefix+'runtime.json');
    else bucket.objects.set(prefix+'runtime.json',JSON.stringify({...JSON.parse(bucket.objects.get(prefix+'runtime.json')),version}));
    assert.equal((await request(createWorker(),bucket,'/api/page?page=Person')).status,503);
    assert.deepEqual(bucket.calls,['published/current.json',prefix+'runtime.json']);
  }
});

test('simultaneous dynamic renders reuse completed immutable shard reads',async()=>{
  const bucket=new Bucket(),worker=createWorker();
  assert.equal((await request(worker,bucket,'/api/page?page=Person')).status,200);
  const warmReads=bucket.calls.filter(key=>key.includes('/runtime/notes/'));
  assert.ok(warmReads.length>0);
  const responses=await Promise.all([false,true,false,true].map(dm=>request(worker,bucket,'/api/page?page=Person&dm='+Number(dm))));
  const pages=await Promise.all(responses.map(response=>response.json()));
  assert.deepEqual(pages.map(page=>page.dm),[false,true,false,true]);
  assert.ok(!pages[0].html.includes('hidden note'));assert.ok(pages[1].html.includes('hidden note'));
  assert.match(pages[0].html,/Nested leaf/);
  const noteReads=bucket.calls.filter(key=>key.includes('/runtime/notes/'));
  assert.deepEqual(noteReads,warmReads);
  assert.ok(!bucket.calls.some(key=>/\/revisions\/.*\/notes\/[a-f0-9]{2}\.json/.test('/'+key)));
  const before=noteReads.length;await request(worker,bucket,'/api/page?page=Person&date=1730-01-01');
  assert.equal(bucket.calls.filter(key=>key.includes('/runtime/notes/')).length,before);
});

test('asset ranges, conditional requests, HEAD and methods keep the existing HTTP contract',async()=>{
  const bucket=new Bucket(),worker=createWorker();
  const asset=options=>request(worker,bucket,'/assets/sound.mp3',options);
  const first=await asset();
  assert.equal(await first.text(),'fixture sound bytes');
  const head=await asset({method:'HEAD'});
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  const range=await asset({headers:{Range:'bytes=2-5'}});
  assert.equal(range.status,206);assert.equal(await range.text(),'xtur');
  assert.equal((await asset({headers:{Range:'bytes=999-'}})).status,416);
  assert.equal((await asset({headers:{'If-None-Match':first.headers.get('ETag')}})).status,304);
  assert.equal((await asset({method:'POST'})).status,405);
});

test('corrupt compiled artifacts fail closed and a corrected object can be retried',async()=>{
  const bucket=new Bucket(),manifest=JSON.parse(bucket.objects.get('revisions/'+report.revision+'/runtime.json'));
  const key='revisions/'+report.revision+'/'+manifest.parts.render.file,original=bucket.objects.get(key);
  bucket.objects.set(key,JSON.stringify({entries:[]}));
  const worker=createWorker();assert.equal((await request(worker,bucket,'/api/page?page=Person')).status,503);
  bucket.objects.set(key,original);
  assert.equal((await request(worker,bucket,'/api/page?page=Person')).status,200);
  const invalid=structuredClone(manifest);invalid.version=999;
  bucket.objects.set('revisions/'+report.revision+'/runtime.json',JSON.stringify(invalid));
  assert.equal((await request(createWorker(),bucket,'/health')).status,503);
});

test('compiled lookups preserve ambiguous aliases and availability matches all custom reader modes',()=>{
  const entries=Object.entries({'One.md':'---\naliases: [Same]\ncreated: "1740-05"\nPOV: 1750s\nexcludePublish: [dufr]\n---\nOne','Two.md':'---\naliases: [Same]\n---\nTwo'}).map(([id,source])=>({id,name:id.slice(0,-3),slug:id.toLowerCase().slice(0,-3),target:id.toLowerCase(),note:parseNote(source)}));
  const original=new ContentStore(entries,[],{respect_pov_dates:true});
  const compiled=entries.map(entry=>({...entry,availability:compileAvailability(entry)}));
  const loaded=new ContentStore(compiled,[],original.settings,original.compileLookups());
  assert.equal(loaded.lookup('Same').status,'ambiguous');assert.equal(loaded.resolve('one').id,'One.md');
  for(const date of ['1739-01-01','1740-05-30','1740-05-31','1750-01-01'])for(const campaigns of [[],['dufr'],['adma']])for(const pov of [undefined,false,true]){
    const context={date,campaigns,pov};assert.equal(availableInContext(compiled[0],context,loaded.settings),availableInContext(entries[0],context,original.settings));
  }
});

test('compiled navigation preserves IDs and breadcrumbs while its custom-view cache remains bounded',async()=>{
  const snapshot=await openSnapshot(new Bucket(),report.revision),store=await snapshot.searchStore(),compiled=await snapshot.read(snapshot.index.parts.navigation);
  const navigation=Navigation.hydrate(store,compiled),context=snapshot.contexts.resolve('modern');
  const before=navigation.view(context,'person');
  for(let year=1700;year<1750;year++)navigation.view({...context,date:year+'-01-01',pov:year%2===0},'other');
  assert.equal(navigation.viewCache.size,32);
  const after=navigation.view(context,'person');assert.equal(navigation.breadcrumbs(before),navigation.breadcrumbs(after));
  assert.equal(navigation.sidebar(before),navigation.sidebar(after));
  const hidden=navigation.view({...context,pov:true}),shown=navigation.view({...context,pov:false});
  const id=navigation.paths.get('future').at(-1).id;
  assert.equal(hidden.visible.has(id),true);assert.equal(shown.visible.has(id),true);
});

test('retention validates every compiled dependency before cleanup',async()=>{
  const pointer={revision:report.revision,retentionVersion:1},bucket=new Bucket();
  bucket.objects.set('published/current.json',JSON.stringify(pointer));
  const storage={getJSON:async key=>bucket.objects.has(key)?JSON.parse(bucket.objects.get(key)):null,
    list:async prefix=>[...bucket.objects].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>({key,size:Buffer.byteLength(value)}))};
  const search={verify:async()=>{}};
  assert.equal((await prunePublication(storage,search,pointer,{dryRun:true})).deletedObjects,0);
  for(const folder of ['notes','backlinks','campaigns']){
    const key=[...bucket.objects.keys()].find(key=>key.includes('/runtime/'+folder+'/')),value=bucket.objects.get(key);
    assert.ok(key,folder);bucket.objects.delete(key);
    await assert.rejects(prunePublication(storage,search,pointer,{dryRun:true}),/missing/);
    bucket.objects.set(key,value);
  }
});

test('Worker loads the event artifact only for timelines and isolates reader contexts',async()=>{
  const bucket=recompiledBucket({noteShardBytes:1}),worker=createWorker({},{log:()=>{}});
  const plain=await request(worker,bucket,'/api/page?page=Third');
  assert.equal(plain.status,200);
  assert.ok(!bucket.calls.some(key=>key.endsWith('/runtime/events.json')));
  const before=bucket.calls.filter(key=>key.includes('/runtime/notes/')).length;
  const [publicResponse,privateResponse]=await Promise.all([
    request(worker,bucket,'/api/page?page=Timeline&date=1750-01-01'),
    request(worker,bucket,'/api/page?page=Timeline&date=1750-01-01&campaigns=dufr&dm=1'),
  ]);
  assert.equal(publicResponse.status,200);assert.equal(privateResponse.status,200);
  const publicView=(await publicResponse.json()).html,privateView=(await privateResponse.json()).html;
  assert.match(publicView,/<strong>Public record<\/strong>/);
  assert.match(publicView,/href="\/page\/history\/witness\?[^"]+">witness<\/a>/);
  assert.doesNotMatch(publicView,/Frontier record|Private record|Future record|Unpublished event/);
  assert.match(privateView,/Frontier record/);assert.match(privateView,/Private record/);
  assert.doesNotMatch(privateView,/Future record|Unpublished event/);
  assert.equal(bucket.calls.filter(key=>key.endsWith('/runtime/events.json')).length,2,'one artifact load per request without an edge cache');
  assert.equal(bucket.calls.filter(key=>key.includes('/runtime/notes/')).length-before,2,'each request uses only the timeline note body');
  const earlier=new Bucket(objects);
  const key='revisions/'+report.revision+'/runtime.json';
  const manifest=JSON.parse(earlier.objects.get(key));
  delete manifest.parts.events;
  earlier.objects.set(key,JSON.stringify(manifest));
  const response=await request(createWorker({},{log:()=>{}}),earlier,'/api/page?page=Timeline&date=1750-01-01');
  assert.match((await response.json()).html,/Timeline data is unavailable/);
});
