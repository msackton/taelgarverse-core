import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {load} from 'cheerio';
import {ROOT,loadSettings,isInside} from '../src/config.mjs';
import {Engine} from '../src/engine.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {loadSnapshot} from '../src/snapshot.mjs';
import {instantiate} from '../src/worker-headers.mjs';

let directory,report,bucket,engine,worker,env;
class LocalBucket {
  constructor(uploads) {this.objects=new Map(uploads.map(item=>[item.key,item.file]));this.calls=new Map();this.missing=new Set();}
  async get(key,options={}) {
    this.calls.set(key,(this.calls.get(key)||0)+1);
    if (this.missing.has(key) || !this.objects.has(key)) return null;
    const data=fs.readFileSync(this.objects.get(key)),range=options.range;
    return {size:data.length,json:async()=>JSON.parse(data.toString()),body:new Blob([range ? data.subarray(range.offset,range.offset+range.length) : data]).stream()};
  }
}
const request = (url,options)=>worker.fetch(new Request('https://example.test'+url,options),env);
before(async()=>{
  directory=fs.mkdtempSync(path.join(ROOT,'.cache','worker-test-'));
  const source=path.join(directory,'notes');fs.mkdirSync(source);
  const notes=JSON.parse(fs.readFileSync(new URL('./fixtures/notes.json',import.meta.url),'utf8'));
  for (const [relative,text] of Object.entries(notes)) {
    const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);
  }
  fs.writeFileSync(path.join(source,'tiny.png'),'fixture asset');
  for (const relative of ['assets/audio/song.mp3','assets/session-audio/session/clip.m4a','assets/excalidraw/drawing.png']) {
    const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,'media fixture: ' + relative);
  }
  for (const relative of ['assets/dm/map.png','assets/dm/nested/secret.png','asset/dm/map.png',
    'assets/dm-map.png','assets/dm-reference/map.png','assets/_portrait.png','assets/worldbuilding/hidden.png','assets/_internal/hidden.png']) {
    const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture asset');
  }
  fs.writeFileSync(path.join(source,'Session.md'),'---\ntags: [session-note]\ncampaign: dufr\nDR: 1720-01-01\n---\nSession.\n');
  fs.writeFileSync(path.join(source,'AdderSession.md'),'---\ntags: [session-note]\ncampaign: adma\nDR: 1720-01-01\n---\nSession.\n');
  fs.writeFileSync(path.join(source,'Linked.md'),[
    '---', 'tags: [person]', 'name: Link Example', 'species: human', 'born: 1700-01-01',
    'whereabouts:', '  - {type: home, location: CampaignHidden}', '---', '<!-- taelgar:header -->',
    '', '## Links', '', '[[Hidden|hidden label]] [[CampaignHidden|campaign label]]',
    '[[Unborn|birth label]] [[Unbuilt|creation label]] [[Future|active label]]', '',
    '%%DM [[CampaignHidden|popup campaign]] and [[Unborn|popup birth]].%%',
  ].join('\n'));
  fs.writeFileSync(path.join(source,'_ignore.txt'),'Ignored/\n');
  fs.writeFileSync(path.join(source,'_nav.md'),'- [Home](index.md)\n- People\n    - {glob: people/}\n- Places\n    - {glob: places/}\n');
  const settings={...loadSettings(),source_dir:source,ignore_file:path.join(source,'_ignore.txt'),nav_source:path.join(source,'_nav.md'),campaigns:['dufr','adma']};
  report=await prepareContent(settings,path.join(directory,'package'));
  bucket=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),
    {key:'published/current.json',file:report.pointerFile}]);
  env={CONTENT:bucket,ASSETS:{fetch:async request=>new Response(new URL(request.url).pathname)}};
  engine=new Engine(settings);worker=createWorker(instantiate);
});
after(()=>{if(directory && isInside(path.join(ROOT,'.cache'),directory))fs.rmSync(directory,{recursive:true});});

test('packaged snapshot has no machine paths or raw note bodies in the metadata index',()=>{
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  assert.equal(index.entries.filter(e=>e.note).length,engine.store.bySlug.size);
  const ids=new Set(index.entries.map(e=>e.id));
  for (const id of ['Hidden.md','CampaignHidden.md','Unborn.md','Unbuilt.md','Ignored/Invisible.md','Drawing.md','_Loose.md','assets/dm-map.png','assets/dm-reference/map.png','assets/_portrait.png']) {
    assert.ok(ids.has(id),id);
  }
  for (const id of ['_dm_notes/Secret.md','Worldbuilding/Hidden World.md','Nested/worldbuilding/Hidden World.md','Nested/_private/Hidden Nested.md','assets/worldbuilding/hidden.png','assets/_internal/hidden.png','assets/dm/map.png','assets/dm/nested/secret.png','asset/dm/map.png']) {
    assert.equal(ids.has(id),false,id);
  }
  assert.equal(index.entries.find(e=>e.id==='Hidden.md').note.metadata.excludePublish,'all');
  assert.doesNotMatch(JSON.stringify(index),/source_dir|runtime_dir|Fixture biography|private ordinary comment/);
  assert.equal(index.entries.every(e=>!('filename' in e)),true);
});

test('Worker rejects unavailable pages before reading any note body and permits them in other contexts',async()=>{
  const isolated=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),
    {key:'published/current.json',file:report.pointerFile}]);
  const app=createWorker(instantiate), environment={...env,CONTENT:isolated};
  const fetch=path=>app.fetch(new Request('https://example.test'+path),environment);
  for (const [page,query] of [
    ['Hidden','context=modern'],['Hidden','date=1800-01-01'],
    ['CampaignHidden','context=dunmar-frontier'],['Unborn','date=1730-04-01'],['Unbuilt','date=1730-04-01'],
  ]) {
    for (const dm of ['0','1']) for (const route of ['/api/page?page='+page+'&','/page/'+page+'?']) {
      const response=await fetch(route+query+'&dm='+dm);
      assert.equal(response.status,404,route+query);
      assert.doesNotMatch(await response.text(),/Private page\.|Unborn biography\.|Unbuilt history\./);
    }
  }
  assert.equal([...isolated.calls.keys()].some(key=>key.includes('/notes/')),false);
  for (const [page,query] of [
    ['CampaignHidden','context=modern'],['CampaignHidden','context=addermarch'],
    ['Unborn','date=1730-04-02'],['Unbuilt','date=1730-04-02'],['Invisible','context=modern'],['Drawing','context=modern'],
  ]) assert.equal((await fetch('/api/page?page='+page+'&'+query)).status,200,page);
  assert.equal((await fetch('/assets/assets/dm/map.png')).status,404);
  assert.equal((await fetch('/assets/asset/dm/map.png')).status,404);
  assert.equal((await fetch('/assets/assets/dm-map.png')).status,200);
  assert.equal((await fetch('/assets/assets/dm-reference/map.png')).status,200);
  assert.equal((await fetch('/assets/assets/worldbuilding/hidden.png')).status,404);
});

test('Worker renders the same article as the VM reference and isolates request preferences',async()=>{
  const settings=[['1720-01-01',false],['1730-01-01',true],['1720-01-01',true],['1730-01-01',false]];
  const results=await Promise.all(settings.map(async([date,dm])=>{
    const response=await request('/api/page?'+new URLSearchParams({page:'Example',date,dm:String(dm)}));
    assert.equal(response.status,200);
    const result=await response.json();
    assert.deepEqual(result,engine.render('Example',date,undefined,dm));
    return result;
  }));
  assert.doesNotMatch(results[0].html,/private ordinary comment|secret body/);
  assert.match(results[1].html,/private ordinary comment|secret body/);
  const key='revisions/'+report.revision+'/index.json';assert.equal(bucket.calls.get(key),1);
  const entry=engine.store.resolve('Example');
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  const shard=index.entries.find(e=>e.id===entry.id).note.shard;
  assert.equal(bucket.calls.get('revisions/'+report.revision+'/notes/'+shard+'.json'),1);
});

test('Worker filters article, generated header and DM links from metadata without loading target bodies',async()=>{
  const isolated=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),
    {key:'published/current.json',file:report.pointerFile}]);
  const app=createWorker(instantiate), environment={...env,CONTENT:isolated};
  for (const [query,campaignVisible,bornVisible,activeVisible] of [
    ['context=dunmar-frontier',false,false,false],
    ['context=addermarch',true,false,false],
    ['date=1730-04-01',true,false,false],
    ['date=1730-04-02',true,true,false],
    ['date=1740-01-01',true,true,true],
    ['context=modern',true,false,false],
    ['context=dunmar-frontier',false,false,false],
  ]) for (const dm of [false,true]) {
    const response=await app.fetch(new Request('https://example.test/api/page?page=Linked&'+query+'&dm='+Number(dm)),environment);
    assert.equal(response.status,200);
    const result=await response.json(), $=load(result.html,{},false);
    const parameters=new URLSearchParams(query);
    assert.equal(result.html,engine.render('Linked',parameters.get('date') || undefined,parameters.get('context') || undefined,dm).html);
    const labels=new Set($('a').map((_,el)=>$(el).text()).get());
    assert.equal(labels.has('hidden label'),false);
    for (const [label,visible] of [['campaign label',campaignVisible],['birth label',bornVisible],
      ['creation label',bornVisible],['active label',activeVisible]]) {
      assert.match($.text(),new RegExp(label));
      assert.equal(labels.has(label),visible,label+' in '+query);
    }
    const header=$('.grid.cards');
    assert.match(header.text(),/CampaignHidden/);
    assert.equal(header.find('a[href^="/page/campaignhidden?"]').length,campaignVisible ? 1 : 0);
    assert.equal($('.dm-note-popup').length,dm ? 1 : 0);
    assert.equal(labels.has('popup campaign'),dm && campaignVisible);
    assert.equal(labels.has('popup birth'),dm && bornVisible);
    if (dm) assert.match($('.dm-note-popup').text(),/popup campaign.*popup birth/);
    assert.deepEqual(result.warnings,[]);
  }
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  const shard=index.entries.find(entry=>entry.id==='Linked.md').note.shard;
  assert.deepEqual([...isolated.calls.keys()].filter(key=>key.includes('/notes/')),
    ['revisions/'+report.revision+'/notes/'+shard+'.json']);
});

test('Worker serves HTML/navigation, assets with ranges/ETags, HEAD, and normal errors',async()=>{
  assert.equal(await(await request('/theme/preview.css')).text(),'/preview.css');
  assert.equal(await(await request('/theme/material.css')).text(),'/vendor/material.css');
  const html=await(await request('/page/people/example?date=1720-01-01&dm=1')).text();
  assert.match(html,/Site navigation|Breadcrumb/);assert.match(html,/See Behind the Curtain/);
  const asset=await request('/assets/tiny.png',{headers:{Range:'bytes=0-6'}});
  assert.equal(asset.status,206);assert.equal(await asset.text(),'fixture');
  assert.equal(asset.headers.get('content-range'),'bytes 0-6/13');
  const cached=await request('/assets/tiny.png',{headers:{'If-None-Match':asset.headers.get('etag')}});
  assert.equal(cached.status,304);
  assert.equal((await request('/assets/tiny.png',{headers:{Range:'bytes=99-100'}})).status,416);
  assert.equal(await(await request('/api/page?page=Example&date=1720-01-01',{method:'HEAD'})).text(),'');
  for (const [url,status] of [['/api/page?page=Hidden',404],['/api/page?page=Broken',422],['/api/page?page=Example&date=bad',400],['/assets/missing.png',404],['/api/navigation?branch=missing',404]]) {
    assert.equal((await request(url)).status,status,url);
  }
  assert.equal((await request('/health',{method:'POST'})).status,405);
  assert.equal((await(await request('/health')).json()).runtime,'cloudflare-worker');
});

test('published snapshots retain audio and exported drawings and Worker serves media byte ranges',async()=>{
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  const response=await request('/api/page?page=Media&date=1720-01-01');
  assert.equal(response.status,200);
  const result=await response.json(), $=load(result.html,{},false);
  assert.equal(result.html,engine.render('Media','1720-01-01').html);
  assert.deepEqual(result.warnings,[]);
  assert.equal($('audio[controls]').length,2);
  for (const [relative,mime] of [['assets/audio/song.mp3','audio/mpeg'],['assets/session-audio/session/clip.m4a','audio/mp4'],['assets/excalidraw/drawing.png','image/png']]) {
    const entry=index.entries.find(entry=>entry.id===relative);
    assert.ok(entry?.objectKey,relative + ' packaged for upload');
    assert.ok(bucket.objects.has(entry.objectKey));
    const url='/assets/'+entry.target;
    const full=await request(url), bytes=await full.text();
    assert.equal(full.status,200);assert.equal(full.headers.get('content-type'),mime);
    assert.equal(bytes,'media fixture: '+relative);
    const partial=await request(url,{headers:{Range:'bytes=6-12'}});
    assert.equal(partial.status,206);assert.equal(await partial.text(),bytes.slice(6,13));
    assert.equal(partial.headers.get('content-range'),'bytes 6-12/'+bytes.length);
    const suffix=await request(url,{headers:{Range:'bytes=-5'}});
    assert.equal(suffix.status,206);assert.equal(await suffix.text(),bytes.slice(-5));
    const head=await request(url,{method:'HEAD'});
    assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal(await head.text(),'');
  }
  const html=await(await request('/page/media')).text();
  assert.match(html,/<script src="\/theme\/image-viewer.js" defer>/);
  assert.equal(await(await request('/theme/image-viewer.js')).text(),'/image-viewer.js');
});

test('snapshot load failures recover and publication can change without redeploying Worker',async()=>{
  await assert.rejects(loadSnapshot(bucket,'bad',instantiate),{status:503});
  const failing=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),
    {key:'published/current.json',file:report.pointerFile}]), key='revisions/'+report.revision+'/index.json';
  failing.missing.add(key);
  const retry=createWorker(instantiate), retryEnv={...env,CONTENT:failing};
  assert.equal((await retry.fetch(new Request('https://example.test/health'),retryEnv)).status,503);
  failing.missing.delete(key);
  assert.equal((await retry.fetch(new Request('https://example.test/health'),retryEnv)).status,200);
  failing.missing.add('published/current.json');
  assert.equal((await(await retry.fetch(new Request('https://example.test/health'),retryEnv)).json()).status,'awaiting-content');
  assert.equal((await retry.fetch(new Request('https://example.test/'),retryEnv)).status,503);
  failing.missing.delete('published/current.json');
  const alternate=path.join(directory,'alternate.json');
  fs.writeFileSync(alternate,JSON.stringify({revision:'a'.repeat(64)}));
  failing.objects.set('published/current.json',alternate);
  assert.equal((await retry.fetch(new Request('https://example.test/health'),retryEnv)).status,503);
  failing.objects.set('published/current.json',report.pointerFile);
  assert.equal((await retry.fetch(new Request('https://example.test/health'),retryEnv)).status,200);
});
