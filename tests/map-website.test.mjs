import {testSettings} from './helpers/test-settings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {load} from 'cheerio';
import {ROOT,isInside} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {parseMap,mapImages,renderMap} from '../src/maps.mjs';
import {resolveMapSource} from '../src/map-core.mjs';
import {baselineViewConfig} from '../src/map-block.mjs';
import {hexRangeBounds} from '../src/map-locators.mjs';
import {prepareMaps} from '../scripts/build-maps.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {Engine} from '../src/engine.mjs';
import {createServer} from '../src/server.mjs';
import {copyWorkingVault} from '../scripts/website-working-vault.mjs';
import {buildFingerprint} from '../scripts/publish-content.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fence=block=>'```taelgar-map\n'+JSON.stringify(block,null,2)+'\n```';
const configs=html=>{const $=load(html);return $('.leaflet-map').toArray().map(el=>JSON.parse($(el).attr('data-map')));};
async function fixture(t,{width=2308,height=96,sourceOffset=[0,0]}={}){
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','map-website-'));
  t.after(async()=>{const root=await fs.realpath(directory);assert.ok(isInside(ROOT,root));assert.match(path.basename(root),/^map-website-/);await fs.rm(root,{recursive:true,force:true});});
  for(const folder of ['assets/maps','Other','_scripts','.obsidian','_website'])await fs.mkdir(path.join(directory,folder),{recursive:true});
  const image=await sharp({create:{width,height,channels:3,background:'#e0efdd'}}).png().toBuffer();
  const imageFile=path.join(directory,'assets/maps/core.png'),manifestFile=path.join(directory,'assets/maps/core.map.json');
  const manifest={version:2,image:'core.png',sourceOffset};
  const block={version:2,source:'[[assets/maps/core.map.json]]',
    crop:{x:20,y:10,width:120,height:70},grid:{visible:true,showCoordinates:true},
    overlays:[{id:'fog',side:'inside',style:'dim',opacity:.5,geometry:{type:'Polygon',coordinates:[[[30,20],[50,20],[50,40],[30,20]]]}}]};
  block.crop.x+=sourceOffset[0];block.crop.y+=sourceOffset[1];
  for(const mask of block.overlays)mask.geometry.coordinates=mask.geometry.coordinates.map(r=>r.map(p=>p.map((v,i)=>v+sourceOffset[i])));
  await fs.writeFile(imageFile,image);await fs.writeFile(manifestFile,JSON.stringify(manifest));
  await fs.writeFile(path.join(directory,'Map.md'),fence(block)+'\n\n'+fence({...block,id:'second',crop:{x:sourceOffset[0]+150,y:sourceOffset[1]+10,width:50,height:70}}));
  await fs.writeFile(path.join(directory,'assets/maps/recipe.json'),'{}');
  const {input}=headerFixture();
  await fs.writeFile(path.join(directory,'.obsidian/metadata.json'),JSON.stringify(input.coreMeta));
  await fs.writeFile(path.join(directory,'_scripts/session_note_campaigns.json'),JSON.stringify(input.registry));
  const settings={...testSettings(),vault_dir:directory,source_dir:directory,home_source:null,nav_source:null};
  return {directory,image,imageFile,manifestFile,manifest,block,settings,store:()=>new Store(settings)};
}

test('website preparation accepts hex crops on offset exports and drops retired masks',async t=>{
  const f=await fixture(t,{width:640,height:520,sourceOffset:[5600,7180]});
  const crop={topLeft:'16.10',bottomRight:'16.10.I.24'},block={...f.block,crop};
  await fs.writeFile(path.join(f.directory,'Map.md'),fence(block));
  const store=f.store();await prepareMaps(store,path.join(f.directory,'tiles'));
  const config=parseMap(JSON.stringify(block),store,store.lookup('Map').entry).config;
  const bounds=hexRangeBounds(crop.topLeft,crop.bottomRight);
  assert.ok(Math.abs(config.crop.x-(bounds.x-5600))<1e-8);
  assert.ok(Math.abs(config.crop.y-(bounds.y-7180))<1e-8);
  assert.ok(config.crop.width<=640 && config.crop.height<=520);
  assert.equal(config.overlays,undefined);
  assert.deepEqual(JSON.parse((await fs.readFile(path.join(f.directory,'Map.md'),'utf8')).split('\n').slice(1,-1).join('\n')).crop,crop);
});

test('website manifests use exact image paths, preserve geometry, and share one tile pyramid across crops',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.directory,'Other/core.png'),f.image);
  const store=f.store(),author=store.lookup('Map').entry;
  assert.equal(store.lookup('recipe.json').entry,undefined,'ordinary JSON is not made public');
  assert.throws(()=>parseMap(JSON.stringify(f.block),store,author),/not been prepared/);
  assert.equal(mapImages(store).length,2);
  const entry=store.lookup('assets/maps/core.png').entry;
  assert.equal(entry.mapImage,true);
  const files=await prepareMaps(store,path.join(f.directory,'tiles'));
  assert.ok(files.length>0);assert.equal(entry.mapTiles.length,1);
  const parsed=parseMap(JSON.stringify(f.block),store,author);
  assert.deepEqual(parsed.config,baselineViewConfig(f.block,resolveMapSource(f.manifest,entry.mapImageInfo),'/assets/assets/maps/core.png'));
  const html=renderMap(JSON.stringify(f.block),{store,entry:author,warnings:[]});
  assert.equal(configs(html)[0].tile.baseUrl,entry.mapTiles[0].baseUrl);
  assert.match(html,/Open full source image/);
  assert.deepEqual(await fs.readFile(f.imageFile),f.image);
  const modified=(await fs.stat(files[0].filename)).mtimeMs;
  assert.deepEqual(await prepareMaps(store,path.join(f.directory,'tiles')),[]);
  assert.equal((await fs.stat(files[0].filename)).mtimeMs,modified);
  // A missing qualified path must never fall back to another file's basename.
  assert.throws(()=>parseMap(JSON.stringify({...f.block,source:'[[Missing/core.map.json]]'}),store,author),/missing or ambiguous/);
  await fs.rm(f.imageFile);const missing=f.store();
  assert.throws(()=>mapImages(missing,{strict:true}),/Core image is missing/);
});

test('baseline preparation rejects invalid offsets, obsolete formats, corrupt PNGs and incompatible geometry',async t=>{
  const f=await fixture(t,{width:300});
  for(const [name,manifest,block,image,pattern] of [
    ['offset',{...f.manifest,sourceOffset:[-1,0]},f.block,f.image,/sourceOffset/],
    ['version',{...f.manifest,version:1},f.block,f.image,/version 2/],
    ['frame',f.manifest,{...f.block,coordinateFrame:'wrong-frame'},f.image,/Old coordinateFrame/],
    ['crop',f.manifest,{...f.block,crop:{x:350,y:0,width:100,height:10}},f.image,/does not intersect/],
    ['path',{...f.manifest,image:'../core.png'},f.block,f.image,/relative PNG path/],
    ['source',f.manifest,{...f.block,source:'https://example.com/core.map.json'},f.image,/local vault path/],
  ]){
    await fs.writeFile(f.manifestFile,JSON.stringify(manifest));await fs.writeFile(f.imageFile,image);
    await fs.writeFile(path.join(f.directory,'Map.md'),fence(block));
    await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')),pattern,name);
  }
  const truncated=f.image.subarray(0,50);
  await fs.writeFile(f.imageFile,truncated);
  await fs.writeFile(f.manifestFile,JSON.stringify(f.manifest));
  await fs.writeFile(path.join(f.directory,'Map.md'),fence(f.block));
  await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')),'truncated PNG must be decoded, not trusted by header');
});

test('manifest lookup honors relative paths, ambiguity and excluded directories',async t=>{
  const f=await fixture(t,{width:300});
  await fs.writeFile(path.join(f.directory,'Other/core.map.json'),JSON.stringify(f.manifest));
  await fs.writeFile(path.join(f.directory,'Other/core.png'),f.image);
  await fs.writeFile(path.join(f.directory,'Other/Map.md'),fence({...f.block,source:'[[core.map.json]]'}));
  let store=f.store();
  const relative=store.lookup('Other/Map.md').entry;
  assert.equal(parseMap(JSON.stringify({...f.block,source:'[[core.map.json]]'}),store,relative,{verifyImage:false}).entry.id,'Other/core.png');
  assert.throws(()=>parseMap(JSON.stringify({...f.block,source:'[[core.map.json]]'}),store,store.entries.find(entry=>entry.id==='Map.md'),{verifyImage:false}),/missing or ambiguous/);
  await fs.writeFile(path.join(f.directory,'assets/maps/.nopublish'),'');store=f.store();
  assert.throws(()=>parseMap(JSON.stringify(f.block),store,store.entries.find(entry=>entry.id==='Map.md'),{verifyImage:false}),/missing or ambiguous/);
  assert.throws(()=>parseMap(JSON.stringify({...f.block,source:'../core.map.json'}),store,store.entries.find(entry=>entry.id==='Map.md'),{verifyImage:false}),/inside the vault/);
});

test('home and campaign-only maps participate in preparation',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.directory,'Map.md'),'# No map here');
  const store=f.store(),sources={homeSource:fence(f.block),campaignHomes:{frontier:fence({...f.block,id:'home'})}};
  assert.equal(mapImages(store).length,0);
  assert.equal(mapImages(store,sources).length,2);
  assert.ok((await prepareMaps(store,path.join(f.directory,'tiles'),undefined,sources)).length>0);
});

test('local preview isolates invalid maps and excludes unpublished note definitions',async t=>{
  const f=await fixture(t,{width:300});
  await fs.writeFile(f.imageFile,Buffer.from('not a PNG'));
  const store=f.store();
  assert.deepEqual(await prepareMaps(store,path.join(f.directory,'tiles'),undefined,{strict:false}),[]);
  const warnings=[],html=renderMap(JSON.stringify(f.block),{store,entry:store.lookup('Map').entry,warnings});
  assert.equal(configs(html).length,0);assert.match(html,/image format|PNG/);assert.equal(warnings.length,1);
  await fs.writeFile(path.join(f.directory,'Map.md'),'---\nexcludePublish: all\n---\n'+fence({...f.block,source:'[[missing.map.json]]'}));
  assert.deepEqual(await prepareMaps(f.store(),path.join(f.directory,'tiles')),[]);
});

test('publication rejects map assets changed after validation and before packaging',async t=>{
  const f=await fixture(t,{width:300});
  const layerFile=path.join(f.directory,'assets/maps/borders.map-layers.json');
  f.manifest.layers=['borders.map-layers.json'];await fs.writeFile(f.manifestFile,JSON.stringify(f.manifest));
  await fs.writeFile(layerFile,JSON.stringify({version:1,layers:[]}));
  for(const [name,file] of [['image',f.imageFile],['manifest',f.manifestFile],['layers',layerFile]]){
    const original=await fs.readFile(file);let changed=false;
    await assert.rejects(prepareContent(f.settings,path.join(f.directory,'.output-'+name),{commit:'a'.repeat(40),dirty:false},{},undefined,undefined,{
      log:message=>{if(message==='Packaging notes and assets…'){writeFileSync(file,Buffer.concat([original,Buffer.from('\n')]));changed=true;}},
    }),/Map asset changed after validation/);
    assert.equal(changed,true);await fs.writeFile(file,original);
  }
});

test('prepared maps survive Node, compiled Worker and legacy snapshot rendering with fetchable assets',async t=>{
  const f=await fixture(t,{sourceOffset:[2100,3100]});
  f.manifest.layers=['borders.map-layers.json'];
  const layers={version:1,layers:[{id:'regions',name:'Regions',regions:[{id:'one',name:'One',note:'One.md',points:[[2100,3100],[2400,3100],[2300,3190]]}]}]};
  await fs.writeFile(f.manifestFile,JSON.stringify(f.manifest));
  await fs.writeFile(path.join(f.directory,'assets/maps/borders.map-layers.json'),JSON.stringify(layers));
  await fs.writeFile(path.join(f.directory,'One.md'),'# One');
  const river={kind:'river',importance:'regional',points:[[2100,3140],[2200,3150],[2400,3140]]};
  const riverSource='_maps/paths/river.map-path.json';
  await fs.mkdir(path.join(f.directory,'_maps/paths'),{recursive:true});
  await fs.writeFile(path.join(f.directory,riverSource),JSON.stringify({version:1,points:river.points}));
  await fs.writeFile(path.join(f.directory,'River.md'),'---\nmapPath: '+JSON.stringify({kind:river.kind,importance:river.importance,source:riverSource})+'\n---\n# River');
  await fs.writeFile(path.join(f.directory,'Secret road.md'),'---\nexcludePublish: all\nmapPath: '+JSON.stringify({...river,kind:'road'})+'\n---\n# Secret');
  const detail={version:1,name:'Detailed area',image:'detail.png',worldBounds:{x:2120,y:3110,width:100,height:60},pixelSize:[800,480],fadeZoom:[0,2]};
  const detailPNG=await sharp({create:{width:800,height:480,channels:4,background:'#33669980'}}).png().toBuffer();
  await fs.writeFile(path.join(f.directory,'assets/maps/detail.png'),detailPNG);
  await fs.writeFile(path.join(f.directory,'assets/maps/detail.map-detail.json'),JSON.stringify(detail));
  f.block.details=['assets/maps/detail.map-detail.json'];
  await fs.writeFile(path.join(f.directory,'Map.md'),fence(f.block)+'\n\n'+fence({...f.block,id:'second',details:[],crop:{x:2250,y:3110,width:50,height:70}}));
  const report=await prepareContent(f.settings,path.join(f.directory,'output'),{commit:'a'.repeat(40),dirty:false});
  const uploads=JSON.parse(await fs.readFile(report.manifestFile,'utf8'));
  const objects=new Map(await Promise.all(uploads.map(async item=>[item.key,await fs.readFile(item.file)])));
  objects.set('published/current.json',await fs.readFile(report.pointerFile));
  const index=JSON.parse(objects.get('revisions/'+report.revision+'/index.json'));
  const imageEntry=index.entries.find(entry=>entry.id==='assets/maps/core.png');
  assert.deepEqual(imageEntry.mapImageInfo,{format:'png',width:2308,height:96});
  assert.equal(index.entries.some(entry=>entry.id===riverSource),false,'geometry is not a public asset');
  assert.equal(index.entries.find(entry=>entry.id==='River.md').note.metadata.mapPath.points,undefined);
  assert.deepEqual(index.entries.find(entry=>entry.id==='River.md').mapPathGeometry.points,river.points);
  assert.deepEqual(index.entries.find(entry=>entry.id.endsWith('.map.json')).mapManifest,f.manifest);
  class Bucket {
    constructor(legacy){this.objects=new Map([...objects].filter(([key])=>!legacy || !key.includes('/runtime/') && !key.endsWith('/runtime.json')));}
    async get(key,{range}={}){const bytes=this.objects.get(key);if(!bytes)return null;return {size:bytes.length,text:async()=>bytes.toString(),json:async()=>JSON.parse(bytes),body:new Blob([range?bytes.subarray(range.offset,range.offset+range.length):bytes]).stream()};}
  }
  let expected;
  for(const legacy of [false,true]){
    const worker=createWorker(),env={CONTENT:new Bucket(legacy),ASSETS:{fetch:async()=>new Response('theme')}};
    const request=url=>worker.fetch(new Request('https://taelgar.org'+url),env);
    const response=await request('/api/page?page=Map');assert.equal(response.status,200);
    const page=await response.json(),maps=configs(page.html);assert.equal(maps.length,2);assert.equal(maps[0].version,2);
    const translated=baselineViewConfig(f.block,resolveMapSource(f.manifest,{width:2308,height:96}),'');
    assert.deepEqual(maps[0].crop,translated.crop);assert.deepEqual(maps[0].overlays,translated.overlays);
    assert.deepEqual(maps[0].regionLayers[0].regions,layers.layers[0].regions);
    assert.equal(maps[0].regionLayers[0].toggleable,false);
    assert.deepEqual(maps[0].sourceOffset,[2100,3100]);
    assert.deepEqual(maps[0].detailLayers,[{...detail,image:'/assets/assets/maps/detail.png'}]);
    assert.equal(maps[1].detailLayers,undefined,'separate map blocks opt in independently');
    assert.deepEqual(Buffer.from(await (await request(maps[0].detailLayers[0].image)).arrayBuffer()),detailPNG);
    assert.deepEqual(await (await request('/assets/assets/maps/detail.map-detail.json')).json(),detail);
    assert.match(Object.values(maps[0].regionLinks)[0],/^\/page\/one/);
    assert.equal(maps[0].mapPaths.length,1);assert.deepEqual(maps[0].mapPaths[0].points,river.points);
    assert.equal(maps[0].mapPaths[0].importance,'regional');assert.match(maps[0].mapPaths[0].href,/^\/page\/river/);
    assert.equal(maps[1].mapPaths.length,1,'crossing paths appear in multiple crops without endpoint filtering');
    assert.equal((await request('/assets/'+riverSource)).status,404);
    const layerResponse=await request('/assets/assets/maps/borders.map-layers.json');assert.deepEqual(await layerResponse.json(),layers);
    assert.equal(maps[0].tile.baseUrl,maps[1].tile.baseUrl);assert.deepEqual(maps[0].measurement,{unit:'miles',hexMiles:24,xScale:.6,yScale:.6});
    if(expected)assert.deepEqual(maps,expected);else expected=maps;
    assert.deepEqual(Buffer.from(await (await request(maps[0].image)).arrayBuffer()),f.image);
    const manifestResponse=await request('/assets/assets/maps/core.map.json');assert.match(manifestResponse.headers.get('content-type'),/application\/json/);
    assert.deepEqual(await manifestResponse.json(),f.manifest);
    const tile=await request(maps[0].tile.baseUrl+'/0/0/0.webp');assert.equal(tile.status,200);assert.match(tile.headers.get('content-type'),/image\/webp/);
  }
  const server=createServer(new Engine(f.settings));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/page?page=Map');assert.equal(response.status,200);
  assert.deepEqual(configs((await response.json()).html),expected);
});


test('publication rejects missing, excluded, malformed or changed layer files',async t=>{
  const f=await fixture(t);f.manifest.layers=['borders.map-layers.json'];
  await fs.writeFile(f.manifestFile,JSON.stringify(f.manifest));
  await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')),/layer file missing or invalid/);
  const file=path.join(f.directory,'assets/maps/borders.map-layers.json');
  await fs.writeFile(file,JSON.stringify({version:1,layers:[{id:'bad',name:'Bad',regions:[{id:'x',name:'X',points:[[0,0],[1,1],[2,2]]}]}]}));
  await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')),/enclose/);
  await fs.writeFile(file,JSON.stringify({version:1,layers:[]}));
  const store=f.store();assert.ok(store.entries.some(e=>e.mapLayers));
  await fs.mkdir(path.join(f.directory,'assets/maps/private'));await fs.writeFile(path.join(f.directory,'assets/maps/private/.nopublish'),'');
  await fs.writeFile(path.join(f.directory,'assets/maps/private/borders.map-layers.json'),JSON.stringify({version:1,layers:[]}));
  f.manifest.layers=['private/borders.map-layers.json'];await fs.writeFile(f.manifestFile,JSON.stringify(f.manifest));
  await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')),/layer file missing or invalid/);
});


test('website paths follow date, campaign and publication visibility, and malformed notes do not break maps',async t=>{
  const f=await fixture(t,{width:300}),route={kind:'road',importance:'world',points:[[0,40],[200,40]]};
  for(const [name,extra] of [['Road',''],['Future','created: 1800\n'],['Hidden','excludePublish: all\n'],['Campaign','excludePublish: [secret]\n']])
    await fs.writeFile(path.join(f.directory,name+'.md'),'---\n'+extra+'mapPath: '+JSON.stringify(route)+'\n---\nBody');
  await fs.writeFile(path.join(f.directory,'Broken.md'),'---\nmapPath: {kind: river, points: [bad]}\n---\n');
  const store=f.store();await prepareMaps(store,path.join(f.directory,'tiles'));
  const warnings=[],render=context=>configs(renderMap(JSON.stringify(f.block),{store,entry:store.lookup('Map').entry,warnings,date:context.date,context}))[0];
  const old=render({date:'1700-01-01',campaigns:['secret']});assert.deepEqual(old.mapPaths.map(p=>p.id),['Road.md']);
  const recent=render({date:'1900-01-01',campaigns:[]});assert.deepEqual(recent.mapPaths.map(p=>p.id).sort(),['Campaign.md','Future.md','Road.md']);
  assert.deepEqual(old.sourceOffset,[0,0]);assert.ok(warnings.some(w=>/invalid mapPath.*Broken/.test(w)));
  assert.equal(old.regionLayers,undefined,'note paths do not require a border layer file');
});


test('referenced path files survive the working copy; unreferenced private inputs stay out and geometry changes invalidate publication',async t=>{
  const f=await fixture(t,{width:300}),source='_maps/paths/road.map-path.json',geometry={version:1,points:[[0,40],[200,40]]};
  await fs.mkdir(path.join(f.directory,'_maps/paths'),{recursive:true});
  await fs.writeFile(path.join(f.directory,source),JSON.stringify(geometry));
  await fs.writeFile(path.join(f.directory,'_maps/paths/unreferenced.map-path.json'),JSON.stringify(geometry));
  await fs.writeFile(path.join(f.directory,'Road.md'),'---\nmapPath: '+JSON.stringify({kind:'road',importance:'world',source})+'\n---\nBody');
  const original=await fs.readFile(path.join(f.directory,'Road.md'),'utf8');
  const working=await fs.mkdtemp(path.join(ROOT,'.cache','path-working-'));await fs.rmdir(working);
  t.after(()=>fs.rm(working,{recursive:true,force:true}));await copyWorkingVault(f.directory,working);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(working,source),'utf8')),geometry);
  await assert.rejects(fs.access(path.join(working,'_maps/paths/unreferenced.map-path.json')),{code:'ENOENT'});
  const store=new Store({...f.settings,source_dir:working});assert.deepEqual(store.lookup('Road').entry.mapPathGeometry,geometry);
  assert.equal(store.entries.some(e=>e.id.endsWith('.map-path.json')),false);assert.equal(await fs.readFile(path.join(f.directory,'Road.md'),'utf8'),original);
  const fingerprint=buildFingerprint(f.settings,{});
  await fs.writeFile(path.join(f.directory,source),JSON.stringify({...geometry,points:[[0,40],[210,40]]}));
  assert.notEqual(buildFingerprint(f.settings,{}),fingerprint,'even Git-ignored geometry must invalidate a build');
  await assert.rejects(prepareContent(f.settings,path.join(f.directory,'output'),{commit:'a'.repeat(40),dirty:false},{},undefined,undefined,{
    log:message=>{if(message==='Packaging notes and assets…')writeFileSync(path.join(f.directory,source),JSON.stringify(geometry));}
  }),/Path geometry changed after validation/);
});

test('path references cannot bypass missing files, malformed geometry, symlinks or publication boundaries',async t=>{
  const f=await fixture(t,{width:300}),source='_maps/paths/river.map-path.json';
  await fs.mkdir(path.join(f.directory,'_maps/paths'),{recursive:true});
  await fs.writeFile(path.join(f.directory,'River.md'),'---\nmapPath: '+JSON.stringify({kind:'river',source})+'\n---\n');
  const prepare=()=>prepareContent(f.settings,path.join(f.directory,'output'),{commit:'a'.repeat(40),dirty:false});
  await assert.rejects(prepare(),/geometry missing/);
  await fs.writeFile(path.join(f.directory,source),JSON.stringify({version:9,points:[[0,0],[20,20]]}));await assert.rejects(prepare(),/invalid/);
  const data=JSON.stringify({version:1,points:[[0,0],[20,20]]});await fs.writeFile(path.join(f.directory,source),data);
  await fs.writeFile(path.join(f.directory,'_maps/.nopublish'),'');await assert.rejects(prepare(),/excluded/);await fs.unlink(path.join(f.directory,'_maps/.nopublish'));
  await fs.unlink(path.join(f.directory,source));await fs.writeFile(path.join(f.directory,'other.json'),data);
  await fs.symlink(path.join(f.directory,'other.json'),path.join(f.directory,source));await assert.rejects(prepare(),/excluded/);
});


test('regional publication validates full PNGs, dimensions, exact paths and exclusion boundaries',async t=>{
  const f=await fixture(t,{width:300});
  const detail={version:1,name:'Area',image:'detail.png',worldBounds:{x:20,y:10,width:100,height:60},pixelSize:[800,480]};
  f.block.details=['assets/maps/detail.map-detail.json'];await fs.writeFile(path.join(f.directory,'Map.md'),fence(f.block));
  const manifestFile=path.join(f.directory,f.block.details[0]),imageFile=path.join(f.directory,'assets/maps/detail.png');
  await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')),/Regional manifest missing/);
  await fs.writeFile(manifestFile,JSON.stringify(detail));
  await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')),/Regional PNG is missing/);
  await fs.writeFile(imageFile,await sharp({create:{width:801,height:480,channels:4,background:'transparent'}}).png().toBuffer());
  await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')),/dimensions do not match/);
  const bytes=await sharp({create:{width:800,height:480,channels:4,background:'transparent'}}).png().toBuffer();
  await fs.writeFile(imageFile,bytes.subarray(0,33));
  await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')));
  await fs.writeFile(imageFile,bytes);await prepareMaps(f.store(),path.join(f.directory,'tiles'));
  await fs.mkdir(path.join(f.directory,'assets/private'));
  await fs.writeFile(path.join(f.directory,'assets/private/.nopublish'),'');
  await fs.writeFile(path.join(f.directory,'assets/private/detail.map-detail.json'),JSON.stringify(detail));
  f.block.details=['assets/private/detail.map-detail.json'];await fs.writeFile(path.join(f.directory,'Map.md'),fence(f.block));
  await assert.rejects(prepareMaps(f.store(),path.join(f.directory,'tiles')),/Regional manifest missing/);
});
