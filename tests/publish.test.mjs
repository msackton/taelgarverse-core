import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publishContent, parseOptions, repositoryIdentity, findObsidianCommand,
  createStorage, CHECKPOINT_KEY, validateCheckpoint, isMissingCheckpoint, runCommand} from '../scripts/publish-content.mjs';

const state = {repository: 'github.com/tsackton/taelgar', commit: 'a'.repeat(40), dirty: false};
const fingerprint = 'b'.repeat(64), revision = 'c'.repeat(64);
const checkpoint = {...state, schemaVersion: 1, fingerprint, revision};
function harness(overrides = {}) {
  const calls = [];
  const deps = {
    repositoryState: async () => ({...state}),
    readCheckpoint: async () => null,
    build: async () => { calls.push('build'); return {revision}; },
    upload: async () => { calls.push('upload'); },
    writeCheckpoint: async value => { calls.push('checkpoint'); validateCheckpoint(value); },
    recordBuild: async () => { calls.push('record'); },
    log: () => {}, ...overrides,
  };
  return {calls, deps};
}

test('unchanged clean Git commit/settings skips every build and write step', async () => {
  const {calls, deps} = harness({readCheckpoint: async () => checkpoint});
  const result = await publishContent({fingerprint}, deps);
  assert.equal(result.skipped, true);
  assert.deepEqual(calls, []);
});

test('first build, changed commit/settings/repository, and --force publish before checkpointing', async () => {
  for (const previous of [null, {...checkpoint, commit: 'd'.repeat(40)},
    {...checkpoint, fingerprint: 'd'.repeat(64)}, {...checkpoint, repository: 'github.com/other/vault'}]) {
    const {calls, deps} = harness({readCheckpoint: async () => previous});
    const result = await publishContent({fingerprint}, deps);
    assert.equal(result.commit, state.commit);
    assert.deepEqual(calls, ['build', 'upload', 'checkpoint', 'record']);
  }
  const {calls, deps} = harness({readCheckpoint: async () => checkpoint});
  await publishContent({fingerprint, force: true}, deps);
  assert.deepEqual(calls, ['build', 'upload', 'checkpoint', 'record']);
});

test('build/auth/upload failures never activate content or advance the commit', async () => {
  for (const failure of ['readCheckpoint', 'build', 'upload']) {
    const {calls, deps} = harness({[failure]: async () => { throw new Error('failed ' + failure); }});
    await assert.rejects(publishContent({fingerprint}, deps), new RegExp(failure));
    assert.equal(calls.includes('checkpoint'), false);
  }
});

test('changes during export or upload prevent the final R2 pointer write', async () => {
  for (const changeAt of [2, 3]) {
    let reads = 0;
    const {calls, deps} = harness({repositoryState: async () => ({...state, commit: ++reads >= changeAt ? 'd'.repeat(40) : state.commit})});
    await assert.rejects(publishContent({fingerprint}, deps), /changed during publishing/);
    assert.equal(calls.includes('checkpoint'), false);
    assert.equal(calls.includes('upload'), changeAt === 3);
  }
  let reads = 0;
  const {calls, deps} = harness({repositoryState: async () => ({...state, dirty: ++reads > 1})});
  await assert.rejects(publishContent({fingerprint}, deps), /changed during publishing/);
  assert.equal(calls.includes('upload'), false);
});

test('dirty builds require an option, are marked dirty, and never cause a later skip', async () => {
  const {deps, calls} = harness({repositoryState: async () => ({...state, dirty: true})});
  await assert.rejects(publishContent({fingerprint}, deps), /uncommitted changes/);
  assert.deepEqual(calls, []);
  const result = await publishContent({fingerprint, allowDirty: true}, deps);
  assert.equal(result.dirty, true);
  const retry = harness({readCheckpoint: async () => result});
  await publishContent({fingerprint}, retry.deps);
  assert.deepEqual(retry.calls, ['build', 'upload', 'checkpoint', 'record']);
});

test('build-only performs no R2 reads, uploads, or pointer writes', async () => {
  const {calls, deps} = harness({readCheckpoint: async () => { throw new Error('must not read'); }});
  await publishContent({fingerprint, buildOnly: true}, deps);
  assert.deepEqual(calls, ['build', 'record']);
});

test('CLI options and native executable detection support Windows and macOS paths', () => {
  assert.equal(parseOptions([]).maxSize, 2560);
  assert.equal(parseOptions(['--max-image-size', '4096', '--image-quality', '75']).quality, 75);
  for (const args of [['--max-image-size', '0'], ['--image-quality', '101'], ['--vault'], ['--local', '--build-only'], ['--unknown']]) {
    assert.throws(() => parseOptions(args));
  }
  const windows = 'C:\\Program Files\\Obsidian\\Obsidian.com';
  assert.equal(findObsidianCommand(null, 'win32', {ProgramFiles: 'C:\\Program Files'}, file => file === windows), windows);
  const mac = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
  assert.equal(findObsidianCommand(null, 'darwin', {}, file => file === mac), mac);
  assert.equal(findObsidianCommand('/custom/path', 'darwin', {}, () => false), '/custom/path');
  assert.equal(findObsidianCommand(null, 'darwin', {OBSIDIAN_COMMAND: '/env/path'}, () => false), '/env/path');
  assert.equal(repositoryIdentity('git@github.com:tsackton/taelgar.git'), state.repository);
  assert.equal(repositoryIdentity('https://user:token@github.com/tsackton/taelgar.git'), state.repository);
});

test('subprocess arguments containing spaces and shell characters remain literal', async () => {
  const value = 'a path with spaces; $(literal) `literal` & unicode é';
  const result = await runCommand(process.execPath, ['-e', 'console.log(process.argv[1])', value]);
  assert.equal(result.stdout.trim(), value);
});

test('R2 storage distinguishes missing object, legacy pointer, invalid data, and authentication failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taelgar-publish-test-'));
  t.after(() => fs.rm(directory, {recursive: true}));
  const filename = path.join(directory, 'checkpoint.json');
  let response = checkpoint, failure, recorded;
  const storage = createStorage({bucket: 'test-bucket', configFile: 'config path.json', run: async (exe, args) => {
    assert.equal(exe, process.execPath);
    assert.ok(args.includes('--remote'));
    assert.ok(args.includes('test-bucket/' + CHECKPOINT_KEY));
    if (failure) throw failure;
    if (args.includes('get')) await fs.writeFile(filename, JSON.stringify(response));
    else recorded = JSON.parse(await fs.readFile(filename, 'utf8'));
  }});
  assert.deepEqual(await storage.readCheckpoint(filename), checkpoint);
  response = {revision};
  assert.equal(await storage.readCheckpoint(filename), null);
  response = {commit: state.commit};
  await assert.rejects(storage.readCheckpoint(filename), /Invalid R2 build checkpoint/);
  failure = {stderr: 'The specified key does not exist.'};
  assert.equal(await storage.readCheckpoint(filename), null);
  failure = Object.assign(new Error('Authentication error'), {stderr: 'Authentication error'});
  await assert.rejects(storage.readCheckpoint(filename), /Authentication/);
  assert.equal(isMissingCheckpoint({stderr: 'The specified bucket does not exist.'}), false);
  failure = undefined;
  await storage.writeCheckpoint(checkpoint, filename);
  assert.deepEqual(recorded, checkpoint);
});
