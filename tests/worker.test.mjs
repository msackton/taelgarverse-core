import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {load} from 'cheerio';
import sharp from 'sharp';
import {ROOT,loadSettings,isInside} from '../src/config.mjs';
import {Engine} from '../src/engine.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {loadSnapshot} from '../src/snapshot.mjs';
import {instantiate} from '../src/worker-headers.mjs';
import {handleRequest} from '../src/application.mjs';

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
  Object.assign(notes,JSON.parse(fs.readFileSync(new URL('./fixtures/maps.json',import.meta.url),'utf8')));
  Object.assign(notes,JSON.parse(fs.readFileSync(new URL('./fixtures/backlinks.json',import.meta.url),'utf8')));
  Object.assign(notes,JSON.parse(fs.readFileSync(new URL('./fixtures/embeds.json',import.meta.url),'utf8')));
  for (const [relative,text] of Object.entries(notes)) {
    const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);
  }
  fs.writeFileSync(path.join(source,'tiny.png'),'fixture asset');
  fs.writeFileSync(path.join(source,'Tiled Map.md'),'```leaflet\nimage: [[world.png]]\nbounds: [[0,0],[64,4100]]\n```');
  await sharp({create:{width:4100,height:64,channels:3,background:'red'}}).png().toFile(path.join(source,'world.png'));
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
  fs.mkdirSync(path.join(source,'_website'));
  const navSource=path.join(source,'_website','navigation.md'), homeSource=path.join(source,'_website','home.md');
  fs.writeFileSync(navSource,'- [Home](index.md)\n- People\n    - {glob: people/}\n- Places\n    - {glob: places/}\n');
  fs.copyFileSync(new URL('./fixtures/home.md',import.meta.url),homeSource);
  fs.writeFileSync(path.join(source,'_website','private.md'),'Unpublished website planning.');
  const settings={...loadSettings(),source_dir:source,ignore_file:path.join(source,'_ignore.txt'),nav_source:navSource,home_source:homeSource,campaigns:['dufr','adma']};
  report=await prepareContent(settings,path.join(directory,'package'));
  bucket=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),
    {key:'published/current.json',file:report.pointerFile}]);
  env={CONTENT:bucket,ASSETS:{fetch:async request=>new Response(new URL(request.url).pathname)}};
  engine=new Engine(settings);worker=createWorker(instantiate);
});
after(()=>{if(directory && isInside(path.join(ROOT,'.cache'),directory))fs.rmSync(directory,{recursive:true});});

test('published campaign homes select per-host content and lock Worker APIs without shared state',async()=>{
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  index.campaignHomes={dunmar:'---\ncontext: dunmar-frontier\n---\n# Dunmar home\n\nHello Dunmar.\n\n![[Nested Embed]]',addermarch:'---\ncontext: addermarch\n---\n# Addermarch home\n\nHello Addermarch.'};
  const indexFile=path.join(directory,'campaign-index.json');fs.writeFileSync(indexFile,JSON.stringify(index));
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  const storage=new LocalBucket([...uploads,{key:'revisions/'+report.revision+'/index.json',file:indexFile},{key:'published/current.json',file:report.pointerFile}]);
  const app=createWorker(instantiate), environment={...env,CONTENT:storage};
  for(const [host,id,title] of [['dunmar','dunmar-frontier','Dunmar home'],['addermarch','addermarch','Addermarch home'],['www','modern','Welcome to the fixture site'],['dunmar','dunmar-frontier','Dunmar home']]) {
    const home=await app.fetch(new Request('https://'+host+'.taelgar.org/'),environment);
    assert.equal(home.status,200);const $=load(await home.text());assert.equal($('main h1').first().text(),title);
    const response=await app.fetch(new Request('https://'+host+'.taelgar.org/api/page?page=Example'+(host==='www'?'':'&context=modern&date=9999-01-01&campaigns=all')),environment);
    assert.equal(response.status,200);const page=await response.json();assert.equal(page.context.id,id);
    assert.equal(page.context.locked,host==='www'?undefined:true);
    if(host!=='www')assert.deepEqual(page.campaigns,[host==='dunmar'?'dufr':'adma']);
  }
  assert.equal(storage.calls.get('revisions/'+report.revision+'/index.json'),1);
  index.campaignHomes={dunmar:'---\ncontext: unknown\n---\n# Invalid'};fs.writeFileSync(indexFile,JSON.stringify(index));
  await assert.rejects(loadSnapshot(storage,report.revision,instantiate),error=>error.status===503);
});

test('Worker renders context-filtered maps and serves packaged tile assets without fetching the original image',async()=>{
  for (const [context,dm,count] of [['modern','0',1],['dunmar-frontier','0',2],['modern','1',2]]) {
    const $ = load(await (await request('/page/maps?context='+context+'&dm='+dm)).text());
    assert.equal($('.leaflet-map').length,count);
    assert.equal($('script[src="/theme/maps.js"]').length,1);
    assert.equal($('link[href="/theme/leaflet.css"]').length,1);
  }
  const page = await (await request('/api/page?page=Tiled%20Map')).json();
  const config = JSON.parse(load(page.html)('.leaflet-map').attr('data-map'));
  assert.ok(config.tile);
  const index = JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  const image = index.entries.find(entry=>entry.id==='world.png');
  const previousImageReads = bucket.calls.get(image.objectKey) || 0;
  const tile = await request(config.tile.baseUrl+'/0/8/0.webp');
  assert.equal(tile.status,200);assert.match(tile.headers.get('content-type'),/image\/webp/);
  assert.equal((await sharp(Buffer.from(await tile.arrayBuffer())).metadata()).width,512);
  assert.equal(bucket.calls.get(image.objectKey) || 0,previousImageReads);
  assert.equal((await request(config.tile.baseUrl+'/0/8/0.webp',{method:'HEAD'})).status,200);
  assert.equal((await request(config.tile.baseUrl+'/0/999/999.webp')).status,404);
  assert.equal(await (await request('/theme/maps.js')).text(),'/generated/maps.js');
  assert.equal(await (await request('/theme/leaflet.css')).text(),'/generated/leaflet.css');
});

test('footer follows each publication pointer and rollback without cached metadata leaking',async()=>{
  const pointer=path.join(directory,'release-pointer.json');
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  const storage=new LocalBucket([...uploads,{key:'published/current.json',file:pointer}]);
  const app=createWorker(instantiate,{commit:'a'.repeat(40),publishedAt:'2026-10-18T12:00:00Z'});
  const environment={...env,CONTENT:storage};
  for (const [commit,completedAt] of [['b','2026-10-19T01:00:00Z'],['c','2026-10-20T01:00:00Z'],['b','2026-10-19T01:00:00Z']]) {
    fs.writeFileSync(pointer,JSON.stringify({revision:report.revision,commit:commit.repeat(40),dirty:false,completedAt}));
    const home=load(await (await app.fetch(new Request('https://example.test/'),environment)).text());
    const browse=home('.site-sidebar a[href^="/browse/"]').first().attr('href');
    for (const url of ['/','/?q=Example','/page/people/example',browse,'/page/does-not-exist']) {
      const response=await app.fetch(new Request('https://example.test'+url),environment);
      const $=load(await response.text());
      assert.equal($('.site-footer [data-copy-commit]').last().attr('data-copy-commit'),commit.repeat(40),url);
      assert.equal($('.site-footer time').attr('datetime'),new Date(completedAt).toISOString(),url);
      assert.doesNotMatch($('.site-footer').text(),/Oct 18/);
    }
  }
  assert.equal(storage.calls.get('revisions/'+report.revision+'/index.json'),1);
});

test('manual activation reads its content commit from the immutable snapshot',async()=>{
  const sourceVersion={commit:'d'.repeat(40),dirty:true};
  const prepared=await prepareContent(engine.settings,path.join(directory,'release-package'),sourceVersion);
  assert.deepEqual(JSON.parse(fs.readFileSync(prepared.indexFile,'utf8')).sourceVersion,sourceVersion);
  fs.writeFileSync(prepared.pointerFile,JSON.stringify({revision:prepared.revision,completedAt:'2026-10-19T16:00:00Z'}));
  const storage=new LocalBucket([...JSON.parse(fs.readFileSync(prepared.manifestFile,'utf8')),
    {key:'published/current.json',file:prepared.pointerFile}]);
  const response=await createWorker(instantiate).fetch(new Request('https://example.test/'),{...env,CONTENT:storage});
  const $=load(await response.text());
  assert.equal($('.site-footer [data-copy-commit]').attr('data-copy-commit'),sourceVersion.commit);
  assert.match($('.site-footer').text(),/Updated Oct 19, 2026.*Content ddddddd\*/);
});

test('Worker expands published note embeds like Node and loads only visible note shards',async()=>{
  for (const query of ['context=modern','context=custom&date=1720-01-01&campaigns=dufr',
    'context=custom&date=1730-01-01&campaigns=all&dm=1']) {
    const storage=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),{key:'published/current.json',file:report.pointerFile}]);
    const app=createWorker(instantiate), environment={...env,CONTENT:storage};
    const url='https://example.test/api/page?page=Embed%20Host&'+query;
    const response=await app.fetch(new Request(url),environment);
    assert.equal(response.status,200);
    const result=await response.json(), params=new URL(url).searchParams;
    assert.deepEqual(result,engine.render('Embed Host',params.get('date') ?? undefined,params.get('context'),params.get('dm') ?? false,undefined,params.get('campaigns') ?? undefined));
    const $=load(result.html,{},false);
    assert.equal($('.note-embed').length,query.includes('campaigns=') ? 5 : 4);
    assert.doesNotMatch(result.html,/Stale embedded header|Outside requested section|Private page|Future page/);
    assert.match($.text(),/Shared voyage/); assert.match($.text(),/Nested voyage/);
    assert.equal($.text().includes('Frontier voyage'),query.includes('campaigns='));
    assert.equal($.text().includes('Later voyage'),query.includes('1730'));
    assert.equal($.text().includes('Voyage popup'),query.includes('dm=1'));
    const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
    const expected=['Embed Host.md','Embed Sources/Child.md','Nested Embed.md',...(query.includes('campaigns=') ? ['Embed Sources/Campaign.md'] : [])];
    const keys=new Set(expected.map(id=>'revisions/'+report.revision+'/notes/'+index.entries.find(e=>e.id===id).note.shard+'.json'));
    assert.deepEqual(new Set([...storage.calls.keys()].filter(key=>key.includes('/notes/'))),keys);
    for (const key of keys) assert.equal(storage.calls.get(key),1,key);
    assert.doesNotMatch(result.toc,/Travels/);
  }
});

test('published homepage note embeds retain lazy loading',async()=>{
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  index.homeSource+='\n\n![[Nested Embed]]\n';
  const file=path.join(directory,'embed-home-index.json'); fs.writeFileSync(file,JSON.stringify(index));
  const storage=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),{key:'published/current.json',file:report.pointerFile}]);
  storage.objects.set('revisions/'+report.revision+'/index.json',file);
  const app=createWorker(instantiate);
  const response=await app.fetch(new Request('https://example.test/?date=1730-01-01&campaigns=all&dm=1'),{...env,CONTENT:storage});
  assert.equal(response.status,200);
  const $=load(await response.text());
  assert.match($('.note-embed').text(),/Nested voyage/);
});

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
  assert.doesNotMatch(JSON.stringify(index),/source_dir|runtime_dir|vault_dir|Fixture biography|private ordinary comment/);
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

test('published website Markdown renders like Node without exposing website files as articles',async()=>{
  const storage=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),{key:'published/current.json',file:report.pointerFile}]);
  const app=createWorker(instantiate), environment={...env,CONTENT:storage};
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  assert.equal(index.homeSource,fs.readFileSync(engine.settings.home_source,'utf8'));
  assert.equal(index.navigationSource,fs.readFileSync(engine.settings.nav_source,'utf8'));
  assert.equal(index.entries.some(entry=>entry.id.startsWith('_website/')),false);
  assert.doesNotMatch(JSON.stringify(index),/Unpublished website planning/);
  await Promise.all(['context=modern','context=addermarch','context=dunmar-frontier&dm=1','context=custom&date=1750-01-01&campaigns=all'].map(async query=>{
    const url='https://example.test/?'+query;
    const response=await app.fetch(new Request(url),environment);
    assert.equal(response.status,200);
    const html=await response.text();
    // Node preview and the published Worker have independent release metadata.
    const nodeHtml=await (await handleRequest(new Request(url),engine,{releases:{content:index.sourceVersion}})).text();
    assert.equal(html,nodeHtml);
    const $=load(html);
    assert.equal($('main h1').text(),'Welcome to the fixture site');
    assert.equal($('.home-hero h1').length,1);
    assert.equal($('.home-entry').length,3);
    assert.equal($('main a[href="https://example.org/"]').length,1);
    assert.equal($('main').text().includes('Private homepage note'),query.includes('dm=1'));
    assert.equal($('main').text().includes('Addermarch homepage content'),query.includes('addermarch') || query.includes('campaigns=all'));
    assert.equal($('main a').filter((_,a)=>$(a).text()==='Conditional link').length,query.includes('dunmar-frontier') || query.includes('campaigns=all') ? 0 : 1);
  }));
  assert.equal([...storage.calls.keys()].some(key=>key.includes('/notes/')),false);
  assert.equal((await request('/page/_website/home')).status,404);
  assert.equal(await(await request('/theme/homepage.css')).text(),'/homepage.css');
  assert.equal(await(await request('/theme/home-map.webp')).text(),'/images/home-map.webp');
});

test('old publications retain the page finder; invalid homepage data is rejected',async()=>{
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  const file=path.join(directory,'legacy-home-index.json');
  const storage=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),{key:'published/current.json',file:report.pointerFile}]);
  storage.objects.set('revisions/'+report.revision+'/index.json',file);
  delete index.homeSource;
  fs.writeFileSync(file,JSON.stringify(index));
  const response=await createWorker(instantiate).fetch(new Request('https://example.test/'),{...env,CONTENT:storage});
  assert.equal(response.status,200);
  assert.equal(load(await response.text())('main h1').text(),'Browse pages');
  index.homeSource={invalid:true};
  fs.writeFileSync(file,JSON.stringify(index));
  await assert.rejects(()=>loadSnapshot(storage,report.revision,instantiate),{status:503});
});

test('republishing changes the homepage and navigation together without redeploying code',async()=>{
  const homeFile=engine.settings.home_source, navFile=engine.settings.nav_source;
  const originalHome=fs.readFileSync(homeFile,'utf8'), originalNav=fs.readFileSync(navFile,'utf8');
  try {
    fs.writeFileSync(homeFile,'# Updated home\n\nNew homepage text.\n');
    fs.writeFileSync(navFile,'- [Home](index.md)\n- [Updated menu](people/example.md)\n');
    const next=await prepareContent(engine.settings,path.join(directory,'updated-website'));
    assert.notEqual(next.revision,report.revision);
    const storage=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),
      ...JSON.parse(fs.readFileSync(next.manifestFile,'utf8')),{key:'published/current.json',file:report.pointerFile}]);
    const app=createWorker(instantiate), environment={...env,CONTENT:storage};
    const read=async()=>load(await (await app.fetch(new Request('https://example.test/'),environment)).text());
    assert.equal((await read())('main h1').text(),'Welcome to the fixture site');
    storage.objects.set('published/current.json',next.pointerFile);
    const updated=await read();
    assert.equal(updated('main h1').text(),'Updated home');
    assert.match(updated('.site-sidebar').text(),/Updated menu/);
    assert.doesNotMatch(updated('main').text(),/Website introduction/);
  } finally {fs.writeFileSync(homeFile,originalHome);fs.writeFileSync(navFile,originalNav);}
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

test('Worker keeps unlisted articles searchable and renders context-filtered Mermaid with local assets',async()=>{
  const html = await (await request('/page/diagrams?context=modern')).text(), $ = load(html);
  assert.equal($('.mermaid-diagram').length,1);
  assert.equal($('script[type="module"][src="/theme/diagrams.js"]').length,1);
  assert.equal($('.site-sidebar a[href*="/page/diagrams?"]').length,0);
  assert.equal($('.breadcrumbs').length,0);
  assert.doesNotMatch($('.site-sidebar').text(),/More pages/);
  const finder = load(await (await request('/?q=Diagrams&context=modern')).text());
  assert.equal(finder('main a[href="/page/diagrams?context=modern"]').length,1);
  const campaign = await (await request('/api/page?page=Diagrams&context=dunmar-frontier')).json();
  assert.equal(load(campaign.html)('.mermaid-diagram').length,2);
  assert.equal(await (await request('/theme/diagrams.js')).text(),'/generated/diagrams.js');
});

test('snapshots preserve the explicit no-template directory navigation mode',async()=>{
  const packaged=await prepareContent({...engine.settings,nav_source:null},path.join(directory,'directory-nav-package'));
  const index=JSON.parse(fs.readFileSync(packaged.indexFile,'utf8'));
  assert.equal(index.navigationSource,null);
  const storage=new LocalBucket(JSON.parse(fs.readFileSync(packaged.manifestFile,'utf8')));
  const loaded=await loadSnapshot(storage,packaged.revision,instantiate);
  assert.equal(engine.navigation.paths.has('diagrams'),false);
  assert.equal(loaded.engine.navigation.paths.has('diagrams'),true);
  assert.equal(loaded.engine.navigation.roots.some(node=>node.label==='More pages'),false);
});

test('Worker reads backlinks from the publication index without fetching referring article bodies',async()=>{
  const storage=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),
    {key:'published/current.json',file:report.pointerFile}]);
  const app=createWorker(instantiate), environment={...env,CONTENT:storage};
  const fetch=url=>app.fetch(new Request('https://example.test'+url),environment);
  for (const query of ['date=1729-12-31','date=1730-01-01&dm=1','context=dunmar-frontier','context=addermarch&dm=1','date=1729-12-31',
    'context=custom&date=1730-01-01&campaigns=all&dm=1','date=1730-01-01&campaigns=adma,dufr','date=1730-01-01&campaigns=adma']) {
    const response=await fetch('/api/page?page=Backlink%20Target&'+query);
    assert.equal(response.status,200);
    const result=await response.json(), params=new URLSearchParams(query);
    const expected=engine.render('Backlink Target',params.get('date') || undefined,params.get('context') || undefined,params.get('dm'),undefined,
      params.has('campaigns') ? params.getAll('campaigns') : undefined);
    assert.deepEqual(result.backlinks,expected.backlinks,query);
    assert.ok(result.backlinks.some(link=>link.page==='backlink-source'));
    assert.equal(result.backlinks.some(link=>link.page==='broken-reference'),false);
    for (const [campaign,pages] of [
      ['addermarch',['addermarch-backlink-session','campaigns/addermarch-campaign/handouts/backlink-letter']],
      ['dunmar-frontier',['dunmar-backlink-session','campaigns/dunmari-frontier-campaign/letters/backlink-letter']],
    ]) for (const page of pages) assert.equal(result.backlinks.some(link=>link.page===page),result.campaigns.includes(campaign==='addermarch' ? 'adma' : 'dufr'),page+' in '+query);
    const html=load(await(await fetch('/page/backlink-target?'+query)).text());
    assert.equal(html('.page-backlinks a').length,result.backlinks.length);
    assert.equal(html('.article-main .page-backlinks').length,0);
    assert.equal(html('.page-toc > details').length,1); // Title-only article.
  }
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  assert.equal(index.backlinks.version,2);
  assert.doesNotMatch(JSON.stringify(index.backlinks),/Paragraph|Article without|private ordinary/);
  const shard=index.entries.find(entry=>entry.id==='Backlink Target.md').note.shard;
  assert.deepEqual([...storage.calls.keys()].filter(key=>key.includes('/notes/')),
    ['revisions/'+report.revision+'/notes/'+shard+'.json']);
  assert.equal((await fetch('/api/page?page=Addermarch%20Backlink%20Session&context=modern')).status,200);
});

test('older publications still render without a backlink index; unsupported index versions fail explicitly',async()=>{
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  const storage=new LocalBucket(JSON.parse(fs.readFileSync(report.manifestFile,'utf8')));
  const file=path.join(directory,'old-index.json');
  delete index.backlinks;
  fs.writeFileSync(file,JSON.stringify(index));
  storage.objects.set('revisions/'+report.revision+'/index.json',file);
  const loaded=await loadSnapshot(storage,report.revision,instantiate);
  const entry=loaded.store.resolve('Backlink Target'), note=await loaded.store.getNote(entry);
  const result=loaded.engine.render('Backlink Target',undefined,undefined,false,note);
  assert.match(result.html,/Backlink Target/);
  assert.equal(result.backlinks,undefined);
  index.backlinks={version:1,byTarget:{'backlink-target':[{source:'backlink-source',when:[{}]}]},warnings:[]};
  fs.writeFileSync(file,JSON.stringify(index));
  const legacy=await loadSnapshot(storage,report.revision,instantiate);
  assert.equal(legacy.engine.render('Backlink Target',undefined,undefined,false,note).backlinks.length,1);
  assert.equal(legacy.engine.render('Backlink Target',undefined,'custom',false,note,'all').backlinks,undefined);
  index.backlinks={version:999,byTarget:{}};
  fs.writeFileSync(file,JSON.stringify(index));
  await assert.rejects(()=>loadSnapshot(storage,report.revision,instantiate),{status:503});
});

test('Worker isolates Custom all/subset selections and rejects invalid selections before reading bodies',async()=>{
  const storage=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),{key:'published/current.json',file:report.pointerFile}]);
  const app=createWorker(instantiate), environment={...env,CONTENT:storage};
  const fetch=url=>app.fetch(new Request('https://example.test'+url),environment);
  for (const query of ['context=custom&campaigns=missing','context=modern&campaigns=all']) {
    assert.equal((await fetch('/api/page?page=Example&'+query)).status,400);
  }
  assert.equal([...storage.calls.keys()].some(key=>key.includes('/notes/')),false);
  await Promise.all(['all','adma,dufr','adma',''].map(async campaigns=>{
    const query=new URLSearchParams({page:'Backlink Empty',context:'custom',date:'1730-01-01',campaigns,dm:'1'});
    const response=await fetch('/api/page?'+query);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.deepEqual(result,engine.render('Backlink Empty','1730-01-01','custom',true,undefined,campaigns));
    assert.equal(result.backlinks.some(link=>link.page==='cross-campaign-reference'),campaigns==='adma');
  }));
});

test('republishing replaces removed backlinks and invalidates the active Worker index',async()=>{
  const file=path.join(engine.settings.source_dir,'Backlink Source.md'), original=fs.readFileSync(file,'utf8');
  try {
    fs.writeFileSync(file,'# Source\n\nThe reference was removed.\n');
    const packaged=await prepareContent(engine.settings,path.join(directory,'changed-links-package'));
    assert.notEqual(packaged.revision,report.revision);
    const storage=new LocalBucket([...JSON.parse(fs.readFileSync(report.manifestFile,'utf8')),
      ...JSON.parse(fs.readFileSync(packaged.manifestFile,'utf8')),{key:'published/current.json',file:report.pointerFile}]);
    const app=createWorker(instantiate), environment={...env,CONTENT:storage};
    const read=async()=>await(await app.fetch(new Request('https://example.test/api/page?page=Backlink%20Target'),environment)).json();
    assert.equal((await read()).backlinks.some(link=>link.page==='backlink-source'),true);
    storage.objects.set('published/current.json',packaged.pointerFile);
    assert.equal((await read()).backlinks.some(link=>link.page==='backlink-source'),false);
  } finally { fs.writeFileSync(file,original); }
});
