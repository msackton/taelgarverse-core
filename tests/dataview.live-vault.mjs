import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadSettings} from '../src/config.mjs';
import {encode,decode,evaluate,compareResults} from '../experiments/dataview/protocol.mjs';
import {loadEngine} from '../experiments/dataview/engine.mjs';
import {cachedMetadata,createIndex,restoreIndexTables} from '../experiments/dataview/index.mjs';

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
