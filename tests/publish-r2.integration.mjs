// Explicit local-only integration check; not part of the ordinary fast suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT, isInside} from '../src/config.mjs';
import {createRetentionStorage} from '../scripts/content-retention.mjs';
import {createStorage, publishContent, CHECKPOINT_KEY} from '../scripts/publish-content.mjs';
import {DerivativeCache,DERIVATIVE_MANIFEST_KEY} from '../scripts/derivative-cache.mjs';

test('real local R2 upload activates a readable commit checkpoint and skips the next build', async t => {
  const cache = path.join(ROOT, '.cache');
  await fs.mkdir(cache, {recursive: true});
  const directory = await fs.mkdtemp(path.join(cache, 'publisher-r2-test-'));
  let objects;
  t.after(async () => {
    await objects?.close();
    const resolved = await fs.realpath(directory);
    assert.ok(isInside(await fs.realpath(cache), resolved));
    assert.ok(path.basename(resolved).startsWith('publisher-r2-test-'));
    await fs.rm(resolved, {recursive: true});
  });
  const configFile = path.join(directory, 'wrangler.json');
  await fs.writeFile(configFile, JSON.stringify({name: 'publisher-local-test', compatibility_date: '2026-10-01',
    r2_buckets: [{binding: 'CONTENT', bucket_name: 'publisher-local-test'}]}));
  objects=await createRetentionStorage(JSON.parse(await fs.readFile(configFile,'utf8')),{local:true,persistTo:path.join(directory,'state')});
  const storage=createStorage({storage:async()=>objects});
  const checkpointFile = path.join(directory, 'checkpoint.json');
  assert.equal(await storage.readCheckpoint(checkpointFile), null);
  const revision = 'a'.repeat(64), fingerprint = 'b'.repeat(64);
  const file = path.join(directory, 'index.json');
  await fs.writeFile(file, JSON.stringify({revision, schemaVersion: 1}));
  const manifestFile = path.join(directory, 'uploads.json');
  const assetKey='assets/'+'b'.repeat(64),assetFile=path.join(directory,'asset.json');
  await fs.writeFile(assetFile,JSON.stringify('media bytes'));
  await fs.writeFile(manifestFile, JSON.stringify([{key:assetKey,file:assetFile},{key: `revisions/${revision}/index.json`, file}]));
  const derivativeManifestFile=path.join(directory,'derivatives.json'),recipe='images/'+'d'.repeat(64);
  await fs.writeFile(derivativeManifestFile,JSON.stringify({schemaVersion:1,records:{[recipe]:{data:null,outputs:[{
    target:'image-variants/'+'d'.repeat(64)+'/120.webp',key:assetKey,size:(await fs.stat(assetFile)).size,
  }]}}}));
  const writes=[],putFile=objects.putFile;
  objects.putFile=async(key,file)=>{writes.push(key);await putFile(key,file);};
  const state = {repository: 'github.com/example/taelgar', commit: 'c'.repeat(40), dirty: false};
  const deps = {
    repositoryState: async () => state, log: () => {},
    readCheckpoint: () => storage.readCheckpoint(checkpointFile),
    build: async () => ({revision, manifestFile,derivativeManifestFile}), upload: (report,options) => storage.upload(report,options),
    writeCheckpoint: value => storage.writeCheckpoint(value, checkpointFile), recordBuild: async () => {},
  };
  await publishContent({fingerprint,assetsOnly:true},deps);
  assert.deepEqual(writes,[assetKey]);assert.equal(await objects.getJSON(assetKey),'media bytes');
  assert.equal(await storage.readCheckpoint(checkpointFile),null);
  assert.ok((await objects.getJSON(DERIVATIVE_MANIFEST_KEY)).records[recipe]);
  assert.ok((await DerivativeCache.load(objects)).get('images','d'.repeat(64),()=>true));
  const size=(await fs.stat(assetFile)).size;
  await fs.unlink(assetFile);
  await fs.writeFile(manifestFile,JSON.stringify([{key:assetKey,remoteOnly:true,size},{key:`revisions/${revision}/index.json`,file}]));
  writes.length=0;
  await publishContent({fingerprint}, deps);
  assert.deepEqual(writes,[`revisions/${revision}/index.json`]);
  const saved = await storage.readCheckpoint(checkpointFile);
  assert.equal(saved.commit, state.commit);
  assert.equal(saved.revision, revision);
  assert.equal(CHECKPOINT_KEY, 'published/current.json');
  deps.build = async () => { throw new Error('unchanged source must skip'); };
  assert.equal((await publishContent({fingerprint}, deps)).skipped, true);
});
