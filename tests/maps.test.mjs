import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {load} from 'cheerio';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {parseMap,mapImages} from '../src/maps.mjs';
import {createMarkdown,renderMarkdown} from '../src/markdown.mjs';
import {prepareMaps} from '../scripts/build-maps.mjs';
import {optimizeImages} from '../scripts/optimize-images.mjs';
import {ROOT} from '../src/config.mjs';

const definition = 'id: repeated\nimage: [[map with spaces.png]]\nbounds:\n- [0,0]\n- [64,4100]\nheight: 700px\nwidth: 900px\nlat: 32\nlong: 2050\nminZoom: -3\nmaxZoom: 2\ndefaultZoom: -1\n';
function fixture(filename) {
  const entry = {id:'assets/map with spaces.png',target:'assets/map-with-spaces.png',extension:'.png',filename};
  const author = {id:'Places/Maps.md',name:'Maps',target:'places/maps.md',slug:'places/maps',note:parseNote('```leaflet \n'+definition+'```')};
  return {entry,author,store:new ContentStore([entry,author])};
}
function render(source,store,entry) {
  const env = {store,entry,date:'1750-01-01',context:{date:'1750-01-01',campaigns:[]},warnings:[]};
  return {...renderMarkdown(createMarkdown(),source,env),warnings:env.warnings};
}

test('Leaflet definitions resolve vault and relative images, preserve coordinates, and recover safely',()=>{
  const {store,author} = fixture();
  for (const image of ['[[map with spaces.png]]','[[[map with spaces.png]]]','[[../assets/map with spaces.png]]']) {
    const source = '```leaflet \n'+definition.replace('[[map with spaces.png]]',image)+'```';
    const result = render(source,store,author), $ = load(result.html), config = JSON.parse($('.leaflet-map').attr('data-map'));
    assert.deepEqual(config.bounds,[[0,0],[64,4100]]);
    assert.deepEqual(config.center,[32,2050]);
    assert.equal(config.defaultZoom,-1);assert.equal(config.minZoom,-3);assert.equal(config.maxZoom,2);
    assert.equal(config.height,'700px');assert.equal(config.width,'900px');
    assert.deepEqual(config.measurement,{xScale:1,yScale:1,unit:'map units'});
    assert.equal($('.map-canvas[hidden][role="region"]').length,1);
    assert.equal($('figcaption a').attr('href'),'/assets/assets/map-with-spaces.png');
    assert.deepEqual(result.warnings,[]);
  }
  const repeated = load(render(author.note.body+'\n'+author.note.body,store,author).html);
  assert.equal(repeated('.leaflet-map').length,2);assert.equal(repeated('[id="repeated"]').length,0);
  for (const invalid of ['bounds: [bad]','image: [[missing.png]]\nbounds: [[0,0],[1,1]]',
    definition.replace('700px','700px; background:url(evil)'),definition.replace('minZoom: -3','minZoom: 7'),
    definition+'bad: &a [*a]']) {
    const result = render('```leaflet\n'+invalid+'\n```',store,author), $ = load(result.html);
    assert.equal($('.leaflet-map').length,0);assert.equal($('.warning').length,1);assert.equal(result.warnings.length,1);
    assert.equal($('script,img').length,0);
  }
  assert.throws(()=>parseMap(definition.replace('[[map with spaces.png]]','javascript:alert(1)'),store,author));
});

test('map measurement preserves authored scale and unit; invalid calibration leaves the map available',()=>{
  const {store,author}=fixture();
  const parsed=parseMap(definition+'unit: miles\nscale: 0.5\n',store,author);
  assert.deepEqual(parsed.config.measurement,{xScale:0.5,yScale:0.5,unit:'miles'});
  for(const settings of ['unit: []','unit: ""','scale: 0','scale: -1','scale: .inf','scale: "0.5"']){
    const result=render('```leaflet\n'+definition+settings+'\n```',store,author),$=load(result.html);
    assert.equal($('.leaflet-map').length,1);
    assert.equal(JSON.parse($('.leaflet-map').attr('data-map')).measurement,null);
    assert.match(result.warnings[0],/distance measurement disabled/);
  }
});

test('leaflet blocks carry their own source-pixel calibration through website rendering',()=>{
  const {store,author,entry}=fixture();entry.sha256='a'.repeat(64);
  const calibration='calibration:\n  hexMiles: 24\n  hexPixels: 40\n  imageSize: [200, 100]\n  imageSha256: '+entry.sha256+'\n';
  const source='```leaflet\n'+definition+'scale: 999\n'+calibration+'```';
  const result=render(source,store,author),$=load(result.html);
  const options=JSON.parse($('.leaflet-map').attr('data-map')).measurement;
  assert.equal(options.unit,'miles');assert.equal(options.hexMiles,24);
  assert.equal(options.xScale,200*0.6/4100);assert.equal(options.yScale,100*0.6/64);
  assert.deepEqual(result.warnings,[]);
  entry.sha256='b'.repeat(64);
  const changed=render(source,store,author);
  assert.equal(JSON.parse(load(changed.html)('.leaflet-map').attr('data-map')).measurement,null);
  assert.match(changed.warnings[0],/distance measurement disabled/);
});

test('local preparation fingerprints new calibrated maps without a registered path or tile pyramid',async t=>{
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','map-calibration-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const filename=path.join(directory,'custom.png');
  await sharp({create:{width:200,height:100,channels:3,background:'#ef2020'}}).png().toFile(filename);
  const {entry,author,store}=fixture(filename);
  const fingerprint=createHash('sha256').update(await fs.readFile(filename)).digest('hex');
  author.note.body='```leaflet\nimage: [[map with spaces.png]]\nbounds: [[0,0],[100,200]]\ncalibration:\n  hexMiles: 24\n  hexPixels: 40\n  imageSize: [200,100]\n  imageSha256: '+fingerprint+'\n```';
  assert.equal(JSON.parse(load(render(author.note.body,store,author).html)('.leaflet-map').attr('data-map')).measurement,null);
  assert.deepEqual(await prepareMaps(store,path.join(directory,'tiles')),[]);
  assert.equal(entry.sha256,fingerprint);
  const ready=render(author.note.body,store,author);
  assert.deepEqual(JSON.parse(load(ready.html)('.leaflet-map').attr('data-map')).measurement,{unit:'miles',hexMiles:24,xScale:0.6,yScale:0.6});
  assert.deepEqual(ready.warnings,[]);
});

test('map images retain full resolution and tiled maps include aligned edge tiles, native zooms and a reusable cache',async t=>{
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const directory = await fs.mkdtemp(path.join(ROOT,'.cache','maps-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const filename = path.join(directory,'map.png');
  await sharp({create:{width:4100,height:64,channels:3,background:'#ef2020'}}).png().toFile(filename);
  const {entry,author,store} = fixture(filename);
  assert.equal(mapImages(store).length,1);assert.equal(entry.mapImage,true);
  await optimizeImages([entry],path.join(directory,'optimized'),{maxSize:120});
  assert.equal((await sharp(filename).metadata()).width,4100);
  const files = await prepareMaps(store,path.join(directory,'tiles'));
  assert.ok(files.length > 10);assert.equal(entry.mapTiles.length,1);
  const tile = entry.mapTiles[0];assert.equal(tile.maxNativeZoom,0);assert.ok(tile.minNativeZoom<0);
  const $ = load(render(author.note.body,store,author).html);
  assert.equal(JSON.parse($('.leaflet-map').attr('data-map')).tile.baseUrl,tile.baseUrl);
  const edge = files.find(file=>file.target.endsWith('/0/8/0.webp'));
  assert.ok(edge);const edgeBytes = await fs.readFile(edge.filename);
  assert.equal((await sharp(edgeBytes).metadata()).width,512);
  const {data,info} = await sharp(edgeBytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const bottom = (500*info.width)*info.channels;
  assert.ok(data[bottom] > 180 && data[bottom+1] < 70,'southern edge aligns with pixel Y zero');
  assert.ok(data[0] > 180 && data[1] > 180,'partial tiles are padded on the northern edge');
  const modified = (await fs.stat(edge.filename)).mtimeMs;
  assert.equal((await prepareMaps(store,path.join(directory,'tiles'))).length,0);
  assert.equal((await fs.stat(edge.filename)).mtimeMs,modified);
  await fs.unlink(edge.filename);
  await prepareMaps(store,path.join(directory,'tiles'));
  assert.ok((await fs.stat(edge.filename)).size>0,'incomplete cache is repaired');
});
