import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/engine.mjs';
import {loadSettings} from '../src/config.mjs';
import {initializeHeaderRuntime,renderModuleHeader} from '../src/header-runtime.mjs';
import {renderHeader} from '../src/headers.mjs';
import {instantiate} from '../.generated/headers.mjs';
import {standardHelpers} from '../scripts/build-runtime.mjs';

test('module headers match original CustomJS across representative dates and relationships',()=>{
  const engine = new Engine(loadSettings());
  const runtime = initializeHeaderRuntime({
    pages:engine.store.entries.filter(e=>e.note).map(e=>({path:e.id,metadata:e.note.metadata})),
    coreMeta:engine.headers.coreMeta,registry:engine.headers.registry,
  },instantiate);
  for (const [page,date] of [
    ['Zahara','1730-01-20'],['Zahara','1730-02-01'],['Seeker','1748-01-01'],
    ['Melusa','1730-01-20'],['Dunmar Fellowship','1750-01-01'],['Vindristjarna','1750-01-01'],
    ['Bartoz','1715-05-31'],['Zahara','1730-01-20'],
  ]) {
    const entry = engine.store.resolve(page);
    const request = {source:entry.note.source,name:entry.name,metadata:entry.note.metadata,date};
    assert.equal(renderModuleHeader(runtime,request),renderHeader(engine.headers,request),page + ' at ' + date);
  }
  assert.equal(Array.prototype.first,undefined);
  assert.equal(Array.prototype.last,undefined);
  assert.equal(String.prototype.contains,undefined);
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
