import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/engine.mjs';
import {loadSettings} from '../src/config.mjs';
import {createHeaderSnapshot,renderHeader as renderCoreHeader} from '../src/header-core/index.mjs';
import {initializeHeaders,renderHeader} from '../src/headers.mjs';
import {fixtureVault} from './helpers/test-settings.mjs';
import {vaultCases} from './helpers/vault-header-fixture.mjs';

// Opt-in reads live notes and metadata, but the legacy algorithm stays frozen.
let cachedEngine;
const liveEngine=()=>cachedEngine??=new Engine(loadSettings(undefined,{liveVault:true}));
let cachedOriginal;
function originalSnapshot(){
  const engine=liveEngine();
  return cachedOriginal??=initializeHeaders({runtimeDir:fixtureVault,
    pages:engine.store.entries.filter(e=>e.note).map(e=>({path:e.id,metadata:e.note.metadata})),
    coreMeta:engine.headers.coreMeta,registry:engine.headers.registry});
}
function moduleSnapshot(engine){
  return createHeaderSnapshot({
    pages:engine.store.entries.filter(e=>e.note).map(e=>({path:e.id,metadata:e.note.metadata})),
    coreMeta:engine.headers.coreMeta,registry:engine.headers.registry,
  });
}

test('module headers match original CustomJS across representative dates and relationships',()=>{
  const engine=liveEngine(),runtime=moduleSnapshot(engine);
  for (const [page,date] of [
    ['Zahara','1730-01-20'],['Zahara','1730-02-01'],['Seeker','1748-01-01'],
    ['Melusa','1730-01-20'],['Dunmar Fellowship','1750-01-01'],['Vindristjarna','1750-01-01'],
    ['Bartoz','1715-05-31'],['Zahara','1730-01-20'],
  ]) {
    const entry = engine.store.resolve(page);
    const request = {source:entry.note.source,name:entry.name,metadata:entry.note.metadata,date};
    assert.equal(renderCoreHeader(runtime,request),renderHeader(originalSnapshot(),request),page + ' at ' + date);
  }
  assert.equal(Array.prototype.first,undefined);
  assert.equal(Array.prototype.last,undefined);
  assert.equal(String.prototype.contains,undefined);
});

test('every published vault page tagged testcase or testcase/* is represented by a frozen sample',()=>{
  const store=liveEngine().store;
  const tagged=store.entries.filter(e=>e.note&&e.note.metadata.tags?.some(tag=>/^testcase(?:\/|$)/.test(tag))).map(e=>e.id);
  assert.deepEqual(tagged,vaultCases.cases.map(c=>c.path),'Add fixtures when the vault gains a tagged test page');
});

test('current live metadata for every tagged sample still agrees with the original generator in both formats',()=>{
  const engine=liveEngine(),runtime=moduleSnapshot(engine);
  for(const example of vaultCases.cases){
    const entry=engine.store.resolve(example.path);
    for(const date of example.dates)for(const headerType of ['static','website']){
      const request={source:'---\n---\n',name:entry.name,metadata:entry.note.metadata,date,headerType};
      assert.equal(renderCoreHeader(runtime,request),renderHeader(originalSnapshot(),request),example.path+' / '+date+' / '+headerType);
    }
  }
});
