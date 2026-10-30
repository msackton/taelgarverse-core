import {testSettings} from './helpers/test-settings.mjs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {Engine} from '../src/engine.mjs';
import {ROOT} from '../src/config.mjs';
import {parseNote,authoredBody} from '../src/content-store.mjs';
import {loadSnapshot} from '../src/snapshot.mjs';
import {scanHeaderCallouts} from '../src/header-callout.mjs';
import {renderHeaderCallout} from '../src/header-core/index.mjs';

let engine,directory,worker;
before(async()=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  directory=fs.mkdtempSync(path.join(ROOT,'.cache','bio-test-'));
  const notes={...JSON.parse(fs.readFileSync(new URL('./fixtures/notes.json',import.meta.url))),
    ...JSON.parse(fs.readFileSync(new URL('./fixtures/bio-blocks.json',import.meta.url)))};
  notes['Host.md']='![[Bio Person]]';
  notes['Source Header.md']=notes['Bio Person.md'].replace('tags: [person]','tags: [person, source]');
  notes['Loop Person.md']='---\ntags: [person]\nwhereabouts: Loop Chest A\n---\n> [!taelgar-header]\n';
  notes['Loop Chest A.md']='---\ntags: [object]\nwhereabouts: Loop Chest B\n---\n';
  notes['Loop Chest B.md']='---\ntags: [object]\nwhereabouts: Loop Chest A\n---\n';
  notes['Loop Group A.md']='---\ntags: [group]\npartOf: Loop Group B\ndisplayDefaults: {boxInfo: "<partof>"}\n---\n> [!taelgar-header]\n';
  notes['Loop Group B.md']='---\ntags: [group]\npartOf: Loop Group A\n---\n';
  for(const [name,source] of Object.entries(notes)){
    const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);
  }
  engine=new Engine({...testSettings(),source_dir:directory,nav_source:null,home_source:null});
  const revision='a'.repeat(64),shard={},entries=engine.store.entries.map(({filename,note,...entry})=>{
    if(!note)return entry;shard[entry.id]=note.source;
    return {...entry,note:{metadata:note.metadata,shard:'00',sha256:createHash('sha256').update(note.source).digest('hex')}};
  });
  const index={schemaVersion:1,revision,settings:engine.settings,registry:engine.headers.registry,coreMeta:engine.headers.coreMeta,entries,warnings:[]};
  worker=await loadSnapshot({get:async key=>({json:async()=>key.endsWith('/index.json')?index:shard})},revision);
});
after(()=>{if(directory)fs.rmSync(directory,{recursive:true});});

test('callouts generate website information in place while preserving authored titles and pronunciation in Node and Worker',async()=>{
  for(const page of ['Bio Person','Bio Place','Bio Event','Source Header'])for(const date of ['1720-01-01','1730-01-01']) {
    const actual=engine.render(page,date),entry=engine.store.resolve(page),source=entry.note.body;
    const [callout]=scanHeaderCallouts(source);
    const generated=renderHeaderCallout(engine.headers,{name:entry.name,metadata:entry.note.metadata,date,mode:'website'}).trimEnd();
    const expected=engine.renderBody(source.slice(0,callout.start)+generated+'\n\n'+source.slice(callout.end),entry,actual.context);
    assert.equal(actual.html,expected.html);
    const remote=await worker.engine.renderAsync(page,date,undefined,false,undefined,e=>worker.store.getNote(e));
    assert.equal(remote.html,actual.html);assert.equal(load(actual.html)('h1').length,1);
    assert.doesNotMatch(actual.html,/Stale fallback|Fallback Only|language-taelgar|Dynamic value unavailable/);
  }
  assert.notEqual(engine.render('Bio Person','1720-01-01').html,engine.render('Bio Person','1730-01-01').html);
  assert.equal((engine.render('Bio Person').html.match(/BY-oh/g)||[]).length,1);
});

test('only generated callouts are omitted from embeds, search text and backlinks; surrounding text remains authored',()=>{
  const html=engine.render('Host','1730-01-01').html;
  assert.match(html,/An authored biography|BY-oh/);assert.doesNotMatch(html,/Fallback Only|taelgar-header|Biographical Info/);
  const note=engine.store.resolve('Bio Person').note;
  assert.match(authoredBody(note),/# Bio Person\n\*\(BY-oh\)\*/);assert.doesNotMatch(authoredBody(note),/Fallback Only/);
});

for(const [page,kind] of [['Loop Person','location'],['Loop Group A','organization']])
  test('circular '+kind+' metadata produces a clear 422 header error in Node and Worker',async()=>{
    const expected={status:422,message:'Header generation failed: circular '+kind+' chain.'};
    assert.throws(()=>engine.render(page,'1720-01-01'),expected);
    await assert.rejects(worker.engine.renderAsync(page,'1720-01-01',undefined,false,undefined,e=>worker.store.getNote(e)),expected);
  });

test('callout scanning uses Markdown boundaries, supports CRLF and fallback, and excludes legacy and nested syntax',()=>{
  const source='# Name\r\n*(Pronunciation)*\r\n\r\n> [!Taelgar-Header]+ Saved label\r\n> Fallback\r\n> > nested info\r\n\r\nBody.\r\n';
  const [callout]=scanHeaderCallouts(source);
  assert.equal(source.slice(callout.start,callout.end),'> [!Taelgar-Header]+ Saved label\r\n> Fallback\r\n> > nested info\r\n');
  assert.equal(callout.startLine,3);
  for(const example of ['```taelgar-header\n```','<!-- taelgar:header -->','    > [!taelgar-header]\n','> > [!taelgar-header]\n',
    '- item\n  > [!taelgar-header]\n','````markdown\n> [!taelgar-header]\n````'])assert.deepEqual(scanHeaderCallouts(example),[],example);
  assert.equal(scanHeaderCallouts('Intro.\n\n> [!taelgar-header]\n\nMiddle.\n\n> [!taelgar-header]\n').length,2);
});
