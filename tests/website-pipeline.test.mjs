import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {Store,parseNote} from '../src/store.mjs';
import {convertWebsiteNote,recognizeDataviewJs} from '../src/website-compatibility.mjs';
import {copyWorkingVault} from '../scripts/website-working-vault.mjs';
import {materializeWebsiteDataview} from '../scripts/materialize-website-dataview.mjs';
import {materializeWebsite} from '../scripts/materialize-website.mjs';
import {convertWebsiteStore,saveWorkingNotes} from '../scripts/convert-website.mjs';

const members=`const { util } = customJS;
dv.table(["Person", "Info", "Current Location"], dv.pages("#person")
  .where(p => util.isAffiliated(dv.current().file.name, p.file))
  .map(p => [util.s("<name> (<pronouns> <pronunciation>)", p.file),
    util.s("<ancestry> <maintype>", p.file), util.s("<lastknown:2r> (<lastknowndate>)", p.file, dv.current().pageTargetDate)]));`;

test('conversion recognizes complete legacy table syntax, never executes JS, and preserves wrappers and prose',()=>{
  const original=parseNote('---\nheaderVersion: 1\ntags: [group]\n---\n# Saved\n>[!info] Old\n\n%%^Campaign:dufr%%\n> ```dataviewjs\n'+
    members.split('\n').map(l=>'> '+l).join('\n')+'\n> ```\n%%^End%%\n\nProse.\n');
  const result=convertWebsiteNote(original,{sourcePath:'Guild.md'});
  assert.match(result.note.body,/^```taelgar-header\n```/);assert.match(result.note.body,/> ```taelgar-index\n> type: members\n> mode: table/);
  assert.match(result.note.body,/%%\^Campaign:dufr%%/);assert.match(result.note.body,/%%\^End%%/);assert.match(result.note.body,/Prose\./);
  assert.equal(result.changes.length,2);assert.equal(result.unconverted.length,0);
  assert.equal(convertWebsiteNote(result.note).note.source,result.note.source);
  assert.match(original.body,/Saved/);
  assert.equal(recognizeDataviewJs(members.replaceAll('"',"'")).rule,'legacy-members');
  for(const altered of [members+'\nthrow new Error("side effect");',members.replace('isAffiliated','isOrWasAffiliated'),
    members.replace('.map(', '[map]('),members.replace('{ util }','{ [util]: util }'),
    members.replace('Current Location','Born'),members.replace('.where(p => util.isAffiliated(dv.current().file.name, p.file))',
      '.where(p => util.isAffiliated(dv.current().file.name, p.file) && p.special)')])assert.equal(recognizeDataviewJs(altered),null);
  const unknown=convertWebsiteNote(parseNote('```dataviewjs\nthrow new Error("Never execute");\n```\n'));
  assert.match(unknown.note.body,/Never execute/);assert.equal(unknown.unconverted.length,1);
  const incompatible=convertWebsiteNote(parseNote('```dataviewjs\n'+members+'\n```\n'));
  assert.match(incompatible.note.body,/dataviewjs/);assert.match(incompatible.unconverted[0].reason,/group target/);
});

test('conversion reports an asset target instead of treating it as a native index page',async()=>{
  const note=parseNote('```dataviewjs\n'+members.replace('dv.current().file.name','"asset.png"')+'\n```\n');
  const store={entries:[{id:'Guild.md',note}],lookup:()=>({entry:{id:'asset.png',note:null}})};
  const report=await convertWebsiteStore(store);
  assert.equal(report.changes.length,0);assert.equal(report.unconverted.length,1);
  assert.match(report.unconverted[0].reason,/group target/);assert.equal(report.dataviewJsBlocksRemoved,1);
});

test('Node stages run DQL on a copied raw vault before conversion and never rewrite source notes',async t=>{
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const dir=await fs.mkdtemp(path.join(ROOT,'.cache','website-stages-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),dir));await fs.rm(dir,{recursive:true,force:true});});
  const vault=path.join(dir,'original'),working=path.join(dir,'working');await fs.mkdir(vault);
  const source='---\nheaderVersion: 1\ntags: [group]\n---\n# Saved header\n>[!info] Old\n\n'+
    '```dataview\nLIST FROM #person\n```\n\n```dataviewjs\n'+members+'\n```\n';
  await fs.writeFile(path.join(vault,'Guild.md'),source);await fs.mkdir(path.join(vault,'_private'));await fs.writeFile(path.join(vault,'_private','Indexed.md'),'# Included in DQL indexing');
  const copy=await copyWorkingVault(vault,working);
  assert.equal(await fs.readFile(path.join(working,'Guild.md'),'utf8'),source);
  assert.equal(copy.stats.get('Guild.md').ctime,(await fs.stat(path.join(vault,'Guild.md'))).birthtimeMs);
  const settings={vault_dir:vault,source_dir:working},store=new Store(settings);
  const report=await materializeWebsiteDataview(store,{directory:dir,vaultPath:vault,stats:copy.stats},{createRuntime:async(directory,options)=>{
    assert.equal(options.dataviewDirectory,undefined,'default must not point to a vault installation');
    assert.equal(directory,working);assert.match(store.entries[0].note.body,/Saved header/);assert.match(store.entries[0].note.body,/dataviewjs/);
    assert.match(await fs.readFile(path.join(directory,'_private/Indexed.md'),'utf8'),/Included/);
    return {api:{tryQueryMarkdown:async()=>'- [[Result]]'},errors:[],identity:{version:'fixture'},index:{pages:new Map()},links:{ambiguities:new Map()}};
  }});
  assert.equal(report.backend,'node');assert.equal(report.counts.materialized,1);
  const conversion=await convertWebsiteStore(store);await saveWorkingNotes(store);
  const output=await fs.readFile(path.join(working,'Guild.md'),'utf8');
  assert.match(output,/\[\[Result\]\]/);assert.match(output,/taelgar-index/);assert.match(output,/taelgar-header/);
  assert.doesNotMatch(output,/Saved header|dataviewjs|LIST FROM/);assert.equal(conversion.unconverted.length,0);
  assert.equal(await fs.readFile(path.join(vault,'Guild.md'),'utf8'),source);
  await assert.rejects(saveWorkingNotes(new Store({...settings,source_dir:vault})),/separate working vault/);
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

test('website materializer defaults to Node and never switches engines after a failure',async t=>{
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','website-backend-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));await fs.rm(directory,{recursive:true,force:true});});
  const note=parseNote('```dataview\nLIST\n```\n'),store={settings:{source_dir:directory},entries:[{id:'Note.md',note}]};
  let indexed=false;
  const report=await materializeWebsite(store,{directory,vaultPath:directory},{run:()=>assert.fail('default must not invoke Obsidian'),createRuntime:async()=>{
    indexed=true;return {api:{tryQueryMarkdown:async()=>'- Node result'},errors:[],identity:{version:'fixture'},index:{pages:new Map()},links:{ambiguities:new Map()}};
  }});
  assert.equal(indexed,true);assert.equal(report.backend,'node');assert.match(store.entries[0].note.body,/Node result/);
  store.entries[0].note=parseNote('No queries.\n');
  const empty=await materializeWebsite(store,{directory,vaultPath:directory},{createRuntime:()=>assert.fail('no queries must not load or download Dataview'),run:()=>assert.fail('no Obsidian needed')});
  assert.equal(empty.counts.queries,0);
  store.entries[0].note=note;
  await assert.rejects(materializeWebsite(store,{directory,vaultPath:directory},{createRuntime:async()=>{throw new Error('Node engine unavailable');},run:()=>assert.fail('no automatic fallback')}),/Node engine unavailable/);
  await assert.rejects(materializeWebsite(store,{directory,vaultPath:directory,materializer:'obsidian',obsidianCommand:'fixture-cli'},{createRuntime:()=>assert.fail('Obsidian mode must not load Node engine'),run:async()=>{throw new Error('Obsidian unavailable');}}),/Obsidian unavailable/);
});
