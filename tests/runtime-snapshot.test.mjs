import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,loadSettings} from '../src/config.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {openSnapshot} from '../src/runtime-snapshot.mjs';
import {ContentStore,parseNote,availableInContext,compileAvailability} from '../src/content-store.mjs';
import {Navigation} from '../src/navigation.mjs';
import {validatePublicationUploads,prunePublication} from '../scripts/content-retention.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';

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
before(async()=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  directory=fs.mkdtempSync(path.join(ROOT,'.cache','runtime-snapshot-'));
  fs.mkdirSync(path.join(directory,'.obsidian'));fs.mkdirSync(path.join(directory,'_scripts'));fs.mkdirSync(path.join(directory,'_website'));
  const {input}=headerFixture();
  fs.writeFileSync(path.join(directory,'.obsidian/metadata.json'),JSON.stringify(input.coreMeta));
  fs.writeFileSync(path.join(directory,'_scripts/session_note_campaigns.json'),JSON.stringify({campaigns:{frontier:{code:'dufr',name:'Frontier',campaignRoot:'Campaigns/Frontier'},adder:{code:'adma',name:'Adder'}}}));
  const notes={
    'Person.md':'---\ntags: [person]\nborn: 1700-01-01\naliases: [Traveler]\n---\n```taelgar-header\n```\n\n# Person body\n\n[[Future]] [[Other]] [[Twin]]\n\n![[Other#Section]]\n\n%% hidden note %%\n%%^Campaign:dufr%%frontier paragraph%%^End%%',
    'Other.md':'---\naliases: [Twin]\n---\n## Section\n\nA nested paragraph. ![[Third]]\n\n%% secret nested %%',
    'Third.md':'---\naliases: [Twin]\n---\nNested leaf.',
    'Future.md':'---\nPOV: 1750s\ncreated: 1740\nexcludePublish: [adma]\n---\nFuture body.',
    'Session.md':'---\ntags: [session-note]\ncampaign: dufr\nDR: 1745-01-01\n---\nSession.',
    'Adder Session.md':'---\ntags: [session-note]\ncampaign: adma\nDR: 1740-01-01\n---\nSession.',
  };
  for(const [file,source] of Object.entries(notes))fs.writeFileSync(path.join(directory,file),source);
  fs.writeFileSync(path.join(directory,'sound.mp3'),'fixture sound bytes');
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
  bucket.objects.delete([...bucket.objects.keys()].find(key=>key.includes('/runtime/notes/')));
  await assert.rejects(prunePublication(storage,search,pointer,{dryRun:true}),/missing/);
});
