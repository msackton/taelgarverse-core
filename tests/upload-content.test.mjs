import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {uploadContent} from '../scripts/upload-content.mjs';
import {createCloudflareClient} from '../scripts/cloudflare-client.mjs';
import {createRetentionStorage} from '../scripts/content-retention.mjs';

const revision='a'.repeat(64),asset=letter=>'assets/'+letter.repeat(64),note='revisions/'+revision+'/index.json';
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'taelgar-upload-test-'));
  t.after(async()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('taelgar-upload-test-'));await fs.rm(dir,{recursive:true});});
  const uploads=[];
  for(const [i,key] of [asset('b'),asset('c'),asset('d'),note].entries()){
    const file=path.join(dir,String(i));await fs.writeFile(file,'bytes-'+i);uploads.push({key,file});
  }
  const manifestFile=path.join(dir,'uploads.json');await fs.writeFile(manifestFile,JSON.stringify(uploads));
  return {dir,uploads,report:{revision,manifestFile}};
}
test('assets reuse destination inventory and repair wrong sizes before uploading notes',async t=>{
  const {report}=await fixture(t),calls=[];
  const storage={list:async prefix=>{assert.equal(prefix,'assets/');return [{key:asset('b'),size:7},{key:asset('c'),size:99}];},putFile:async key=>calls.push(key)};
  const result=await uploadContent(report,storage);
  assert.deepEqual(result,{reusedAssets:1,uploadedAssets:2,uploadedSnapshots:1});
  assert.deepEqual(calls,[asset('c'),asset('d'),note]);
});
test('interrupted uploads drain in-flight writes, resume from R2, and never advance to notes on failure',async t=>{
  const {report}=await fixture(t),stored=new Map(),calls=[];let fail=true,inFlight=0;
  const storage={list:async()=>[...stored].map(([key,size])=>({key,size})),putFile:async key=>{
    calls.push(key);inFlight++;
    try{await new Promise(resolve=>setImmediate(resolve));if(fail && key===asset('c'))throw Error('connection dropped');stored.set(key,7);}
    finally{inFlight--;}
  }};
  await assert.rejects(uploadContent(report,storage),/Completed assets remain reusable/);
  assert.equal(inFlight,0);assert.ok(!calls.includes(note));assert.equal(stored.size,2);
  fail=false;calls.length=0;
  const result=await uploadContent(report,storage);assert.equal(result.reusedAssets,2);assert.deepEqual(calls,[asset('c'),note]);
});
test('assets-only omits notes; a changed destination or a cleanup deletion forces upload again',async t=>{
  const {report}=await fixture(t),calls=[],stored=new Map();
  const storage={list:async()=>[...stored].map(([key,size])=>({key,size})),putFile:async key=>{calls.push(key);stored.set(key,7);}};
  const first=await uploadContent(report,storage,{assetsOnly:true});assert.equal(first.uploadedSnapshots,0);assert.ok(!calls.includes(note));
  calls.length=0;assert.equal((await uploadContent(report,storage)).reusedAssets,3);assert.deepEqual(calls,[note]);
  stored.delete(asset('b'));calls.length=0;
  await uploadContent(report,storage);assert.deepEqual(calls,[asset('b'),note]);
  stored.clear();calls.length=0;await uploadContent(report,storage);assert.equal(calls.length,4);
});
test('unsafe manifests and failed listings do not upload anything',async t=>{
  const {report}=await fixture(t);
  const storage={list:async()=>{throw Error('incomplete listing');},putFile:async()=>assert.fail('must not upload')};
  await assert.rejects(uploadContent(report,storage),/incomplete listing/);
  await fs.writeFile(report.manifestFile,JSON.stringify([{key:'published/current.json',file:'unused'}]));
  await assert.rejects(uploadContent(report,storage),/unexpected object keys/);
});
test('remote upload retries reopen streams and wait for acknowledged successful writes',async t=>{
  const {uploads}=await fixture(t);let attempts=0;const contents=[],tokens=[];
  const client=await createCloudflareClient({}, {credentials:()=>({account:'a'.repeat(32),token:'secret'}),intervalMs:0,wait:async()=>{},fetcher:async(url,init)=>{
    assert.match(url,/\/r2\/buckets\/test-content\/objects\/assets\//);
    assert.equal(init.headers['Content-Length'],'7');tokens.push(init.headers.Authorization);
    let body='';for await(const chunk of init.body)body+=chunk.toString();contents.push(body);
    if(++attempts===1)throw new TypeError('fetch failed');
    return new Response('{}');
  }});
  const storage=await createRetentionStorage({r2_buckets:[{binding:'CONTENT',bucket_name:'test-content'}]},{client});
  await storage.putFile(uploads[0].key,uploads[0].file);
  assert.deepEqual(contents,['bytes-0','bytes-0']);assert.equal(tokens.length,2);
});
