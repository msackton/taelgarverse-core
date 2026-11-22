import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {initializeHeaders,renderHeader} from '../src/headers.mjs';
import {testSettings} from './helpers/test-settings.mjs';
import fs from 'node:fs';
import {parseNote} from '../src/content-store.mjs';
import {vaultCases,vaultHeaderFixture,vaultCasePath} from './helpers/vault-header-fixture.mjs';
import {renderFullHeader} from './helpers/full-header-rendering.mjs';

const vaultOutputs=JSON.parse(fs.readFileSync(new URL('./fixtures/header-vault-outputs.json',import.meta.url),'utf8'));
const fixture=vaultHeaderFixture();
const isTestCase=metadata=>(metadata.tags??[]).some(tag=>/^testcase(?:\/|$)/.test(tag));
const daysInMonth=[31,28,31,30,31,30,31,31,30,31,30,31];
function adjacent(date,offset){
  let [year,month,day]=date.split('-').map(Number);day+=offset;
  if(day===0){if(--month===0){--year;month=12;}day=daysInMonth[month-1];}
  if(day>daysInMonth[month-1]){day=1;if(++month===13){++year;month=1;}}
  return [year,month,day].map((n,i)=>String(n).padStart(i?2:4,'0')).join('-');
}

test('all frozen testcase tags, including child tags, have exactly one active output matrix',()=>{
  const paths=vaultCases.cases.map(c=>c.path);
  assert.equal(paths.length,21);
  assert.equal(new Set(paths).size,paths.length);
  assert.deepEqual(paths,vaultCases.pages.filter(p=>isTestCase(p.metadata)).map(p=>p.path));
  assert.deepEqual(Object.keys(vaultOutputs),[...paths,...vaultCases.relatedCases.map(c=>c.path)]);
  assert.ok(fixture.metadata(vaultCasePath('Akan')).tags.includes('testcase/with-whereabouts'));
});

for(const example of vaultCases.cases){
  const name=example.path.split('/').at(-1);
  test('all recorded transitions have before/on/after expectations: '+name,()=>{
    assert.deepEqual(Object.keys(vaultOutputs[example.path]),example.dates);
    for(const boundary of example.boundaries){
      const d=fixture.services.DateManager;
      assert.equal(d.normalizeDate(boundary.value,boundary.isEnd).days,d.normalizeDate(boundary.date).days,boundary.field);
      for(const offset of [-1,0,1])assert.ok(example.dates.includes(adjacent(boundary.date,offset)),boundary.field+' / '+offset);
    }
  });
}

for(const example of [...vaultCases.cases,...vaultCases.relatedCases]){
  const name=path.posix.basename(example.path,'.md');
  for(const date of example.dates)for(const headerType of ['static','website']){
    test('saved vault header: '+name+' / '+date+' / '+headerType,()=>{
      const expected=vaultOutputs[example.path][date][headerType];
      assert.equal(fixture.render(example.path,{date,headerType}),expected);
      const body=renderFullHeader(fixture.runtime,{name,metadata:fixture.metadata(example.path),date,headerType});
      assert.equal(body,parseNote(expected).body);
    });
  }
}

test('all tagged samples render one title and their complete historical header details',()=>{
  for(const example of vaultCases.cases)for(const headerType of ['static','website']){
    const body=parseNote(fixture.render(example.path,{headerType})).body;
    assert.match(body,/^# /);
    const actual=renderFullHeader(fixture.runtime,{name:example.path.split('/').at(-1).replace(/\.md$/,''),
      metadata:fixture.metadata(example.path),date:'1752-01-01',headerType});
    assert.equal(actual,body);
    assert.equal((actual.match(/^# /gm)||[]).length,1,example.path);
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
