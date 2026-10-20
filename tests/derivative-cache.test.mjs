import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {ROOT,isInside,loadSettings} from '../src/config.mjs';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {prepareImages} from '../scripts/build-images.mjs';
import {prepareMaps} from '../scripts/build-maps.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {uploadContent} from '../scripts/upload-content.mjs';
import {DerivativeCache,DERIVATIVE_MANIFEST_KEY,readDerivativeManifest} from '../scripts/derivative-cache.mjs';

async function fixture(t){
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','derivative-test-'));
  t.after(async()=>{const resolved=await fs.realpath(directory);assert.ok(isInside(await fs.realpath(path.join(ROOT,'.cache')),resolved));await fs.rm(resolved,{recursive:true});});
  const source=path.join(directory,'source');await fs.mkdir(source);
  await sharp({create:{width:800,height:500,channels:3,background:'#8ac123'}}).jpeg().toFile(path.join(source,'image.jpg'));
  await sharp({create:{width:4100,height:64,channels:3,background:'#123abc'}}).png().toFile(path.join(source,'map.png'));
  const body='![[image.jpg|120]]\n\n```leaflet\nimage: [[map.png]]\nbounds: [[0,0],[64,4100]]\n```';
  await fs.writeFile(path.join(source,'Gallery.md'),body);
  const store=()=>new ContentStore([
    ...['image.jpg','map.png'].map(id=>({id,target:id,extension:path.extname(id),filename:path.join(source,id),note:null})),
    {id:'Gallery.md',target:'gallery.md',slug:'gallery',name:'Gallery',title:'Gallery',note:parseNote(body)},
  ],[]);
  return {directory,source,store};
}
async function describeAssets(store){
  for(const entry of store.entries.filter(e=>!e.note)){
    const bytes=await fs.readFile(entry.filename);entry.size=bytes.length;entry.objectKey='assets/'+createHash('sha256').update(bytes).digest('hex');
  }
}
function memoryStorage(){
  const objects=new Map(),writes=[];
  return {objects,writes,
    async getJSON(key){return objects.has(key)?JSON.parse(objects.get(key)):null;},
    async list(prefix){return [...objects].filter(([key])=>key.startsWith(prefix)).map(([key,bytes])=>({key,size:bytes.length}));},
    async putFile(key,file){writes.push(key);objects.set(key,await fs.readFile(file));},
    async putDerivativeManifest(value){writes.push(DERIVATIVE_MANIFEST_KEY);objects.set(DERIVATIVE_MANIFEST_KEY,Buffer.from(JSON.stringify(value)));},
  };
}

test('cold machines reuse images and complete map pyramids without derivative files; missing objects and changed recipes rebuild',async t=>{
  const {directory,store:makeStore}=await fixture(t),store=makeStore(),cache=new DerivativeCache();
  await prepareImages(store,path.join(directory,'first-images'),{},undefined,undefined,cache);
  await prepareMaps(store,path.join(directory,'first-maps'),cache);
  await describeAssets(store);
  const manifest=cache.manifest(store.entries),records=manifest.records;
  assert.ok(Object.keys(records).some(id=>id.startsWith('images/')));
  assert.ok(Object.keys(records).some(id=>id.startsWith('maps/')));
  const inventory=new Map(store.entries.filter(e=>!e.note).map(e=>[e.objectKey,e.size]));
  const cold=new DerivativeCache(records,inventory),fresh=makeStore();
  await prepareImages(fresh,path.join(directory,'cold-images'),{},undefined,undefined,cold);
  await prepareMaps(fresh,path.join(directory,'cold-maps'),cold);
  assert.equal(cold.hits.images,cache.used.size-1);assert.equal(cold.hits.maps,1);
  await assert.rejects(fs.access(path.join(directory,'cold-images')),/ENOENT/);
  await assert.rejects(fs.access(path.join(directory,'cold-maps')),/ENOENT/);
  for(const entry of fresh.entries.filter(e=>e.generatedImageVariant || e.generatedMapTile))assert.ok(entry.remoteAsset);
  assert.deepEqual(fresh.entries.find(e=>e.id==='image.jpg').image,store.entries.find(e=>e.id==='image.jpg').image);
  assert.deepEqual(fresh.entries.find(e=>e.id==='map.png').mapTiles,store.entries.find(e=>e.id==='map.png').mapTiles);

  const imageRecord=Object.values(records).find(record=>record.data?.width===800),mapRecord=Object.entries(records).find(([id])=>id.startsWith('maps/'))[1];
  const missingInventory=new Map(inventory);missingInventory.delete(imageRecord.outputs[0].key);missingInventory.delete(mapRecord.outputs[0].key);
  const missing=new DerivativeCache(records,missingInventory),repaired=makeStore();
  await prepareImages(repaired,path.join(directory,'repair-images'),{},undefined,undefined,missing);
  await prepareMaps(repaired,path.join(directory,'repair-maps'),missing);
  assert.equal(missing.hits.maps,0);assert.ok(repaired.entries.filter(e=>e.generatedMapTile).every(e=>!e.remoteAsset));
  assert.ok(repaired.entries.filter(e=>e.generatedImageVariant && e.target.includes(imageRecord.outputs[0].target.split('/')[1])).every(e=>!e.remoteAsset));
  const changed=new DerivativeCache(records,inventory),changedStore=makeStore();
  await prepareImages(changedStore,path.join(directory,'changed'),{quality:60},undefined,undefined,changed);
  assert.equal(changed.hits.images,0);
  // A recipe version bump produces a new key, just as changed settings do.
  assert.equal(cold.get('images','f'.repeat(64),()=>true),null);
  const invalid=structuredClone(records);Object.values(invalid).find(record=>record.data?.width===800).data.variants[0].file='../unsafe.webp';
  const invalidCache=new DerivativeCache(invalid,inventory),invalidStore=makeStore();
  await prepareImages(invalidStore,path.join(directory,'invalid'),{},undefined,undefined,invalidCache);
  assert.ok(invalidStore.entries.some(e=>e.generatedImageVariant && !e.remoteAsset));
});

test('packaging from R2 yields the same snapshot and uploads only metadata; lost references stop publication',async t=>{
  const {directory,source}=await fixture(t),storage=memoryStorage();
  const settings={...loadSettings(),source_dir:source,home_source:null,nav_source:null};
  const version={commit:'a'.repeat(40),dirty:false};
  const first=await prepareContent(settings,path.join(directory,'package-first'),version);
  await uploadContent(first,storage,{assetsOnly:true});
  assert.ok(storage.objects.has(DERIVATIVE_MANIFEST_KEY));
  assert.ok(!storage.writes.some(key=>key.startsWith('revisions/')));
  const remote=await DerivativeCache.load(storage);
  const second=await prepareContent(settings,path.join(directory,'package-second'),version,{},undefined,remote);
  assert.ok(remote.hits.images>0);assert.equal(remote.hits.maps,1);
  assert.equal(second.revision,first.revision);
  assert.deepEqual(JSON.parse(await fs.readFile(second.indexFile)),JSON.parse(await fs.readFile(first.indexFile)));
  const uploads=JSON.parse(await fs.readFile(second.manifestFile));
  const references=uploads.filter(item=>item.remoteOnly);assert.ok(references.length>10);
  for(const item of references){assert.equal(item.file,undefined);await assert.rejects(fs.access(path.join(directory,'package-second','objects',item.key.slice(7))),/ENOENT/);}
  storage.writes.length=0;
  const result=await uploadContent(second,storage);assert.equal(result.uploadedAssets,0);
  assert.ok(storage.writes.every(key=>key===DERIVATIVE_MANIFEST_KEY || key.startsWith('revisions/')));
  storage.objects.delete(references[0].key);storage.writes.length=0;
  await assert.rejects(uploadContent(second,storage),/Prepare the snapshot again/);
  assert.deepEqual(storage.writes,[]);
});

test('failed asset transfer cannot advertise new recipes; stale and malformed cache hints are disposable',async t=>{
  const {directory,source}=await fixture(t),storage=memoryStorage();
  const settings={...loadSettings(),source_dir:source,home_source:null,nav_source:null};
  const report=await prepareContent(settings,path.join(directory,'package'),{commit:'b'.repeat(40),dirty:false});
  const put=storage.putFile;storage.putFile=async()=>{throw Error('network failure');};
  await assert.rejects(uploadContent(report,storage),/network failure/);
  assert.equal(await storage.getJSON(DERIVATIVE_MANIFEST_KEY),null);
  storage.putFile=put;await uploadContent(report,storage,{assetsOnly:true});
  const old=await storage.getJSON(DERIVATIVE_MANIFEST_KEY),[id,record]=Object.entries(old.records)[0];
  const staleId=id.split('/')[0]+'/'+'f'.repeat(64);
  old.records[staleId]={...record,outputs:record.outputs.map(o=>({...o,target:o.target.replace(id.split('/')[1],'f'.repeat(64)),key:'assets/'+'f'.repeat(64)}))};
  await storage.putDerivativeManifest(old);
  await uploadContent(report,storage,{assetsOnly:true});
  assert.ok(!(staleId in (await storage.getJSON(DERIVATIVE_MANIFEST_KEY)).records));
  storage.objects.set(DERIVATIVE_MANIFEST_KEY,Buffer.from('{bad json'));
  assert.deepEqual(await readDerivativeManifest(storage),{});
  storage.getJSON=async()=>{throw Error('Unauthorized');};
  await assert.rejects(DerivativeCache.load(storage),/Unauthorized/);
});
