import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseNote} from '../src/content-store.mjs';
import {createHeaderSnapshot,renderHeader,renderBio} from '../src/header-core/index.mjs';
import {headerFixture as legacyHeaderFixture} from './helpers/legacy-header-fixture.mjs';
import {headerFixture,fixtureForCase} from './helpers/header-fixture.mjs';
import {renderCases} from './fixtures/header-cases.mjs';

const expected=JSON.parse(fs.readFileSync(new URL('./fixtures/header-outputs.json',import.meta.url),'utf8'));
assert.deepEqual(Object.keys(expected),renderCases.map(example=>example.id),'every output fixture must have an active test');

for(const example of renderCases)for(const headerType of ['static','website'])
  test('fixed header output: '+example.id+' / '+headerType,()=>{
    assert.equal(fixtureForCase(example).render(example.path,{headerType}),expected[example.id][headerType]);
  });

test('header blocks include one generated H1, pronunciation, dates, links and callout',()=>{
  const h=headerFixture();
  for(const headerType of ['static','website']){
    const actual=renderBio(h.runtime,{name:'Example',metadata:h.metadata('Example'),date:'1720-01-01',headerType});
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
    const rendered=h.services.OutputHandler.regenerateHeader('---\ncustom: keep\n---\n',file.name,{...file.frontmatter,version},'static').join('\n');
    assert.equal(parseNote(rendered).metadata.headerVersion,expected);
    assert.equal(parseNote(rendered).metadata.custom,'keep');
  }
});

test('repeated renders isolate dates and styles and do not mutate request or snapshot data',()=>{
  const h=headerFixture(),before=JSON.stringify(h.input),metadata=structuredClone(h.metadata('Example'));
  const request={source:'---\n---\n',name:'Example',metadata,date:'1720-01-01',headerType:'static'};
  const requestBefore=structuredClone(request),first=renderHeader(h.runtime,request);
  const later=h.render('Example',{date:'1750-01-01',headerType:'website'});
  assert.match(first,/20 years old/);assert.match(later,/died at age 40 years/);
  assert.equal(renderHeader(h.runtime,request),first);assert.deepEqual(request,requestBefore);
  assert.equal(JSON.stringify(h.input),before);assert.equal(Object.isFrozen(h.runtime.coreMeta),true);
  assert.equal(Object.isFrozen(h.metadata('Example').whereabouts),true);
});

test('indexed leadership matches the full scan for both render formats through succession boundaries',()=>{
  const h=headerFixture(),full=createHeaderSnapshot({...h.input,indexAffiliations:false});
  for(const date of ['1719-12-31','1720-01-01','1729-12-31','1730-01-01'])for(const headerType of ['static','website']){
    const request={source:'---\n---\n',name:'River Town',metadata:h.metadata('River Town'),date,headerType};
    assert.equal(renderHeader(h.runtime,request),renderHeader(full,request),date+' / '+headerType);
  }
});

test('unrecognized affiliation containers disable the optimization rather than narrowing the full scan',()=>{
  const h=headerFixture({extraNotes:{'Legacy.md':{affiliations:'Guild'}}});
  assert.equal(h.runtime.canIndexAffiliations,false);
});

test('current website output differences are explicit compatibility fixtures',()=>{
  // These are present-day differences, not promises that both presentations
  // show identical content. Any change must be reviewed as behavior work.
  assert.match(expected['event-range'].static,/lasted 12 months/);
  assert.doesNotMatch(expected['event-range'].website,/lasted|1710/);
  assert.match(expected['place-with-leader'].static,/Mayor Morgan/);
  assert.doesNotMatch(expected['place-with-leader'].website,/Mayor Morgan/);
});
