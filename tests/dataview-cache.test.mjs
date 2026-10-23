import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {DATAVIEW_RELEASE,ensureCachedDataview,sha256} from '../src/dataview-node/bundle.mjs';

async function fixture(t) {
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const parent=await fs.mkdtemp(path.join(ROOT,'.cache','dataview-cache-test-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),parent));await fs.rm(parent,{recursive:true,force:true});});
  const files={'main.js':Buffer.from('const fixture = true;\n'),'manifest.json':Buffer.from(JSON.stringify({id:'dataview',version:DATAVIEW_RELEASE.version}))};
  const release={...DATAVIEW_RELEASE,hashes:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha256(bytes)]))};
  const calls=[],fetchImpl=async url=>{calls.push(url);return new Response(files[url.split('/').at(-1)]);};
  return {parent,directory:path.join(parent,release.version),files,release,calls,fetchImpl};
}

test('pinned download is shared by concurrent callers, installed atomically, and reused offline',async t=>{
  const f=await fixture(t);
  const directories=await Promise.all([ensureCachedDataview(f),ensureCachedDataview(f)]);
  assert.deepEqual(directories,[f.directory,f.directory]);assert.equal(f.calls.length,2);
  assert.deepEqual(new Set(f.calls),new Set(Object.keys(f.files).map(name=>DATAVIEW_RELEASE.url+'/'+name)));
  for(const [name,bytes] of Object.entries(f.files))assert.deepEqual(await fs.readFile(path.join(f.directory,name)),bytes);
  assert.deepEqual(await fs.readdir(f.parent),[f.release.version]);
  assert.equal(await ensureCachedDataview({...f,fetchImpl:()=>assert.fail('verified cache must work offline')}),f.directory);
});

test('failed HTTP or checksum validation leaves no partial cache and a later download can succeed',async t=>{
  const f=await fixture(t);
  for(const fetchImpl of [async()=>new Response('unavailable',{status:503}),async()=>new Response('unreviewed bytes')]) {
    await assert.rejects(ensureCachedDataview({...f,fetchImpl}),/Cannot download pinned Dataview/);
    assert.equal(await fs.stat(f.directory).catch(()=>null),null);assert.deepEqual(await fs.readdir(f.parent),[]);
  }
  assert.equal(await ensureCachedDataview(f),f.directory);
});

test('cached files are reverified and corruption never triggers a vault or network fallback',async t=>{
  const f=await fixture(t);await ensureCachedDataview(f);
  await fs.writeFile(path.join(f.directory,'main.js'),'changed code');
  await assert.rejects(ensureCachedDataview({...f,fetchImpl:()=>assert.fail('corruption must be reported explicitly')}),/Invalid pinned Dataview cache.*checksum mismatch/);
  assert.equal(await fs.readFile(path.join(f.directory,'main.js'),'utf8'),'changed code');
});

test('a manifest with the wrong plugin/version is rejected before cache promotion',async t=>{
  const f=await fixture(t);f.files['manifest.json']=Buffer.from(JSON.stringify({id:'other',version:'0.0.1'}));
  f.release.hashes['manifest.json']=sha256(f.files['manifest.json']);
  await assert.rejects(ensureCachedDataview(f),/manifest does not match the pinned release/);
  assert.equal(await fs.stat(f.directory).catch(()=>null),null);assert.deepEqual(await fs.readdir(f.parent),[]);
});
