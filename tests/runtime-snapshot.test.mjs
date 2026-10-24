import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,loadSettings} from '../src/config.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {compileRuntime} from '../scripts/compile-runtime.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {openSnapshot} from '../src/runtime-snapshot.mjs';
import {ContentStore,parseNote,availableInContext,compileAvailability} from '../src/content-store.mjs';
import {Navigation} from '../src/navigation.mjs';
import {validatePublicationUploads,prunePublication} from '../scripts/content-retention.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {indexSources,featureIndexNotes} from './fixtures/indexes.mjs';
import {registryDocument} from './helpers/index-registry.mjs';
import {cintraSource,cintraSentence} from './fixtures/index-descriptions.mjs';

let directory,report,objects,settings;
class Bucket {
  constructor(source=objects,{legacy=false}={}) {
    this.objects=new Map(source);this.calls=[];
    if(legacy)for(const key of this.objects.keys())if(key.endsWith('/runtime.json') || key.includes('/runtime/'))this.objects.delete(key);
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
  const index=JSON.parse(objects.get('revisions/'+report.revision+'/index.json'));
  if(reverse)index.entries.reverse();
  const entries=index.entries.map(entry=>entry.note ? {...entry,note:parseNote(JSON.parse(objects.get('revisions/'+report.revision+'/notes/'+entry.note.shard+'.json'))[entry.id])} : entry);
  const compiled=compileRuntime(index,new ContentStore(entries,index.warnings,index.settings),options),bucket=new Bucket();
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
  const registry=structuredClone(registryDocument);registry.hosts.obsidian={indexes:{members:{label:'PERSONAL_REGISTRY_SENTINEL'}}};registry.indexes.residents.cards.body=null;registry.indexes['waterways-in-watershed'].cards.body=null;
  fs.writeFileSync(path.join(directory,'_scripts/indexes.yaml'),JSON.stringify(registry));
  fs.writeFileSync(path.join(directory,'.obsidian/metadata.json'),JSON.stringify(input.coreMeta));
  fs.writeFileSync(path.join(directory,'_scripts/session_note_campaigns.json'),JSON.stringify({campaigns:{frontier:{code:'dufr',name:'Frontier',campaignRoot:'Campaigns/Frontier'},adder:{code:'adma',name:'Adder'}}}));
  const notes={
    'Person.md':'---\ntags: [person]\nborn: 1700-01-01\naliases: [Traveler]\n---\n```taelgar-header\n```\n\n# Person body\n\n[[Future]] [[Other]] [[Twin]]\n\n![[Other#Section]]\n\n%% hidden note %%\n%%^Campaign:dufr%%frontier paragraph%%^End%%',
    'Other.md':'---\naliases: [Twin]\n---\n## Section\n\nA nested paragraph. [[Person]] ![[Third]]\n\n%% secret nested %%',
    'Third.md':'---\naliases: [Twin]\n---\nNested leaf.',
    'Future.md':'---\nPOV: 1750s\ncreated: 1740\nexcludePublish: [adma]\n---\nFuture body.',
    'Session.md':'---\ntags: [session-note]\ncampaign: dufr\nDR: 1745-01-01\n---\nSession.',
    'Adder Session.md':'---\ntags: [session-note]\ncampaign: adma\nDR: 1740-01-01\n---\nSession.',
  };
  Object.assign(notes,JSON.parse(fs.readFileSync(new URL('./fixtures/backlinks.json',import.meta.url),'utf8')));
  Object.assign(notes,indexSources(featureIndexNotes),{
    'Index Guide.md':'# Index Guide\n\n```taelgar-index\nindex: residents\ntarget: Town\n```\n\n```taelgar-index\nindex: members\ntarget: Guild\nshow: obsidian\n```',
    'Index Embed.md':'# Index Embed\n\n![[Index Guide]]',
    'Index Table.md':'```taelgar-index\nindex: residents\ntarget: Realm\nmode: table\n```',
    'Settlement Table.md':'```taelgar-index\nindex: settlements-in\ntarget: Realm\nmode: table\n```',
    'Member Table.md':'```taelgar-index\nindex: members\ntarget: Guild\nmode: table\n```',
    'People/Cintra.md':cintraSource,
    'Groups/Shakun Mystai.md':'---\ntags: [group]\n---\n```taelgar-header\n```',
    'Cintra Grid.md':'```taelgar-index\nindex: members\ntarget: Shakun Mystai\n```',
    'Cintra Embed.md':'![[Cintra Grid]]',
  });
  notes['People/Alice.md']=notes['People/Alice.md'].replace('Authored prose.',
    '%%^Campaign:none%%Private member description.%%^End%%\n\n%%^Campaign:dufr%%Frontier member description.%%^End%%\n\n%%^Date:1720-01-01b%%Earlier member description.%%^End%%\n\nPublic member description. Second sentence.');
  for(const [file,source] of Object.entries(notes)){
    fs.mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});
    fs.writeFileSync(path.join(directory,file),source);
  }
  fs.writeFileSync(path.join(directory,'sound.mp3'),'fixture sound bytes');
  fs.mkdirSync(path.join(directory,'portraits'));fs.copyFileSync(new URL('../node_modules/leaflet/dist/images/marker-icon.png',import.meta.url),path.join(directory,'portraits/alice.png'));
  fs.writeFileSync(path.join(directory,'_website/home.md'),'# Welcome\n\nA home ![[Other]]');
  fs.writeFileSync(path.join(directory,'_website/frontier.md'),'---\ncampaigns: [dufr]\nenforcePoV: 1\n---\n# Frontier\n\n![[Other]]');
  fs.writeFileSync(path.join(directory,'_website/navigation.md'),'- [Home](index.md)\n- World\n    - {glob: .}\n');
  settings={...loadSettings(),vault_dir:directory,source_dir:directory,home_source:path.join(directory,'_website/home.md'),nav_source:path.join(directory,'_website/navigation.md'),respect_pov_dates:true};
  report=await prepareContent(settings,path.join(directory,'output'),{commit:'a'.repeat(40),dirty:false});
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  validatePublicationUploads(report.revision,uploads);
  objects=new Map(uploads.map(item=>[item.key,fs.readFileSync(item.file)]));
  objects.set('published/current.json',fs.readFileSync(report.pointerFile));
});
after(()=>fs.rmSync(directory,{recursive:true,force:true}));

test('compiled and legacy snapshots produce identical dynamic HTML, APIs, embeds and reader contexts',async()=>{
  const current=new Bucket(),legacy=new Bucket(objects,{legacy:true}),worker=createWorker(),old=createWorker();
  const routes=['/health','/api/contexts','/','/?q=Person','/?q=&type=person','/api/search?q=Person',
    '/page/person','/api/page?page=Person','/page/other?date=1730-01-01&campaigns=all&dm=1',
    '/page/person?context=frontier&dm=1','/page/future?pov=0','/page/future?pov=1','/page/person?date=1720-01-01&campaigns=adma,dufr&pov=0',
    'https://frontier.taelgar.org/','https://frontier.taelgar.org/page/person?context=modern&pov=0',
    'https://missing.taelgar.org/','/page/missing','/api/page?page=Twin','/docs','/openapi.json','/missing','/%ZZ'];
  for(const url of routes){
    const a=await request(worker,current,url),b=await request(old,legacy,url);
    assert.equal(a.status,b.status,url);assert.deepEqual([...a.headers],[...b.headers],url);
    assert.equal(await a.text(),await b.text(),url);
  }
});

test('compiled and legacy Workers calculate visible indexes from metadata and preserve inline blocks through publication',async()=>{
  for(const legacy of [false,true]) {
    const coldBucket=new Bucket(objects,{legacy});
    const cold=await request(createWorker(),coldBucket,'/api/index?page=Places/Realm.md&index=residents&date=1720-01-01&campaigns=dufr&pov=1');
    assert.equal(cold.status,200);
    assert.ok(!coldBucket.calls.some(key=>/\/(?:runtime\/)?notes\//.test(key)),'popup API uses metadata without note-body reads');
    const bucket=new Bucket(objects,{legacy}),worker=createWorker();
    const response=await request(worker,bucket,'/api/page?page=Places/Realm.md&date=1720-01-01&campaigns=dufr&pov=1');
    assert.equal(response.status,200);const result=await response.json();
    assert.match(result.html,/data-index-lazy/);assert.doesNotMatch(result.html,/taelgar-index-card|taelgar-index-image/);
    const content=await request(worker,bucket,'/api/index?page=Places/Realm.md&index=residents&date=1720-01-01&campaigns=dufr&pov=1');
    assert.equal(content.status,200);const grid=await content.text();
    assert.match(grid,/taelgar-index-image/);assert.match(grid,/Alice Example<\/a> \(she\/her AL-iss\)/);
    assert.doesNotMatch(grid,/Hidden|Campaign Secret|POV Secret|Future|Dead|Visitor/);
    assert.doesNotMatch(result.html,/People\/(?:Hidden|Campaign Secret|POV Secret)|Dead|Future|Visitor/);
    if(!legacy)assert.equal(bucket.calls.filter(key=>key.includes('/runtime/notes/')).length,1,'metadata indexes do not fetch candidate bodies');
    const embedded=await request(worker,bucket,'/api/page?page=Index Embed&date=1720-01-01&campaigns=dufr&pov=1');
    assert.equal(embedded.status,200);const page=await embedded.json();assert.match(page.html,/Alice Example/);
    assert.doesNotMatch(page.html,/Treasurer/,'Obsidian-only inline indexes are absent on the website');
    const table=await request(worker,bucket,'/api/page?page=Index Table&date=1720-01-01&campaigns=dufr&pov=1');
    assert.equal(table.status,200);const tabular=await table.json();
    assert.match(tabular.html,/Alice Example.*she\/her AL-iss/s);assert.match(tabular.html,/Townfolk human/);
    assert.match(tabular.html,/Person<\/th>.*Info<\/th>.*Home<\/th>.*Current Location<\/th>/s);
    assert.doesNotMatch(tabular.html,/Visitor/);assert.match(tabular.html,/January 1st, 1720/);
    assert.doesNotMatch(tabular.html,/taelgar-index-image|People\/Hidden/);
    const settlements=await request(worker,bucket,'/api/page?page=Settlement Table&date=1720-01-01&campaigns=dufr&pov=1');
    assert.equal(settlements.status,200);const places=await settlements.json();
    assert.match(places.html,/Name<\/th>.*Region<\/th>.*Population<\/th>/s);
    assert.match(places.html,/Ruin/);assert.match(places.html,/pop\. 1,234/);
    const members=await request(worker,bucket,'/api/page?page=Member Table&date=1720-01-01&campaigns=dufr&pov=1');
    assert.equal(members.status,200);const people=await members.json();
    assert.match(people.html,/Person<\/th>.*Role<\/th>.*Joined<\/th>/s);
    assert.match(people.html,/she\/her AL-iss/);assert.match(people.html,/January 1st, 1710/);
    assert.doesNotMatch(people.html,/People\/(?:Hidden|Campaign Secret|POV Secret)|Future/);assert.match(people.html,/Dead/);
  }
});

test('published Members grids load prose lazily in compiled and legacy Workers, including inline indexes and embeds',async()=>{
  const compiled=recompiledBucket({noteShardBytes:1}),legacy=new Bucket(objects,{legacy:true});
  const worker=createWorker(),old=createWorker();
  const popup='/api/index?page=Groups/Shakun%20Mystai.md&index=members&date=1748-06-01';
  const header=await request(worker,compiled,'/api/page?page=Groups/Shakun%20Mystai.md&date=1748-06-01');
  assert.equal(header.status,200);assert.match((await header.json()).html,/data-index="members"/);
  assert.equal(compiled.calls.filter(key=>key.includes('/runtime/notes/')).length,1,'opening the header does not read member bodies');
  for(const url of [popup,'/api/page?page=Cintra%20Grid&date=1748-06-01','/api/page?page=Cintra%20Embed&date=1748-06-01']) {
    const a=await request(worker,compiled,url),b=await request(old,legacy,url);
    assert.equal(a.status,200,url);assert.equal(b.status,200,url);
    const left=await a.text(),right=await b.text();
    assert.equal(left,right,url);assert.ok(left.includes(cintraSentence),url);
    assert.doesNotMatch(left,/Cintra, the Supreme Oracle|Private preparation|\[!image/);
  }
  const reads=compiled.calls.filter(key=>key.includes('/runtime/notes/'));
  assert.equal(reads.length,4,'only the group, member, inline index and embedding page are loaded');
  assert.equal(reads.length,new Set(reads).size,'member bodies share the immutable shard cache');
});

test('concurrent published Members requests keep description date, campaign and DM filtering request-local',async()=>{
  for(const legacy of [false,true]) {
    const bucket=legacy ? new Bucket(objects,{legacy:true}) : recompiledBucket({noteShardBytes:1}),worker=createWorker();
    const cases=[
      ['1720-01-01','adma',0,'Public member description.'],
      ['1720-01-01','dufr',0,'Frontier member description.'],
      ['1719-12-31','adma',0,'Earlier member description.'],
      ['1720-01-01','adma',1,'Private member description.'],
    ];
    await Promise.all(cases.map(async([date,campaigns,dm,expected])=>{
      const response=await request(worker,bucket,'/api/index?'+new URLSearchParams({page:'Groups/Guild.md',index:'members',date,campaigns,dm}));
      assert.equal(response.status,200);const html=await response.text();
      assert.ok(html.includes(expected));
      for(const other of cases.map(row=>row[3]).filter(sentence=>sentence!==expected))assert.ok(!html.includes(other));
      assert.doesNotMatch(html,/Second sentence/);
    }));
  }
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
  const a=await request(worker,bucket,'/?q=Traveler'),b=await request(createWorker(),new Bucket(objects,{legacy:true}),'/?q=Traveler');
  assert.equal(await a.text(),await b.text());
});

test('bitset views preserve visibility, links and public navigation IDs at byte boundaries',async()=>{
  const snapshot=await openSnapshot(new Bucket(),report.revision),store=await snapshot.searchStore();
  const source=fs.readFileSync(settings.nav_source,'utf8'),original=new Navigation(store,source);
  const compiled=original.compile([{date:'1900-01-01',campaigns:[]},{date:'1901-01-01',campaigns:[]}]);
  assert.equal(compiled.views.length,4);assert.equal(compiled.visibility.length,1);
  const loaded=Navigation.hydrate(store,compiled);
  for(const date of ['1729-12-31','1745-01-01','1900-01-01','1901-01-01'])for(const campaigns of [[],['dufr'],['adma']])for(const pov of [false,true]){
    const context={date,campaigns,pov},a=original.view(context,'person'),b=loaded.view(context,'person');
    assert.deepEqual([...a.visible].map(([id,node])=>[id,!!node.entry]).sort(),[...b.visible].map(([id,node])=>[id,!!node.entry]).sort());
    assert.equal(original.sidebar(a),loaded.sidebar(b));assert.equal(original.breadcrumbs(a),loaded.breadcrumbs(b));
    assert.equal(original.sections(a),loaded.sections(b));
  }
});

test('numeric backlink shards preserve date, campaign, DM and source availability during concurrent renders',async()=>{
  const bucket=recompiledBucket({backlinkShardBytes:1}),worker=createWorker(),legacy=new Bucket(objects,{legacy:true}),old=createWorker();
  const urls=[];
  for(const page of ['Backlink Target','Backlink Empty','Person'])for(const date of ['1729-12-31','1730-01-01','1755-01-01'])for(const campaigns of ['dufr','adma','all'])for(const dm of [0,1]){
    urls.push('/api/page?'+new URLSearchParams({page,date,campaigns,dm}));
  }
  await Promise.all(urls.map(async url=>{
    const a=await request(worker,bucket,url),b=await request(old,legacy,url);
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

test('frozen runtime v1 publications still render and retain all dependencies',async()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/runtime-v1.json',import.meta.url),'utf8'));
  const {revision}=fixture.manifest,prefix='revisions/'+revision+'/',pointer={revision,retentionVersion:1};
  const source=new Map([['published/current.json',JSON.stringify(pointer)],[prefix+'index.json',JSON.stringify(fixture.index)],
    [prefix+'runtime.json',JSON.stringify(fixture.manifest)],[prefix+'notes/00.json',JSON.stringify(fixture.rawNotes)],
    ...Object.entries(fixture.artifacts).map(([file,value])=>[prefix+file,JSON.stringify(value)])]);
  const bucket=new Bucket(source),legacy=new Bucket(source,{legacy:true}),worker=createWorker(),old=createWorker();
  for(const url of ['/','/?q=Traveler','/page/person','/api/page?page=Other&dm=1','/page/future?pov=0','/page/future?pov=1']){
    const a=await request(worker,bucket,url),b=await request(old,legacy,url);assert.equal(a.status,b.status);assert.equal(await a.text(),await b.text(),url);
  }
  const storage={getJSON:async key=>source.has(key)?JSON.parse(source.get(key)):null,
    list:async prefix=>[...source].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>({key,size:Buffer.byteLength(value)}))};
  assert.equal((await prunePublication(storage,{verify:async()=>{}},pointer,{dryRun:true})).deletedObjects,0);
});

test('prepared notes and immutable shards are reused across simultaneous dynamic renders',async()=>{
  const bucket=new Bucket(),worker=createWorker();
  const responses=await Promise.all([false,true,false,true].map(dm=>request(worker,bucket,'/api/page?page=Person&dm='+Number(dm))));
  const pages=await Promise.all(responses.map(response=>response.json()));
  assert.deepEqual(pages.map(page=>page.dm),[false,true,false,true]);
  assert.ok(!pages[0].html.includes('hidden note'));assert.ok(pages[1].html.includes('hidden note'));
  assert.match(pages[0].html,/Nested leaf/);
  const noteReads=bucket.calls.filter(key=>key.includes('/runtime/notes/'));
  assert.equal(noteReads.length,new Set(noteReads).size);
  assert.ok(!bucket.calls.some(key=>/\/revisions\/.*\/notes\/[a-f0-9]{2}\.json/.test('/'+key)));
  const before=noteReads.length;await request(worker,bucket,'/api/page?page=Person&date=1730-01-01');
  assert.equal(bucket.calls.filter(key=>key.includes('/runtime/notes/')).length,before);
});

test('asset ranges, conditional requests, HEAD and methods keep the existing HTTP contract',async()=>{
  const a=new Bucket(),b=new Bucket(objects,{legacy:true}),worker=createWorker(),old=createWorker();
  const first=await request(worker,a,'/assets/sound.mp3'),etag=first.headers.get('ETag');
  for(const options of [{method:'HEAD'},{headers:{Range:'bytes=2-5'}},{headers:{Range:'bytes=999-'}},{headers:{'If-None-Match':etag}},{method:'POST'}]){
    const left=await request(worker,a,'/assets/sound.mp3',options),right=await request(old,b,'/assets/sound.mp3',options);
    assert.equal(left.status,right.status);assert.deepEqual([...left.headers],[...right.headers]);assert.equal(await left.text(),await right.text());
  }
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
  assert.equal(hidden.visible.has(id),false);assert.equal(shown.visible.has(id),true);
});

test('retention validates every compiled dependency before cleanup',async()=>{
  const pointer={revision:report.revision,retentionVersion:1},bucket=new Bucket();
  bucket.objects.set('published/current.json',JSON.stringify(pointer));
  const storage={getJSON:async key=>bucket.objects.has(key)?JSON.parse(bucket.objects.get(key)):null,
    list:async prefix=>[...bucket.objects].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>({key,size:Buffer.byteLength(value)}))};
  const search={verify:async()=>{}};
  assert.equal((await prunePublication(storage,search,pointer,{dryRun:true})).deletedObjects,0);
  for(const folder of ['notes','backlinks']){
    const key=[...bucket.objects.keys()].find(key=>key.includes('/runtime/'+folder+'/')),value=bucket.objects.get(key);
    assert.ok(key,folder);bucket.objects.delete(key);
    await assert.rejects(prunePublication(storage,search,pointer,{dryRun:true}),/missing/);
    bucket.objects.set(key,value);
  }
});


test('compiled and legacy Workers render Rivers and Places from metadata without note-body reads',async()=>{
  for(const legacy of [false,true])for(const [type,page,expected,excluded] of [
    ['waterways-in-watershed','Basin','Main River','Hidden River'],['places-in','Town','Shop','Hidden Building'],
  ]) {
    const bucket=new Bucket(objects,{legacy}),worker=createWorker();
    const response=await request(worker,bucket,'/api/index?page=Places/'+page+'.md&index='+type+'&context=custom&date=1720-01-01');
    assert.equal(response.status,200);const html=await response.text();
    assert.match(html,new RegExp(expected));assert.doesNotMatch(html,new RegExp(excluded+'|Future'));
    assert.ok(!bucket.calls.some(key=>/\/(?:runtime\/)?notes\//.test(key)));
    const header=await request(worker,bucket,'/api/page?page=Places/'+page+'.md&context=custom&date=1720-01-01');
    assert.equal(header.status,200);const result=await header.json();
    assert.match(result.html,new RegExp('data-index="'+type+'"'));assert.doesNotMatch(result.html,/taelgar-index-card/);
  }
});

test('publication includes only the effective website registry in both snapshot formats',()=>{
  for(const filename of ['/index.json','/runtime.json']) {
    const source=objects.get('revisions/'+report.revision+filename).toString(),index=JSON.parse(source);
    assert.equal(index.indexRegistry.indexes.members.label,'Members');
    assert.equal(index.indexRegistry.hosts,undefined);
    assert.doesNotMatch(source,/PERSONAL_REGISTRY_SENTINEL|indexes\.mike\.yaml/);
  }
});
