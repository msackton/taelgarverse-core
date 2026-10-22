import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setImmediate} from 'node:timers/promises';
import sharp from 'sharp';
import {ContentStore} from '../src/content-store.mjs';
import {prepareImages} from '../scripts/build-images.mjs';

async function fixture(t){
  const directory=await fs.mkdtemp(path.resolve('.cache/image-parallel-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const entries=[];
  for(const [index,width] of [1600,180,640].entries()){
    const id=index+'.png',filename=path.join(directory,id);
    await sharp({create:{width,height:240,channels:4,background:['#a61d9280','#b00a4780','#127e3280'][index]}}).png().toFile(filename);
    entries.push({id,filename,target:id,extension:'.png',note:null});
  }
  return {directory,entries,store:()=>new ContentStore(entries.map(e=>({...e}))),usages:new Map(entries.map(e=>[e.id,[[{width:160}]]]))};
}
async function output(store){
  return Promise.all(store.entries.map(async({filename,...entry})=>({entry,bytes:await fs.readFile(filename)})));
}

test('parallel image builds preserve serial bytes, URLs and asset ordering; cache reuse reports no encoding',async t=>{
  const {directory,store,usages}=await fixture(t),serial=store(),parallel=store();
  const first=await prepareImages(serial,path.join(directory,'serial'),{usages,concurrency:1});
  const progress=[];
  const second=await prepareImages(parallel,path.join(directory,'parallel'),{usages,concurrency:3},undefined,p=>progress.push(p));
  assert.deepEqual(await output(parallel),await output(serial));
  assert.deepEqual(second,first);assert.equal(second.generated,3);
  assert.deepEqual(progress.map(p=>p.processed),[1,2,3]);
  assert.ok(progress.every(p=>p.elapsedMs>=0 && p.generated+p.reusedLocal+p.reusedRemote+p.skipped===p.processed));
  const cached=await prepareImages(store(),path.join(directory,'parallel'),{usages});
  assert.equal(cached.generated,0);assert.equal(cached.reusedLocal,3);assert.equal(cached.reusedRemote,0);
  await assert.rejects(prepareImages(store(),directory,{usages,concurrency:0}),/concurrency/);
});

test('identical images at different vault paths share one concurrent recipe build',async t=>{
  const {directory,entries}=await fixture(t),duplicate={...entries[0],id:'copy.png',target:'copy.png',filename:path.join(directory,'copy.png')};
  await fs.copyFile(entries[0].filename,duplicate.filename);
  const store=new ContentStore([{...entries[0]},duplicate]);
  const usages=new Map(store.entries.map(e=>[e.id,[[{width:160}]]]));
  const stats=await prepareImages(store,path.join(directory,'cache'),{usages});
  assert.equal(stats.images,2);assert.equal(stats.generated,1);assert.equal(stats.reusedLocal,1);
  assert.deepEqual(store.entries[0].image,store.entries[1].image);
  assert.equal((await fs.readdir(path.join(directory,'cache'))).length,1);
});

test('image failures drain active work and stop queued work before rejecting',async t=>{
  const {directory,entries}=await fixture(t),readFile=fs.readFile;
  let release,failed,settled=false,queuedRead=false;
  const gate=new Promise(resolve=>{release=resolve;}),failureSeen=new Promise(resolve=>{failed=resolve;});
  const missing={...entries[1],filename:path.join(directory,'missing.png')};
  t.mock.method(fs,'readFile',async function(filename,...args){
    if(filename===entries[0].filename)await gate;
    if(filename===entries[2].filename)queuedRead=true;
    if(filename===missing.filename){failed();throw Object.assign(new Error('missing source'),{code:'ENOENT'});}
    return readFile.call(this,filename,...args);
  });
  const store=new ContentStore([{...entries[0]},missing,{...entries[2]}]);
  const usages=new Map(store.entries.map(e=>[e.id,[[{width:160}]]]));
  const task=prepareImages(store,path.join(directory,'cache'),{usages,concurrency:2});
  task.then(()=>{settled=true;},()=>{settled=true;});
  await failureSeen;await setImmediate();
  const settledBeforeRelease=settled;release();
  await assert.rejects(task,/missing source/);
  assert.equal(settledBeforeRelease,false);
  assert.equal(queuedRead,false);
  const keys=await fs.readdir(path.join(directory,'cache'));
  assert.equal(keys.length,1);
  await fs.access(path.join(directory,'cache',keys[0],'complete.json'));
  assert.equal(store.entries.length,3);
});
