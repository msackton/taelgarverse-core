import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {encode,compareResults} from '../experiments/dataview/protocol.mjs';
import {loadEngine,bundleIdentity} from '../experiments/dataview/engine.mjs';
import {cachedMetadata,resolver} from '../experiments/dataview/index.mjs';
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
