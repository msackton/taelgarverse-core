import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publishContent, parseOptions, repositoryIdentity, findObsidianCommand,
  createStorage, CHECKPOINT_KEY, validateCheckpoint, runCommand, buildFingerprint,
  validateMaterializationReport} from '../scripts/publish-content.mjs';

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
    await assert.rejects(publishContent({fingerprint}, deps), /changed during publishing.*did not activate new content.*rerun the publish command/);
    assert.equal(calls.includes('checkpoint'), false);
    assert.equal(calls.includes('upload'), changeAt === 3);
  }
  let reads = 0;
  const {calls, deps} = harness({repositoryState: async () => ({...state, dirty: ++reads > 1})});
  await assert.rejects(publishContent({fingerprint}, deps), /changed during publishing/);
  assert.equal(calls.includes('upload'), false);
  const inputs = harness({verifyInputs: async () => { throw new Error('settings changed'); }});
  await assert.rejects(publishContent({fingerprint}, inputs.deps), /settings changed/);
  assert.equal(inputs.calls.includes('upload'), false);
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
  assert.equal(parseOptions(['--assets-only', '--local']).assetsOnly, true);
  assert.throws(() => parseOptions(['--assets-only', '--build-only']), /Choose/);
  assert.equal(parseOptions([]).unblock, false);
  assert.equal(parseOptions(['--no-strict', '--unblock']).unblock, true);
  assert.equal(parseOptions(['--local', '--unblock']).local, true);
  assert.throws(() => parseOptions(['--build-only', '--unblock']), /cannot be combined/);
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

test('publisher forwards explicit unblock confirmation to the lock before publishing', async () => {
  for (const unblock of [false, true]) {
    const {calls, deps} = harness();
    deps.withPublicationLock = async (action, options) => {
      assert.deepEqual(options, {unblock});
      calls.push('lock');
      return action();
    };
    await publishContent({fingerprint, unblock}, deps);
    assert.deepEqual(calls, ['lock', 'build', 'upload', 'checkpoint', 'record']);
  }
  const {deps} = harness({withPublicationLock: async () => { assert.fail('build-only must not acquire or unblock D1'); }});
  await publishContent({fingerprint, buildOnly: true}, deps);
});

test('subprocess arguments containing spaces and shell characters remain literal', async () => {
  const value = 'a path with spaces; $(literal) `literal` & unicode é';
  const result = await runCommand(process.execPath, ['-e', 'console.log(process.argv[1])', value]);
  assert.equal(result.stdout.trim(), value);
});

test('publisher CLI failures show a prominent error and exit unsuccessfully', async () => {
  await assert.rejects(runCommand(process.execPath, ['scripts/publish-content.mjs', '--unknown']), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /ERROR: PUBLISH COMMAND FAILED\r?\n\r?\nUnknown argument: --unknown/);
    assert.doesNotMatch(error.stdout, /Content published/);
    return true;
  });
});

test('publisher requires a complete export using the current publication policy',()=>{
  const output=path.resolve('.cache/export-fixture');
  const report={status:'ok',outputComplete:true,dynamicWebsite:true,outputPath:output,publicationPolicy:'context-v1'};
  assert.doesNotThrow(()=>validateMaterializationReport(report,output));
  for (const changes of [{status:'failed'},{outputComplete:false},{dynamicWebsite:false},{outputPath:undefined},{outputPath:output+'-other'}]) {
    assert.throws(()=>validateMaterializationReport({...report,...changes},output),/complete dynamic website export/);
  }
  for (const publicationPolicy of [undefined,'static']) {
    assert.throws(()=>validateMaterializationReport({...report,publicationPolicy},output),/reload its Obsidian plugin/);
  }
});

test('build fingerprints tolerate Windows line endings and machine paths, but notice image and publication settings', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taelgar-publish-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('taelgar-publish-test-'));
    await fs.rm(directory, {recursive: true});
  });
  const navigation = path.join(directory, 'windows-nav.md'), other = path.join(directory, 'mac-nav.md');
  await fs.writeFile(navigation, '- People\r\n');
  await fs.writeFile(other, '- People\n');
  const settings = {nav_source: navigation, default_date: '1750-01-01', campaigns: ['dufr']};
  const options = parseOptions([]);
  const value = buildFingerprint(settings, options);
  assert.equal(value, buildFingerprint({...settings, nav_source: other}, options));
  assert.equal(value, buildFingerprint({...settings, ignore_file: 'missing-legacy-ignore.txt', campaigns: ['adma']}, options));
  assert.notEqual(value, buildFingerprint(settings, {...options, maxSize: 4096}));
  assert.notEqual(value, buildFingerprint(settings, {...options, noStrict: true}));
  const decisionsDirectory=path.join(directory,'_Plugins','Name Explorer');
  await fs.mkdir(decisionsDirectory,{recursive:true});
  const decisionFile=path.join(decisionsDirectory,'Name Decisions.jsonl');
  const nameSettings={...settings,vault_dir:directory};
  const withoutDecisions=buildFingerprint(nameSettings,options);
  const record=JSON.stringify({type:'concept',subject:'Example.md',concept:'primary',language:'Common'});
  await fs.writeFile(decisionFile,record+'\r\n');
  const withDecisions=buildFingerprint(nameSettings,options);
  assert.notEqual(withoutDecisions,withDecisions);
  await fs.writeFile(decisionFile,record+'\n');
  assert.equal(withDecisions,buildFingerprint(nameSettings,options));
  const home=path.join(directory,'home.md'), otherHome=path.join(directory,'other-home.md');
  await fs.writeFile(home,'# Home\r\n');
  await fs.writeFile(otherHome,'# Home\n');
  const withHome=buildFingerprint({...settings,home_source:home},options);
  assert.notEqual(value,withHome);
  assert.equal(withHome,buildFingerprint({...settings,home_source:otherHome},options));
  await fs.writeFile(home,'# Updated home\n');
  assert.notEqual(withHome,buildFingerprint({...settings,home_source:home},options));
  await fs.writeFile(navigation,'- Updated navigation\n');
  assert.notEqual(value,buildFingerprint(settings,options));
});

test('R2 storage distinguishes missing object, legacy pointer, invalid data, and authentication failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taelgar-publish-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('taelgar-publish-test-'));
    await fs.rm(directory, {recursive: true});
  });
  const filename = path.join(directory, 'checkpoint.json');
  let response = checkpoint, failure, recorded;
  const storage = createStorage({storage:async()=>({
    getJSON:async key=>{assert.equal(key,CHECKPOINT_KEY);if(failure)throw failure;return response;},
    putPointer:async value=>{recorded=value;},
  })});
  assert.deepEqual(await storage.readCheckpoint(filename), checkpoint);
  response = {revision};assert.equal(await storage.readCheckpoint(filename), null);
  response = {revision,completedAt:'2026-10-19T12:00:00Z'};assert.equal(await storage.readCheckpoint(filename), null);
  response = {commit: state.commit};await assert.rejects(storage.readCheckpoint(filename), /Invalid R2 build checkpoint/);
  response = null;assert.equal(await storage.readCheckpoint(filename), null);
  failure = new Error('Authentication error');await assert.rejects(storage.readCheckpoint(filename), /Authentication/);
  failure = undefined;await storage.writeCheckpoint(checkpoint, filename);assert.deepEqual(recorded, checkpoint);
});

test('assets-only stages media under the lock without checkpoint, search, activation or cleanup',async()=>{
  const {deps,calls}=harness({
    readCheckpoint:async()=>assert.fail('must not skip based on active notes'),
    stageSearch:async()=>assert.fail('must not stage search'),
    verifySearch:async()=>assert.fail('must not verify search'),
    prune:async()=>assert.fail('must not prune staged media'),
    withPublicationLock:async action=>{calls.push('lock');return action();},
    upload:async(_report,options)=>{assert.deepEqual(options,{assetsOnly:true});calls.push('assets');return {uploadedAssets:1};},
  });
  const result=await publishContent({fingerprint,assetsOnly:true},deps);
  assert.equal(result.assetsOnly,true);assert.equal(result.uploadedAssets,1);
  assert.deepEqual(calls,['lock','build','assets']);
});
