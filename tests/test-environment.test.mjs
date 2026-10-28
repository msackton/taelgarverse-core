import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {selectTests} from '../scripts/test.mjs';
import {fixtureVault,testSettings} from './helpers/test-settings.mjs';

test('default and emulator suites cannot accidentally select live-vault checks',()=>{
  const files=['z.test.mjs','headers.live-vault.mjs','a.test.mjs','dataview.live-vault.mjs','search.integration.mjs'];
  assert.deepEqual(selectTests(files),['a.test.mjs','z.test.mjs']);
  assert.deepEqual(selectTests(files,['--integration']),['search.integration.mjs']);
  assert.deepEqual(selectTests(files,['--live-vault']),['dataview.live-vault.mjs','headers.live-vault.mjs']);
  for(const args of [['--unknown'],['--integration','--live-vault']])assert.throws(()=>selectTests(files,args),/Use npm test/);
});

test('test settings resolve frozen inputs even when the user config is unavailable',()=>{
  const previous=process.env.TAELGARVERSE_CONFIG;
  try{
    process.env.TAELGARVERSE_CONFIG=path.join(fixtureVault,'must-not-read-this-config.json');
    const settings=testSettings();
    assert.equal(settings.vault_dir,fs.realpathSync(fixtureVault));
    assert.equal(settings.source_dir,fs.realpathSync(fixtureVault));
    assert.equal(settings.home_source,null);assert.equal(settings.nav_source,null);
  }finally{
    if(previous===undefined)delete process.env.TAELGARVERSE_CONFIG;else process.env.TAELGARVERSE_CONFIG=previous;
  }
});

test('legacy reference files match their reviewed frozen-source manifest',()=>{
  const provenance=JSON.parse(fs.readFileSync(path.join(fixtureVault,'source.json'),'utf8'));
  assert.equal(provenance.repository,'tsackton/taelgar');
  assert.match(provenance.commit,/^[a-f0-9]{40}$/);
  assert.equal(provenance.files.length,11);
  for(const file of provenance.files){
    const content=fs.readFileSync(path.join(fixtureVault,file.path),'utf8').replace(/\r\n?/g,'\n');
    assert.equal(createHash('sha256').update(content).digest('hex'),file.sha256,file.path);
  }
});
