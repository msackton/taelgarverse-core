import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadSettings,ROOT,isInside} from '../src/config.mjs';
import {encode,decode,evaluate,compareResults} from '../experiments/dataview/protocol.mjs';
import {loadEngine,bundleIdentity} from '../experiments/dataview/engine.mjs';
import {cachedMetadata,createIndex,resolver,restoreIndexTables} from '../experiments/dataview/index.mjs';
import {collectQueries,queryCategory} from '../experiments/dataview/harness.mjs';

test('harness excludes timeline queries while retaining other queries and syntax errors',()=>{
  const files=[{path:'Example.md',source:'```dataview\nLIST WITHOUT ID events.text FLATTEN file.lists AS events SORT events.DR\n```\n'+
    '```dataview\nLIST FROM #person\n```\n```dataviewjs\ndv.pages()\n```\n```dataview\nLIST from\n```\n'}];
  const {queries,skipped}=collectQueries(files,new Set(['Example.md']));
  assert.equal(queries.length,2);assert.equal(skipped.length,1);assert.equal(skipped[0].category,'timeline');
  assert.equal(queries[1].query,'LIST from\n');assert.notEqual(queries[0].id,queries[1].id);
  assert.equal(queryCategory('TABLE pcOwner FROM #item'),'inventory');
});

test('comparison detects values, order, Markdown, errors and incomplete batches',()=>{
  const queries=[{id:'a',sourcePath:'A.md',line:2}],result={id:'a',status:'ok',rows:2,result:encode({values:[1,2]}),markdown:'- 1\n- 2'};
  assert.equal(compareResults(queries,[result],[{...result,elapsedMs:100}])[0].outcome,'matching');
  assert.equal(compareResults(queries,[result],[{...result,result:encode({values:[2,1]})}])[0].outcome,'different');
  assert.match(compareResults(queries,[result],[{...result,markdown:'changed'}])[0].difference.at,/markdown/);
  assert.equal(compareResults(queries,[result],[{...result,markdown:'changed'}])[0].difference.kind,undefined);
  assert.equal(compareResults(queries,[result],[{...result,result:encode({values:[2,1]})}])[0].difference.kind,'row-order');
  const empty={...result,rows:0,result:encode({values:[]})};
  assert.equal(compareResults(queries,[empty],[empty])[0].outcome,'matching-empty');
  const error={id:'a',status:'error',message:'Syntax error'};
  assert.equal(compareResults(queries,[error],[error])[0].outcome,'matching-error');
  assert.equal(compareResults(queries,[error],[{...error,message:'Host API missing'}])[0].outcome,'different');
  assert.throws(()=>compareResults(queries,[result],[]),/incomplete/);
  assert.throws(()=>compareResults(queries,[result],[result,result]),/Duplicate/);
});

test('metadata adapter extracts frontmatter, inline fields, links, tags and list hierarchy outside code',()=>{
  const source='---\ntags: [person]\naffiliations: ["[[Guild]]"]\n---\n# Person\n\nAge:: 23\n[[Friend|a friend]] ![[Portrait.png]] #person/elf\n'+
    '- Parent [rank:: 1]\n  - Child\n\n```text\n[[Code link]] #hidden\n```\n`[[Inline code]]` %% [[Comment]] %%\n';
  const meta=cachedMetadata(source);
  assert.deepEqual(meta.frontmatter.tags,['person']);assert.equal(meta.frontmatterLinks[0].link,'Guild');
  assert.deepEqual(meta.links.map(l=>l.link),['Friend','Comment']);assert.deepEqual(meta.embeds.map(l=>l.link),['Portrait.png']);
  assert.deepEqual(meta.tags.map(t=>t.tag),['#person/elf']);
  assert.equal(meta.headings[0].heading,'Person');assert.equal(meta.listItems[1].parent,meta.listItems[0].position.start.line);
});

test('resolver reports ambiguous guesses and captured replay refuses uncaptured lookups',()=>{
  const files=['People/Alex.md','Places/Alex.md','People/Sam.md'];
  const live=resolver(files);
  assert.equal(live.resolve('Alex','People/Sam.md').path,'People/Alex.md');
  live.resolve('Alex','Other/Example.md');assert.equal(live.ambiguities.size,1);
  const captured=resolver(files,{strict:true,resolutions:[['People/Sam.md','Alex','People/Alex.md']]});
  assert.equal(captured.resolve('Alex','People/Sam.md').path,'People/Alex.md');
  assert.throws(()=>captured.resolve('Alex','Other.md'),/Uncaptured/);
});

test('Node adapter rejects unreviewed bundle bytes and versions before evaluating dependency code',async t=>{
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','dataview-pin-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));await fs.rm(directory,{recursive:true,force:true});});
  await fs.writeFile(path.join(directory,'main.js'),'throw new Error("Dependency code must not execute");');
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({id:'dataview',version:'0.5.68'}));
  await assert.rejects(loadEngine(directory),/Unrecognized Dataview 0.5.68 bundle/);
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({id:'dataview',version:'0.5.69'}));
  await assert.rejects(bundleIdentity(directory),/supports Dataview 0.5.68 only/);
});

let engineDirectory;
try{const settings=loadSettings(undefined,{vaultOnly:true});engineDirectory=path.join(settings.vault_dir,'.obsidian/plugins/dataview');await fs.access(path.join(engineDirectory,'main.js'));}
catch{engineDirectory=null;}

test('real pinned Dataview engine runs DQL and Markdown with a filesystem index, and replays typed metadata',
  {skip:engineDirectory?false:'Local Dataview installation unavailable; engine is not vendored in CI.'},async()=>{
  const {engine}=await loadEngine(engineDirectory,{now:Date.UTC(2026,9,23),zone:'America/New_York'});
  const files=[{path:'Guild.md'},{path:'People/Alex.md'},{path:'People/Blair.md'}],runtime=createIndex(engine,files);
  const documents=[
    ['Guild.md','---\nname: Guild\n---\n# Guild\n'],
    ['People/Alex.md','---\ntags: [person]\nname: Alex\naffiliations: ["[[Guild]]"]\nrealWorldDate: 2024-02-01\n---\nAge:: 23\n[[Blair]]\n'],
    ['People/Blair.md','---\ntags: [person]\nname: Blair\n---\n[[Alex]]\n'],
  ];
  for(const [file,source] of documents)runtime.add(engine.parsePage(file,source,{ctime:0,mtime:0,size:source.length},cachedMetadata(source)),{canonicalize:true});
  const queries=[
    {id:'members',sourcePath:'Guild.md',query:'TABLE WITHOUT ID file.link AS Person, realWorldDate AS Played FROM #person WHERE contains(affiliations, this.file.link) SORT file.name'},
    {id:'links',sourcePath:'People/Alex.md',query:'LIST FROM #person WHERE contains(file.outlinks, this.file.link)'},
    {id:'inline',sourcePath:'People/Alex.md',query:'TABLE WITHOUT ID Age FROM #person WHERE Age'},
    {id:'empty',sourcePath:'Guild.md',query:'LIST FROM #missing'},
    {id:'broken',sourcePath:'Guild.md',query:'LIST from'},
  ];
  const results=await evaluate(runtime.api,queries);
  assert.deepEqual(results.map(r=>r.status),['ok','ok','ok','ok','error']);
  assert.deepEqual(results.map(r=>r.rows),[1,1,1,0,undefined]);
  assert.match(results[0].markdown,/Alex/);assert.match(results[0].markdown,/2024/);
  assert.match(results[1].markdown,/Blair/);assert.match(results[2].markdown,/23/);
  const page=runtime.index.pages.get('People/Alex.md'),encoded=encode(page),roundtrip=decode(encoded,engine);
  assert.deepEqual(encode(new engine.PageMetadata(roundtrip.path,roundtrip)),encoded);
  assert.equal(roundtrip.fields.get('realWorldDate').isLuxonDateTime,true);
  assert.equal(roundtrip.fields.get('affiliations')[0].path,'Guild.md');
  const replay=createIndex(engine,files,{resolutions:[],strict:false,resolvedLinks:runtime.index.metadataCache.resolvedLinks});
  for(const page of runtime.index.pages.values())replay.add(decode(encode(page),engine));
  const again=await evaluate(replay.api,queries);
  assert.ok(compareResults(queries,results,again).every(q=>q.outcome!=='different'));
  // A live host's inverse-map insertion order is independent of page order.
  // Captured replay must preserve that state rather than silently rebuild it.
  runtime.index.tags.delegate.invMap.set('#person',new Set(['People/Blair.md','People/Alex.md']));
  const orderQuery=[{id:'order',sourcePath:'Guild.md',query:'LIST FROM #person'}];
  const host=await evaluate(runtime.api,orderQuery),rebuilt=await evaluate(replay.api,orderQuery);
  assert.equal(compareResults(orderQuery,host,rebuilt)[0].outcome,'different');
  const tables=decode(encode({tags:runtime.index.tags.delegate,etags:runtime.index.etags.delegate,links:runtime.index.links}),engine);
  restoreIndexTables(replay.index,tables);
  assert.equal(compareResults(orderQuery,host,await evaluate(replay.api,orderQuery))[0].outcome,'matching');
});
