// Explicit local-only integration check; not part of the ordinary fast suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT, isInside} from '../src/config.mjs';
import {createStorage, publishContent, CHECKPOINT_KEY} from '../scripts/publish-content.mjs';

test('real Wrangler local R2 upload activates a readable commit checkpoint and skips the next build', async t => {
  const cache = path.join(ROOT, '.cache');
  await fs.mkdir(cache, {recursive: true});
  const directory = await fs.mkdtemp(path.join(cache, 'publisher-r2-test-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.ok(isInside(await fs.realpath(cache), resolved));
    assert.ok(path.basename(resolved).startsWith('publisher-r2-test-'));
    await fs.rm(resolved, {recursive: true});
  });
  const configFile = path.join(directory, 'wrangler.json');
  await fs.writeFile(configFile, JSON.stringify({name: 'publisher-local-test', compatibility_date: '2026-10-01',
    r2_buckets: [{binding: 'CONTENT', bucket_name: 'publisher-local-test'}]}));
  const storage = createStorage({bucket: 'publisher-local-test', configFile, local: true, persistTo: path.join(directory, 'state')});
  const checkpointFile = path.join(directory, 'checkpoint.json');
  assert.equal(await storage.readCheckpoint(checkpointFile), null);
  const revision = 'a'.repeat(64), fingerprint = 'b'.repeat(64);
  const file = path.join(directory, 'index.json');
  await fs.writeFile(file, JSON.stringify({revision, schemaVersion: 1}));
  const manifestFile = path.join(directory, 'uploads.json');
  await fs.writeFile(manifestFile, JSON.stringify([{key: `revisions/${revision}/index.json`, file}]));
  const state = {repository: 'github.com/example/taelgar', commit: 'c'.repeat(40), dirty: false};
  const deps = {
    repositoryState: async () => state, log: () => {},
    readCheckpoint: () => storage.readCheckpoint(checkpointFile),
    build: async () => ({revision, manifestFile}), upload: report => storage.upload(report),
    writeCheckpoint: value => storage.writeCheckpoint(value, checkpointFile), recordBuild: async () => {},
  };
  await publishContent({fingerprint}, deps);
  const saved = await storage.readCheckpoint(checkpointFile);
  assert.equal(saved.commit, state.commit);
  assert.equal(saved.revision, revision);
  assert.equal(CHECKPOINT_KEY, 'published/current.json');
  deps.build = async () => { throw new Error('unchanged source must skip'); };
  assert.equal((await publishContent({fingerprint}, deps)).skipped, true);
});
