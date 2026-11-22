import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {testSettings} from './helpers/test-settings.mjs';
import {initializeHeaders,renderHeader} from './helpers/legacy-headers/vm.mjs';
import {complexNotes,complexRenderCases} from './fixtures/header-complex-cases.mjs';
import fs from 'node:fs';
import {parseNote} from '../src/content-store.mjs';
import {renderFullHeader,renderSavedHeader} from './helpers/full-header-rendering.mjs';
import {headerFixture as legacyHeaderFixture} from './helpers/legacy-header-fixture.mjs';
import {headerFixture,fixtureForCase} from './helpers/header-fixture.mjs';
import {renderCases} from './fixtures/header-cases.mjs';

const expected=JSON.parse(fs.readFileSync(new URL('./fixtures/header-outputs.json',import.meta.url),'utf8'));
assert.deepEqual(Object.keys(expected),renderCases.map(example=>example.id),'every output fixture must have an active test');

for(const example of renderCases)for(const headerType of ['static','website'])
  test('fixed header output: '+example.id+' / '+headerType,()=>{
    assert.equal(fixtureForCase(example).render(example.path,{headerType}),expected[example.id][headerType]);
  });

test('historical full headers include one generated H1, pronunciation, dates, links and callout',()=>{
  const h=headerFixture();
  for(const headerType of ['static','website']){
    const actual=renderFullHeader(h.runtime,{name:'Example',metadata:h.metadata('Example'),date:'1720-01-01',headerType});
    assert.equal(actual,parseNote(h.render('Example',{headerType})).body);
    assert.equal((actual.match(/^# /gm)||[]).length,1);assert.match(actual,/EG-zam-pul/);
    assert.match(actual,/20 years old/);assert.match(actual,/\[\[Old County\]\]/);
    assert.match(actual,headerType==='static'?/\[!info\]/:/Biographical Information/);
  }
});

test('saved-header replacement preserves custom frontmatter, authored headings and literal code examples',()=>{
  const h=headerFixture();
  const body='## Authored section\n\nBiography.\n\n# Body H1\n\n```markdown\n# Literal example\n```\n';
  const source='---\nheaderVersion: legacy\ncustom: keep\n---\n# Saved title\n> Stale details\n\n'+body;
  for(const headerType of ['static','website']){
    const output=h.render('Example',{source,headerType}),parsed=parseNote(output);
    assert.equal(parsed.metadata.headerVersion,'2023.11.25');assert.equal(parsed.metadata.custom,'keep');
    assert.doesNotMatch(output,/Saved title|Stale details/);assert.ok(output.endsWith(body));
    assert.equal((parsed.body.match(/^# Example$/gm)||[]).length,1);
  }
});

test('omitting the generated title preserves every remaining header detail',()=>{
  const h=headerFixture();
  for(const headerType of ['static','website']){
    const request={name:'Example',metadata:h.metadata('Example'),date:'1720-01-01',headerType};
    const complete=renderFullHeader(h.runtime,request);
    assert.equal(renderFullHeader(h.runtime,{...request,includeTitle:false}),complete.slice(complete.indexOf('\n')+1));
  }
});

test('notes with no saved header keep their first authored paragraph',()=>{
  const h=headerFixture(),source='---\ncustom: keep\n---\nOpening paragraph.\n\n## Details\n\nArticle.\n';
  const output=h.render('Example',{source});
  assert.ok(output.endsWith('Opening paragraph.\n\n## Details\n\nArticle.\n'));
  assert.equal(parseNote(output).metadata.custom,'keep');
});

test('the legacy dynamic generator emits Dataview references while static bios fill their values',()=>{
  const h=legacyHeaderFixture(),file=h.file('Example');
  const dynamic=h.services.OutputHandler.generateHeader(file.name,file.frontmatter,true);
  for(const view of ['get_PageDatedValue','get_Whereabouts'])assert.match(dynamic,new RegExp(view));
  assert.match(dynamic,/\$=dv\.view/);assert.doesNotMatch(h.render('Example',{headerType:'static'}),/\$=|dv\.view/);
});

test('legacy old/next version selectors preserve custom YAML while selecting the header marker',()=>{
  const h=headerFixture(),file=h.file('Example');
  for(const [version,expected] of [['old','legacy'],['next','2023.11.25']]){
    const rendered=renderSavedHeader(h.runtime,{source:'---\ncustom: keep\n---\n',name:file.name,
      metadata:{...file.frontmatter,version},date:'1720-01-01',headerType:'static'});
    assert.equal(parseNote(rendered).metadata.headerVersion,expected);
    assert.equal(parseNote(rendered).metadata.custom,'keep');
  }
});

test('historical website output differences are explicit compatibility fixtures',()=>{
  assert.match(expected['event-range'].static,/lasted 12 months/);
  assert.doesNotMatch(expected['event-range'].website,/lasted|1710/);
  assert.match(expected['place-with-leader'].static,/Mayor Morgan/);
  assert.doesNotMatch(expected['place-with-leader'].website,/Mayor Morgan/);
});

test('fixed synthetic outputs independently match the original vault classes in both formats',()=>{
  const settings=testSettings();
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

test('the complex integrated history independently matches the original vault classes',()=>{
  const fixture=headerFixture({extraNotes:complexNotes}),settings=testSettings();
  const expected=JSON.parse(fs.readFileSync(new URL('./fixtures/header-complex-outputs.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(expected),complexRenderCases.map(c=>c.id));
  const original=initializeHeaders({...fixture.input,runtimeDir:settings.vault_dir});
  for(const example of complexRenderCases)for(const headerType of ['static','website']){
    const request={source:'---\n---\n',name:path.posix.basename(example.path,'.md'),
      metadata:fixture.metadata(example.path),date:example.date,headerType};
    const saved=expected[example.id][headerType],label=example.id+' / '+headerType;
    assert.equal(renderHeader(original,request),saved,label);
    assert.equal(renderSavedHeader(fixture.runtime,request),saved,label);
  }
});
