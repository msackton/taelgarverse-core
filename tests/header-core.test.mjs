import {testSettings} from './helpers/test-settings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';
import {ROOT} from '../src/config.mjs';
import {Engine} from '../src/engine.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {synthesizedNotes,synthesizedExamples} from './fixtures/header-synthesized-cases.mjs';

test('the maintained core bundles and renders in a browser environment without host globals or Node modules',async()=>{
  const result=await build({entryPoints:[path.join(ROOT,'src/header-core/index.mjs')],bundle:true,
    platform:'browser',format:'cjs',target:'es2022',write:false,metafile:true,logLevel:'silent'});
  assert.ok(Object.keys(result.metafile.inputs).every(file=>!/(?:worker-headers|header-runtime|\/headers)\.mjs$/.test(file)));
  const module={exports:{}};
  const sandbox={module,exports:module.exports,structuredClone};
  vm.runInNewContext(result.outputFiles[0].text,sandbox);
  const {createHeaderSnapshot,renderBio}=module.exports;
  const h=headerFixture({baseNotes:synthesizedNotes});
  const snapshot=createHeaderSnapshot(h.input);
  for(const example of synthesizedExamples){
    const text=renderBio(snapshot,{name:path.posix.basename(example.path,'.md'),metadata:h.metadata(example.path),date:example.date});
    assert.doesNotMatch(text,/undefined|NaN|\[object Object\]/,example.id);
    assert.equal((text.match(/^# /gm)||[]).length,1,example.id);
  }
  assert.equal(sandbox.customJS,undefined);assert.equal(sandbox.app,undefined);
  assert.equal(sandbox.DataviewAPI,undefined);assert.equal(sandbox.require,undefined);
});

test('Node renders a vault that has metadata and campaign JSON but no legacy CustomJS directory',()=>{
  const directory=fs.mkdtempSync(path.join(ROOT,'.cache/header-core-vault-'));
  try{
    fs.mkdirSync(path.join(directory,'.obsidian'));
    fs.mkdirSync(path.join(directory,'_scripts'));
    const {input}=headerFixture();
    fs.writeFileSync(path.join(directory,'.obsidian/metadata.json'),JSON.stringify(input.coreMeta));
    fs.writeFileSync(path.join(directory,'_scripts/session_note_campaigns.json'),JSON.stringify(input.registry));
    fs.writeFileSync(path.join(directory,'Person.md'),'---\ntags: [person]\nborn: 1700-01-01\n---\n> [!taelgar-header]\n\nAuthored biography.');
    const engine=new Engine({...testSettings(),vault_dir:directory,source_dir:directory,home_source:null,nav_source:null});
    const page=engine.render('Person','1720-01-01');
    assert.match(page.html,/20 years old/);assert.match(page.html,/Authored biography/);
    assert.equal(fs.existsSync(path.join(directory,'_scripts/customJS')),false);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
