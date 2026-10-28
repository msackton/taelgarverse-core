import {testSettings} from './helpers/test-settings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeHeaders,renderHeader} from '../src/headers.mjs';
import {standardHelpers} from '../scripts/build-runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fixtureForCase} from './helpers/header-fixture.mjs';
import {renderCases} from './fixtures/header-cases.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {vaultCases,vaultOutputs,vaultHeaderFixture} from './helpers/vault-header-fixture.mjs';
import {complexNotes,complexRenderCases} from './fixtures/header-complex-cases.mjs';

test('fixed synthetic outputs independently match the original vault classes in both formats',()=>{
  const settings=testSettings();
  const expected=JSON.parse(fs.readFileSync(new URL('./fixtures/header-outputs.json',import.meta.url),'utf8'));
  for(const example of renderCases){
    const fixture=fixtureForCase(example);
    const original=initializeHeaders({...fixture.input,runtimeDir:settings.vault_dir});
    for(const headerType of ['static','website']){
      const request={source:'---\n---\n',name:path.posix.basename(example.path,'.md'),
        metadata:fixture.metadata(example.path),date:example.date,headerType};
      assert.equal(renderHeader(original,request),expected[example.id][headerType],example.id+' / '+headerType);
    }
  }
});

test('all frozen tagged samples and historical kingdoms independently match the original vault classes',()=>{
  const fixture=vaultHeaderFixture(),settings=testSettings();
  const original=initializeHeaders({...fixture.input,runtimeDir:settings.vault_dir});
  for(const example of [...vaultCases.cases,...vaultCases.relatedCases])for(const date of example.dates)for(const headerType of ['static','website']){
    const request={source:'---\n---\n',name:path.posix.basename(example.path,'.md'),
      metadata:fixture.metadata(example.path),date,headerType};
    assert.equal(renderHeader(original,request),vaultOutputs[example.path][date][headerType],example.path+' / '+date+' / '+headerType);
  }
});

test('the complex integrated history independently matches the original vault classes',()=>{
  const fixture=headerFixture({extraNotes:complexNotes}),settings=testSettings();
  const expected=JSON.parse(fs.readFileSync(new URL('./fixtures/header-complex-outputs.json',import.meta.url),'utf8'));
  const original=initializeHeaders({...fixture.input,runtimeDir:settings.vault_dir});
  for(const example of complexRenderCases)for(const headerType of ['static','website']){
    assert.equal(renderHeader(original,{source:'---\n---\n',name:path.posix.basename(example.path,'.md'),
      metadata:fixture.metadata(example.path),date:example.date,headerType}),expected[example.id][headerType],example.id+' / '+headerType);
  }
});

test('helper translation changes calls while preserving prose and regular expressions',()=>{
  const source = 'class Example { value() { const text=".first() .contains(x)"; return [1].first() + [2].last() + text.contains("x"); } }';
  const output = standardHelpers(source);
  assert.match(output,/"\.first\(\) \.contains\(x\)"/);
  assert.match(output,/\[1\]\.at\(0\)/);
  assert.match(output,/\[2\]\.at\(-1\)/);
  assert.match(output,/text\.includes\("x"\)/);
  assert.throws(()=>standardHelpers('console.log("unexpected module code")'),/Expected one CustomJS class/);
});

test('helper translation leaves comments, regex literals, computed methods and methods with arguments intact',()=>{
  const source=String.raw`class Example { value() {
    // Preserve .contains(x), .first(), and .last() in this comment.
    const pattern=/\.first\(\)\.last\(\)/;
    const a=values.first(1), b=values.last(2), c=values["first"]();
    return text.contains("x") && values.first() && values.last();
  } }`;
  const result=standardHelpers(source);
  assert.match(result,/\/\/ Preserve \.contains\(x\), \.first\(\), and \.last\(\) in this comment\./);
  assert.ok(result.includes(String.raw`/\.first\(\)\.last\(\)/`));
  assert.ok(result.includes('values.first(1), b=values.last(2), c=values["first"]()'));
  assert.ok(result.includes('text.includes("x") && values.at(0) && values.at(-1)'));
});
