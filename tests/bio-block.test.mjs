import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {Engine} from '../src/engine.mjs';
import {ROOT,loadSettings} from '../src/config.mjs';
import {parseNote,authoredBody} from '../src/content-store.mjs';
import {loadSnapshot} from '../src/snapshot.mjs';
import {leadingBioBlock} from '../src/bio-block.mjs';

let engine,directory,worker;
before(async()=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  directory=fs.mkdtempSync(path.join(ROOT,'.cache','bio-test-'));
  const notes={...JSON.parse(fs.readFileSync(new URL('./fixtures/notes.json',import.meta.url))),
    ...JSON.parse(fs.readFileSync(new URL('./fixtures/bio-blocks.json',import.meta.url)))};
  notes['Exported Bio.md']=notes['Bio Person.md'].replace('```taelgar-header','<!-- taelgar:header -->\n\n```taelgar-header');
  notes['Titled Bio.md']=notes['Bio Person.md'].replace('```taelgar-header','# Stale saved title\n```taelgar-header');
  notes['Legacy Marker.md']=notes['Bio Person.md'].replace('```taelgar-header\n```','<!-- taelgar:header -->');
  notes['Host.md']='![[Bio Person]]';
  notes['Loop Person.md']='---\ntags: [person]\nwhereabouts: Loop Chest A\n---\n```taelgar-header\n```\n';
  notes['Loop Chest A.md']='---\ntags: [object]\nwhereabouts: Loop Chest B\n---\n';
  notes['Loop Chest B.md']='---\ntags: [object]\nwhereabouts: Loop Chest A\n---\n';
  notes['Loop Group A.md']='---\ntags: [group]\npartOf: Loop Group B\ndisplayDefaults: {boxInfo: "<partof>"}\n---\n```taelgar-header\n```\n';
  notes['Loop Group B.md']='---\ntags: [group]\npartOf: Loop Group A\n---\n';
  for(const [name,source] of Object.entries(notes)){
    const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);
  }
  engine=new Engine({...loadSettings(),source_dir:directory,nav_source:null,home_source:null});
  const revision='a'.repeat(64),shard={},entries=engine.store.entries.map(({filename,note,...entry})=>{
    if(!note)return entry;shard[entry.id]=note.source;
    return {...entry,note:{metadata:note.metadata,shard:'00',sha256:createHash('sha256').update(note.source).digest('hex')}};
  });
  const index={schemaVersion:1,revision,settings:engine.settings,registry:engine.headers.registry,coreMeta:engine.headers.coreMeta,entries,warnings:[]};
  worker=await loadSnapshot({get:async key=>({json:async()=>key.endsWith('/index.json')?index:shard})},revision);
});
after(()=>{if(directory)fs.rmSync(directory,{recursive:true});});

test('person, place and event bio blocks use the existing header output and preserve authored bodies in Node and Worker',async()=>{
  for(const page of ['Bio Person','Bio Place','Bio Event','Exported Bio','Titled Bio','Legacy Marker'])for(const date of ['1720-01-01','1730-01-01']){
    const actual=engine.render(page,date),entry=engine.store.resolve(page);
    const header=parseNote(engine.renderHeader(engine.headers,{source:'---\n---\n',name:entry.name,metadata:entry.note.metadata,date})).body;
    const expectedBody=header;
    const expected=engine.renderBody(expectedBody+'\n\n'+authoredBody(entry.note),entry,actual.context);
    assert.equal(actual.html,expected.html,page+' at '+date);
    const remote=await worker.engine.renderAsync(page,date,undefined,false,undefined,e=>worker.store.getNote(e));
    assert.equal(remote.html,actual.html);
    assert.equal(load(actual.html)('h1').length,1);
    assert.equal(load(actual.html)('h2').length,1);
    assert.doesNotMatch(actual.html,/language-taelgar|taelgar-header|Dynamic value unavailable/);
  }
  assert.notEqual(engine.render('Bio Person','1720-01-01').html,engine.render('Bio Person','1730-01-01').html);
  assert.match(engine.render('Bio Person','1730-01-01').html,/BY-oh/);
});

test('bio blocks are omitted from note embeds, authored search text and backlinks',()=>{
  const html=engine.render('Host','1730-01-01').html;
  assert.match(html,/An authored biography/);assert.doesNotMatch(html,/BY-oh|taelgar-header|Biographical Info/);
  const note=engine.store.resolve('Bio Person').note;
  assert.equal(authoredBody(note),'\n## Biography\n\nAn authored biography with [[First Town]].\n');
});

for(const [page,kind] of [['Loop Person','location'],['Loop Group A','organization']])
  test('circular '+kind+' metadata produces a clear 422 header error in Node and Worker',async()=>{
    const expected={status:422,message:'Header generation failed: circular '+kind+' chain.'};
    assert.throws(()=>engine.render(page,'1720-01-01'),expected);
    await assert.rejects(worker.engine.renderAsync(page,'1720-01-01',undefined,false,undefined,e=>worker.store.getNote(e)),expected);
  });

test('only a leading, closed, empty header fence is rendered; examples stay literal',()=>{
  assert.equal(leadingBioBlock('````markdown\n```taelgar-header\n```\n````'),null);
  assert.equal(leadingBioBlock('Paragraph.\n\n```taelgar-header\n```'),null);
  assert.equal(leadingBioBlock('    ```taelgar-header\n    ```'),null);
  assert.match(leadingBioBlock('```taelgar-header\n').error,/Close/);
  assert.match(leadingBioBlock('```taelgar-header\nanything\n```').error,/empty/);
  assert.equal(leadingBioBlock('~~~taelgar-header\r\n\r\n~~~~\r\nBody').error,null);
});
