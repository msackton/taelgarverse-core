import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {Store,parseNote} from '../src/store.mjs';
import {cleanupPublicationNote,cleanupPublicationStore} from '../src/publication-markdown.mjs';
import {filterComments} from '../src/comments.mjs';
import {copyWorkingVault,saveWorkingNotes} from '../scripts/website-working-vault.mjs';
import {materializeWebsiteDataview} from '../scripts/materialize-website-dataview.mjs';

test('Node preserves headers and cleans JavaScript-only headings while preserving prose, examples and conditional delimiters',()=>{
  const source=['---','headerVersion: 2023.11.25','tags: [person]','---','# Old title','>[!info] Old info','',
    '## Remove parent','%%^Campaign:dufr%%','### Remove child','```dataviewjs','throw new Error("Never execute");','```','%%^End%%','',
    '## Retain prose','Keep this prose.','~~~dataviewjs','dv.paragraph("Remove only code");','~~~','',
    'Setext section','--------------','```dataviewjs','dv.list([]);','```','',
    '## Existing empty heading','',
    '````markdown','```dataviewjs','This example remains.','```','````','',
    '> [!info] Query','> ```dataview','> LIST FROM #person','> ```',''].join('\n');
  const note=parseNote(source),result=cleanupPublicationNote(note);
  assert.equal(result.removedLines.length,3);assert.equal(result.sectionsRemoved,3);
  assert.match(result.note.body,/^# Old title\n>\[!info\] Old info/);
  assert.doesNotMatch(result.note.body,/Remove parent|Remove child|Setext section|Never execute/);
  assert.match(result.note.body,/Retain prose\nKeep this prose/);assert.match(result.note.body,/Existing empty heading/);
  assert.match(result.note.body,/This example remains/);assert.match(result.note.body,/> LIST FROM #person/);
  assert.doesNotThrow(()=>filterComments(result.note.body,{date:'1750-01-01',campaigns:['dufr']}));
  assert.equal(note.source,source);assert.equal(cleanupPublicationNote(result.note).note.source,result.note.source);
  assert.equal(cleanupPublicationNote(parseNote(source.replaceAll('\n','\r\n'))).note.source,result.note.source);
});

test('publication preserves authored prose on notes with old header metadata',()=>{
  const prefix='---\nheaderVersion: 2023.11.25\ntags: [source]\n---\n';
  for(const body of ['\nDear friends,\n\nA letter.\n','\n## Research\n\nNotes.\n','\n````markdown\n```taelgar-header\n```\n````\n']) {
    const note=parseNote(prefix+body),prepared=cleanupPublicationNote(note).note;
    assert.equal(prepared.source,prefix+body);
    assert.equal(cleanupPublicationNote(prepared).note.source,prepared.source);
    assert.equal(note.source,prefix+body);
  }
});

test('Node stages run DQL on a copied raw vault before JavaScript cleanup and never rewrite source notes',async t=>{
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const dir=await fs.mkdtemp(path.join(ROOT,'.cache','website-stages-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),dir));await fs.rm(dir,{recursive:true,force:true});});
  const vault=path.join(dir,'original'),working=path.join(dir,'working');await fs.mkdir(vault);
  const source='---\nheaderVersion: 1\ntags: [group]\n---\n# Saved header\n>[!info] Old\n\n'+
    '```dataview\nLIST FROM #person\n```\n\n```dataviewjs\nawait dv.view("_scripts/view/get_CampaignInteractions");\n```\n\n'+
    '```taelgar-index\ntype: members\n```\n';
  await fs.writeFile(path.join(vault,'Guild.md'),source);await fs.mkdir(path.join(vault,'_private'));await fs.writeFile(path.join(vault,'_private','Indexed.md'),'# Private source note');
  const stub='---\ntags: [person, status/stub]\nmapPath: {source: _maps/missing.json}\n---\n```dataview\nINVALID STUB QUERY\n```';
  await fs.writeFile(path.join(vault,'Stub.md'),stub);
  const unpublished='---\nnoPublish: true\nmapPath: {source: _maps/missing.json}\n---\n```dataview\nINVALID UNPUBLISHED QUERY\n```';
  await fs.writeFile(path.join(vault,'Unpublished.md'),unpublished);
  const copy=await copyWorkingVault(vault,working);
  assert.equal(await fs.readFile(path.join(working,'Guild.md'),'utf8'),source);
  assert.equal(copy.stats.get('Guild.md').ctime,(await fs.stat(path.join(vault,'Guild.md'))).birthtimeMs);
  const settings={vault_dir:vault,source_dir:working},store=new Store(settings);
  const report=await materializeWebsiteDataview(store,{directory:dir,vaultPath:vault,stats:copy.stats},{createRuntime:async(directory,options)=>{
    assert.equal(options.dataviewDirectory,undefined,'default must not point to a vault installation');
    assert.equal(directory,working);assert.match(store.entries[0].note.body,/Saved header/);assert.match(store.entries[0].note.body,/dataviewjs/);
    await assert.rejects(fs.access(path.join(directory,'_private')),{code:'ENOENT'});
    await assert.rejects(fs.access(path.join(directory,'Stub.md')),{code:'ENOENT'});
    assert.equal(options.stats.has('Stub.md'),false);
    await assert.rejects(fs.access(path.join(directory,'Unpublished.md')),{code:'ENOENT'});
    assert.equal(options.stats.has('Unpublished.md'),false);
    assert.equal(options.stats.has('_private/Indexed.md'),false);
    return {api:{tryQueryMarkdown:async()=>'- [[Result]]'},errors:[],identity:{version:'fixture'},index:{pages:new Map()},links:{ambiguities:new Map()}};
  }});
  assert.equal(report.backend,'node');assert.equal(report.counts.materialized,1);
  const cleanup=cleanupPublicationStore(store);await saveWorkingNotes(store);
  const output=await fs.readFile(path.join(working,'Guild.md'),'utf8');
  assert.match(output,/\[\[Result\]\]/);assert.match(output,/taelgar-index/);assert.match(output,/Saved header/);
  assert.doesNotMatch(output,/dataviewjs|taelgar-interactions|LIST FROM/);
  assert.deepEqual(cleanup,{schemaVersion:2,omitted:[{file:'Guild.md',line:6}],sectionsRemoved:0});
  assert.equal(await fs.readFile(path.join(vault,'Guild.md'),'utf8'),source);
  assert.equal(await fs.readFile(path.join(vault,'Stub.md'),'utf8'),stub);
  assert.equal(await fs.readFile(path.join(vault,'Unpublished.md'),'utf8'),unpublished);
  await assert.rejects(saveWorkingNotes(new Store({...settings,source_dir:vault})),/separate working vault/);
});

test('working vault copy prunes underscore and marked folders at every depth, including all their media',async t=>{
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const dir=await fs.mkdtemp(path.join(ROOT,'.cache','website-copy-exclusions-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),dir));await fs.rm(dir,{recursive:true});});
  const vault=path.join(dir,'original'),working=path.join(dir,'working');await fs.mkdir(vault);
  const sources={
    'Public.md':'# Public',
    '_private/Secret.md':'Private root folder',
    'Nested/_private/Deep/Secret.md':'Private nested folder',
    'Hidden/.nopublish':'',
    'Hidden/Secret.md':'Marked folder',
    'Hidden/Deep/media.png':'Private media',
    'Nested/Hidden/.nopublish':'Exclude this subtree',
    'Nested/Hidden/Secret.md':'Nested marked folder',
    'Nested/Hidden/Deep/Child.md':'Marked ancestor',
    'Nested/Hidden-extra/Public.md':'Similarly named sibling',
    'Nested/_keep.md':'Underscore files remain ordinary files',
    'assets/_internal/private.png':'Private asset folder',
    'assets/Hidden/.nopublish':'',
    'assets/Hidden/private.png':'Marked asset folder',
    'assets/public.png':'Public media',
    '.hidden/Secret.md':'Dot folder',
  };
  for(const [relative,source] of Object.entries(sources)){
    const file=path.join(vault,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,source);
  }
  const copied=await copyWorkingVault(vault,working);
  assert.deepEqual([...copied.stats.keys()].sort(),['Nested/Hidden-extra/Public.md','Nested/_keep.md','Public.md']);
  for(const relative of ['_private','Nested/_private','Hidden','Nested/Hidden','assets/_internal','assets/Hidden','.hidden'])
    await assert.rejects(fs.access(path.join(working,relative)),{code:'ENOENT'});
  for(const relative of ['Public.md','Nested/Hidden-extra/Public.md','Nested/_keep.md','assets/public.png'])
    assert.equal(await fs.readFile(path.join(working,relative),'utf8'),sources[relative]);
  for(const [relative,source] of Object.entries(sources))assert.equal(await fs.readFile(path.join(vault,relative),'utf8'),source);
  await fs.writeFile(path.join(vault,'.nopublish'),'Root exclusion');
  const excluded=await copyWorkingVault(vault,path.join(dir,'excluded'));
  assert.deepEqual(await fs.readdir(excluded.directory),[]);assert.equal(excluded.stats.size,0);
});

test('strict Node query failures apply no partial replacements',async t=>{
  const dir=await fs.mkdtemp(path.join(ROOT,'.cache','node-dql-strict-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),dir));await fs.rm(dir,{recursive:true,force:true});});
  const note=parseNote('```dataview\nLIST\n```\n```dataview\nBROKEN\n```\n'),store={settings:{source_dir:dir},entries:[{id:'Note.md',note}]};
  await assert.rejects(materializeWebsiteDataview(store,{directory:dir,vaultPath:dir},{createRuntime:async()=>({
    api:{tryQueryMarkdown:async query=>{if(query.includes('BROKEN'))throw new Error('syntax');return '- valid';}},errors:[],identity:{version:'fixture'},index:{pages:new Map()},links:{ambiguities:new Map()}
  })}),/Node Dataview materialization failed/);
  assert.equal(store.entries[0].note,note);
});

test('Node reports unsupported current-page chronology queries',async t=>{
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','node-dql-chronology-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));await fs.rm(directory,{recursive:true});});
  const source='## Chronology\n```dataview\nLIST WITHOUT ID events.text\nFROM [[Arcus]]\nFLATTEN file.lists AS events\n'+
    'WHERE contains(events.text, this.file.name) AND contains(events.text, "DR")\nSORT events.DR\n```\n';
  const note=parseNote(source),store={settings:{source_dir:directory},entries:[{id:'People/Chardonians/Arcus.md',note}]};
  const dependencies={createRuntime:()=>assert.fail('unsupported Node scans must not load the engine')};
  await assert.rejects(materializeWebsiteDataview(store,{directory},dependencies),/Node Dataview materialization failed/);
  const result=await materializeWebsiteDataview(store,{directory,noStrict:true},dependencies);
  assert.equal(result.backend,'node');assert.equal(result.counts.unsupported,1);assert.equal(result.counts.materialized,0);
  assert.match(result.issues[0].message,/Node backend/);assert.equal(store.entries[0].note.source,source);
});

test('website materialization starts Dataview only when there are queries and surfaces engine failures',async t=>{
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','website-node-dql-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));await fs.rm(directory,{recursive:true,force:true});});
  const note=parseNote('```dataview\nLIST\n```\n'),store={settings:{source_dir:directory},entries:[{id:'Note.md',note}]};
  let indexed=false;
  const report=await materializeWebsiteDataview(store,{directory},{createRuntime:async()=>{
    indexed=true;return {api:{tryQueryMarkdown:async()=>'- Node result'},errors:[],identity:{version:'fixture'},index:{pages:new Map()},links:{ambiguities:new Map()}};
  }});
  assert.equal(indexed,true);assert.equal(report.backend,'node');assert.match(store.entries[0].note.body,/Node result/);
  store.entries[0].note=parseNote('No queries.\n');
  const empty=await materializeWebsiteDataview(store,{directory},{createRuntime:()=>assert.fail('no queries must not load or download Dataview')});
  assert.equal(empty.counts.queries,0);
  store.entries[0].note=note;
  await assert.rejects(materializeWebsiteDataview(store,{directory},{createRuntime:async()=>{throw new Error('Node engine unavailable');}}),/Node engine unavailable/);
});
