import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadSettings} from '../src/config.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taelgar-config-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('taelgar-config-test-'));
    fs.rmSync(directory, {recursive: true});
  });
  const root = path.join(directory, 'core'), vault = path.join(directory, 'vault');
  fs.mkdirSync(root);
  const createVault = directory => {
    fs.mkdirSync(path.join(directory, '_website'), {recursive: true});
    fs.writeFileSync(path.join(directory, '_website', 'navigation.md'), '- People\n');
    fs.writeFileSync(path.join(directory, '_website', 'home.md'), '# Welcome\n');
  };
  createVault(vault);
  const write = (filename, value) => {
    const target = path.resolve(root, filename);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, JSON.stringify(value));
    return target;
  };
  write('config.json', {vault_dir: '../vault', default_date: '1750-01-01'});
  return {root, vault: fs.realpathSync(vault), write, createVault,
    load: (filename, env = {}, options = {}) => loadSettings(filename, {root, env, ...options})};
}

test('shared settings work without a local file and use paths relative to config.json', t => {
  const {root, vault, load} = fixture(t);
  const settings = load();
  assert.equal(settings.source_dir, vault);
  assert.equal(settings.vault_dir, vault);
  assert.equal(settings.nav_source, fs.realpathSync(path.join(vault, '_website', 'navigation.md')));
  assert.equal(settings.home_source, fs.realpathSync(path.join(vault, '_website', 'home.md')));
  assert.equal(settings.default_date, '1750-01-01');
});

test('plugin installation needs only a vault directory, and quick preview ignores an unavailable old export',t=>{
  const {root,vault,write,load}=fixture(t);
  const testVault=path.join(root,'empty-test-vault');fs.mkdirSync(testVault);
  write('config.local.json',{source_dir:'missing-export'});
  assert.equal(load(undefined,{}, {vault:testVault,vaultOnly:true}).vault_dir,fs.realpathSync(testVault));
  assert.equal(load(undefined,{}, {liveVault:true}).source_dir,vault);
  assert.throws(()=>load(),/ENOENT/);
});

test('local settings load automatically and only need the values being changed', t => {
  const {vault, write, load} = fixture(t);
  write('config.local.json', {default_date: '1740-02-01', nav_source: null});
  const settings = load();
  assert.equal(settings.default_date, '1740-02-01');
  assert.equal(settings.nav_source, null);
  assert.equal(settings.source_dir, vault);
  assert.equal(settings.vault_dir, vault);
});

test('explicit selection beats the environment, and either bypasses local settings', t => {
  const {root, vault, write, load} = fixture(t);
  write('config.local.json', {default_date: '1700-01-01', nav_source: null});
  const environment = write('environment.json', {default_date: '1710-01-01'});
  const explicit = write('explicit.json', {default_date: '1720-01-01'});
  const env = {TAELGARVERSE_CONFIG: environment};
  assert.equal(load(undefined, env).default_date, '1710-01-01');
  assert.equal(load(explicit, env).default_date, '1720-01-01');
  assert.equal(load(explicit, env).nav_source, fs.realpathSync(path.join(vault, '_website', 'navigation.md')));
  assert.equal(load(undefined, env).nav_source, fs.realpathSync(path.join(vault, '_website', 'navigation.md')));
  assert.equal(load(path.join(root, 'config.json'), env).default_date, '1750-01-01');
});

test('alternate files resolve their own paths without rebasing inherited paths', t => {
  const {root, vault, write, load} = fixture(t);
  const exported = path.join(root, 'previews', 'export');
  fs.mkdirSync(exported, {recursive: true});
  const selected = write('previews/settings.json', {source_dir: 'export'});
  const settings = load(selected);
  assert.equal(settings.source_dir, fs.realpathSync(exported));
  assert.equal(settings.vault_dir, vault);
  assert.equal(settings.nav_source, fs.realpathSync(path.join(vault, '_website', 'navigation.md')));
  fs.writeFileSync(path.join(root, 'previews', 'menu.md'), '- Places\n');
  write('previews/settings.json', {source_dir: 'export', nav_source: 'menu.md'});
  assert.equal(load(selected).nav_source, fs.realpathSync(path.join(root, 'previews', 'menu.md')));
});

test('paths replaced by a local file do not need to exist in the defaults', t => {
  const {root, vault, write, load} = fixture(t);
  write('config.json', {vault_dir: '../missing', nav_source: 'missing.md', default_date: '1750-01-01'});
  write('config.local.json', {vault_dir: '../vault', nav_source: null});
  assert.equal(load().source_dir, vault);
  assert.equal(load().vault_dir, vault);
  assert.equal(load().nav_source, null);
  assert.throws(() => load(path.join(root, 'config.json')), /ENOENT/);
});

test('missing or invalid selected settings fail instead of silently using defaults', t => {
  const {root, write, load} = fixture(t);
  assert.throws(() => load(path.join(root, 'missing.json')), /Cannot read settings.*missing\.json/);
  for (const value of [null, [], 'text']) {
    write('config.local.json', value);
    assert.throws(() => load(), /must be a JSON object/);
  }
  fs.writeFileSync(path.join(root, 'config.local.json'), '{broken');
  assert.throws(() => load(), /Cannot read settings.*config\.local\.json/);
  const good = write('valid.json', {default_date: '1740-01-01'});
  assert.equal(load(good).default_date, '1740-01-01');
  for (const value of [{vault_dir: ''}, {vault_dir: null}, {source_dir: ''}, {runtime_dir: 123}, {nav_source: false}, {home_source: false}]) {
    write('config.local.json', value);
    assert.throws(() => load(), /must be a nonempty path/);
  }
  write('config.local.json', {default_date: '1750-02-30'});
  assert.throws(() => load(), /valid Taelgar DR date/);
});

test('setting vault_dir once changes content, supporting data, navigation and homepage', t => {
  const {root, write, load, createVault} = fixture(t);
  const otherVault = path.join(root, 'other-vault');
  createVault(otherVault);
  write('config.local.json', {vault_dir: 'other-vault'});
  const settings = load();
  assert.equal(settings.vault_dir, fs.realpathSync(otherVault));
  assert.equal(settings.source_dir, settings.vault_dir);
  assert.equal(settings.nav_source, fs.realpathSync(path.join(otherVault, '_website', 'navigation.md')));
  assert.equal(settings.home_source, fs.realpathSync(path.join(otherVault, '_website', 'home.md')));
  assert.equal(Object.hasOwn(settings, 'runtime_dir'), false);
});

test('null source_dir returns to the selected vault instead of an inherited export folder', t => {
  const {vault, write, load} = fixture(t);
  write('config.json', {vault_dir: '../vault', source_dir: 'old-export', nav_source: null, default_date: '1750-01-01'});
  write('config.local.json', {source_dir: null});
  assert.equal(load().source_dir, vault);
});

test('the publisher vault option wins before validating a missing configured vault', t => {
  const {vault, write, load} = fixture(t);
  write('config.local.json', {vault_dir: '../missing-vault'});
  const settings = load(undefined, {}, {vault});
  assert.equal(settings.vault_dir, vault);
  assert.equal(settings.source_dir, vault);
});

test('old runtime_dir settings remain usable without exposing two vault names', t => {
  const {root, write, load, createVault} = fixture(t);
  const legacyVault = path.join(root, 'legacy-vault');
  createVault(legacyVault);
  write('config.local.json', {runtime_dir: 'legacy-vault'});
  assert.equal(load().vault_dir, fs.realpathSync(legacyVault));
  assert.equal(load().source_dir, fs.realpathSync(legacyVault));
  assert.equal(Object.hasOwn(load(), 'runtime_dir'), false);
  write('config.local.json', {vault_dir: 'legacy-vault', runtime_dir: 'legacy-vault'});
  assert.equal(load().vault_dir, fs.realpathSync(legacyVault));
  write('config.local.json', {vault_dir: '../vault', runtime_dir: 'legacy-vault'});
  assert.throws(() => load(), /Use only vault_dir.*different vault/);
});

test('website source overrides are relative to their file, and null explicitly disables them', t => {
  const {root, vault, write, load} = fixture(t);
  const selected = write('preview/config.json', {home_source:'welcome.md'});
  fs.writeFileSync(path.join(root, 'preview', 'welcome.md'), '# Other home\n');
  assert.equal(load(selected).home_source, fs.realpathSync(path.join(root, 'preview', 'welcome.md')));
  fs.unlinkSync(path.join(vault, '_website', 'home.md'));
  assert.throws(() => load(), /ENOENT/);
  write('config.local.json', {home_source:null,nav_source:null});
  assert.equal(load().home_source, null);
  assert.equal(load().nav_source, null);
});

test('POV date restrictions default off and accept only a boolean site setting',t=>{
  const {write,load}=fixture(t);
  assert.equal(load().respect_pov_dates,false);
  for (const respect_pov_dates of [true,false]) {
    write('config.local.json',{respect_pov_dates});
    assert.equal(load().respect_pov_dates,respect_pov_dates);
  }
  for (const respect_pov_dates of ['true','false',1,0,null,[],{}]) {
    write('config.local.json',{respect_pov_dates});
    assert.throws(()=>load(),/respect_pov_dates must be a boolean/);
  }
});
