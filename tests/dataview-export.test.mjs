import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {ROOT,loadSettings,isInside} from '../src/config.mjs';
import {parseNote} from '../src/content-store.mjs';
import {preparePublicationNote} from '../src/publication-markdown.mjs';
import {filterComments} from '../src/comments.mjs';
import {exportDataview,dataviewEval} from '../scripts/export-dataview.mjs';
import {materializeWebsite} from '../scripts/materialize-website.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {validateDataviewRequest} from '../src/dataview-export.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/exporter.mjs'],write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});

async function fixture(t,sources={'Note.md':'```dataview\nLIST FROM #person\n```\n'}) {
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','dataview-test-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));await fs.rm(directory,{recursive:true,force:true});});
  const vault=path.join(directory,'vault'),staging=path.join(directory,'staging');
  for(const [file,source] of Object.entries(sources)) {
    await fs.mkdir(path.dirname(path.join(vault,file)),{recursive:true});await fs.writeFile(path.join(vault,file),source);
  }
  await fs.mkdir(staging,{recursive:true});
  const calls=[],module={exports:{}};
  vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='obsidian'?{Component:class{}}:require(name),setTimeout,clearTimeout});
  const app={workspace:{onLayoutReady:callback=>callback()},plugins:{plugins:{dataview:{index:{initialized:true},api:{tryQueryMarkdown:async(query,source)=>{
    calls.push({query,source});return '- Materialized [[Target]]\n';
  }}}}},vault:{adapter:{getBasePath:()=>vault},getAbstractFileByPath:file=>Object.hasOwn(sources,file)?{path:file,extension:'md'}:null}};
  const feature=new module.exports.ExporterFeature({app});
  const store={entries:Object.entries(sources).map(([id,source])=>({id,note:preparePublicationNote(parseNote(source)).note}))};
  const run=async(command,args)=>{
    assert.equal(command,'test-obsidian');assert.equal(args[0],'vault=vault');assert.equal(args[1],'eval');
    assert.match(args[2],/app.plugins.plugins.taelgarverse/);
    const request=JSON.parse(/await plugin\.exportDataview\((.+)\);return/.exec(args[2])[1]);
    await feature.runRequest(request);
  };
  const options={directory:staging,vaultPath:vault,obsidianCommand:'test-obsidian'};
  return {directory,vault,staging,calls,feature,app,store,options,run,sources};
}

test('Node cleans headers and JavaScript-only headings while preserving prose, examples and conditional delimiters',()=>{
  const source=['---','headerVersion: 2023.11.25','tags: [person]','---','# Old title','>[!info] Old info','',
    '## Remove parent','%%^Campaign:dufr%%','### Remove child','```dataviewjs','throw new Error("Never execute");','```','%%^End%%','',
    '## Retain prose','Keep this prose.','~~~dataviewjs','dv.paragraph("Remove only code");','~~~','',
    'Setext section','--------------','```dataviewjs','dv.list([]);','```','',
    '## Existing empty heading','',
    '````markdown','```dataviewjs','This example remains.','```','````','',
    '> [!info] Query','> ```dataview','> LIST FROM #person','> ```',''].join('\n');
  const note=parseNote(source),result=preparePublicationNote(note);
  assert.equal(result.dataviewJsBlocksRemoved,3);assert.equal(result.sectionsRemoved,3);
  assert.match(result.note.body,/^```taelgar-header\n```/);
  assert.doesNotMatch(result.note.body,/Old title|Old info|Remove parent|Remove child|Setext section|Never execute/);
  assert.match(result.note.body,/Retain prose\nKeep this prose/);assert.match(result.note.body,/Existing empty heading/);
  assert.match(result.note.body,/This example remains/);assert.match(result.note.body,/> LIST FROM #person/);
  assert.doesNotThrow(()=>filterComments(result.note.body,{date:'1750-01-01',campaigns:['dufr']}));
  assert.equal(note.source,source);assert.equal(preparePublicationNote(result.note).note.source,result.note.source);
  assert.equal(preparePublicationNote(parseNote(source.replaceAll('\n','\r\n'))).note.source,result.note.source);
});

test('publication retains generated headers on versioned handouts without treating authored prose as a saved header',()=>{
  const prefix='---\nheaderVersion: 2023.11.25\ntags: [source]\n---\n';
  for(const body of ['\nDear friends,\n\nA letter.\n','\n## Research\n\nNotes.\n','\n````markdown\n```taelgar-header\n```\n````\n']) {
    const note=parseNote(prefix+body),prepared=preparePublicationNote(note).note;
    assert.equal(prepared.source,prefix+'```taelgar-header\n```\n\n'+body.trimStart());
    assert.equal(preparePublicationNote(prepared).note.source,prepared.source);
    assert.equal(note.source,prefix+body);
  }
});

test('the Taelgarverse desktop exporter only evaluates planned DQL; Node replaces callout queries and leaves the vault untouched',async t=>{
  const sources={
    'Note.md':'---\nheaderVersion: 1\ntags: [person]\n---\n# Old\n>[!info] Header\n\n## JS only\n```dataviewjs\nthrow 1;\n```\n\n## Results\n> [!note] Query\n> ```dataview\n> LIST FROM #person\n> ```\n\nAfter query.\n',
    'Excluded.md':'---\nexcludePublish: all\n---\n```dataview\nINVALID EXCLUDED QUERY\n```\n',
    'Example.md':'````markdown\n```dataview\nNOT A QUERY\n```\n````\n',
  };
  const f=await fixture(t,sources),result=await exportDataview(f.store,f.options,{run:f.run});
  assert.deepEqual(f.calls,[{query:'LIST FROM #person\n',source:'Note.md'}]);
  assert.equal(result.counts.materialized,1);assert.equal(result.counts.errors,0);
  assert.match(f.store.entries[0].note.body,/> - Materialized \[\[Target\]\]\n\nAfter query/);
  assert.doesNotMatch(f.store.entries[0].note.body,/JS only|throw 1|Old|dataview/);
  assert.equal(parseNote(f.store.entries[0].note.source).body,f.store.entries[0].note.body);
  for(const [file,source] of Object.entries(sources))assert.equal(await fs.readFile(path.join(f.vault,file),'utf8'),source);
  assert.equal(await fs.stat(path.join(f.staging,'vault')).catch(()=>null),null,'no copied vault or assets');
});

test('strict errors stop preparation and partial mode preserves failed queries with actionable reports',async t=>{
  const f=await fixture(t,{'Note.md':'```dataview\nLIST\n```\n\n```dataview\nINVALID\n```\n'});
  f.app.plugins.plugins.dataview.api.tryQueryMarkdown=async query=>{if(query.includes('INVALID'))throw new Error('Query syntax error');return '- Valid result';};
  const before=f.store.entries[0].note.source;
  await assert.rejects(exportDataview(f.store,f.options,{run:f.run}),/Dataview materialization failed/);
  assert.equal(f.store.entries[0].note.source,before,'strict failure applies no partial result');
  const result=await exportDataview(f.store,{...f.options,noStrict:true},{run:f.run});
  assert.equal(result.counts.errors,1);assert.match(result.issues[0].message,/syntax error/);
  assert.match(f.store.entries[0].note.body,/- Valid result/);assert.match(f.store.entries[0].note.body,/```dataview\nINVALID/);
});

test('unsupported scans and unclosed fences keep their legacy strict/non-strict behavior',async t=>{
  const original='```dataview\nLIST events.text FLATTEN file.lists AS events WHERE contains(events.text, this.file.name)\n```\n\n```dataview\nUnclosed.\n';
  const f=await fixture(t,{'Note.md':original});
  await assert.rejects(exportDataview(f.store,f.options,{run:()=>assert.fail('unsupported queries never reach Obsidian')}),/materialization failed/);
  const result=await exportDataview(f.store,{...f.options,noStrict:true});
  assert.equal(result.counts.errors,1);assert.equal(result.counts.unsupported,1);assert.equal(f.store.entries[0].note.source,original);
});

test('website Obsidian requests select only the new materializer endpoint and fail instead of falling back',async()=>{
  let called=false;
  const request={requestPath:'request',resultPath:'result',progressPath:'progress'},materializer={dataviewExportVersion:1,exportDataview:async received=>{assert.equal(received.requestPath,'request');called=true;}};
  await vm.runInNewContext(dataviewEval(request),{app:{plugins:{plugins:{taelgarverse:{materializer,exportDataview:()=>assert.fail('old API must not be selected')},'taelgar-dataview-materializer':{runRequest:()=>assert.fail('original materializer must not be selected')}}}}});
  assert.equal(called,true);
  await assert.rejects(vm.runInNewContext(dataviewEval(request),{app:{plugins:{plugins:{taelgarverse:{dataviewExportVersion:1,exportDataview:()=>assert.fail('no fallback')}}}}}),/Install and reload the current Taelgarverse materializer/);
});

test('a vault without remaining DQL prepares without starting Obsidian',async t=>{
  const f=await fixture(t,{'Note.md':'## Removed\n```dataviewjs\nthrow 1;\n```\n'});
  const result=await exportDataview(f.store,f.options,{run:()=>assert.fail('no Obsidian needed')});
  assert.equal(result.counts.queries,0);assert.doesNotMatch(f.store.entries[0].note.body,/Removed|dataviewjs/);
});

test('Obsidian website mode leaves native blocks, saved headers and JavaScript for the later Node conversion',async t=>{
  const source='---\nheaderVersion: 1\ntags: [group]\n---\n# Saved\n>[!info] Header\n\n'+
    '```taelgar-index\ntype: members\n```\n\n```taelgar-map\nimage: [[Map.png]]\n```\n\n'+
    '```dataviewjs\nawait dv.view("_scripts/view/get_CampaignInteractions");\n```\n\n```dataview\nLIST\n```\n';
  const f=await fixture(t,{'Note.md':source});f.store.entries[0].note=parseNote(source);
  const result=await materializeWebsite(f.store,{...f.options,materializer:'obsidian'},{run:f.run,createRuntime:()=>assert.fail('Node engine must not load')});
  assert.equal(result.backend,'obsidian');assert.equal(result.counts.materialized,1);
  assert.equal(f.store.entries[0].note.source,source.replace('```dataview\nLIST\n```\n','- Materialized [[Target]]\n'));
  assert.equal(await fs.readFile(path.join(f.vault,'Note.md'),'utf8'),source);
});

test('a disabled Obsidian CLI fails immediately with its actual prerequisite',async t=>{
  const f=await fixture(t);
  await assert.rejects(exportDataview(f.store,f.options,{run:async()=>({stdout:'Command line interface is not enabled. Please turn it on in Settings > General > Advanced.\n'})}),
    /Enable Obsidian Settings > General > Advanced > Command line interface/);
  assert.equal(f.calls.length,0);
});

test('desktop exporter waits for Dataview readiness and reports a query timeout without losing later results',async t=>{
  const f=await fixture(t,{'Note.md':'```dataview\nLIST\n```\n\n```dataview\nSECOND\n```\n'});
  f.app.plugins.plugins.dataview.index.initialized=false;
  const ready=setTimeout(()=>{f.app.plugins.plugins.dataview.index.initialized=true;},20);
  t.after(()=>clearTimeout(ready));
  let called=0;
  f.app.plugins.plugins.dataview.api.tryQueryMarkdown=()=>++called===1 ? new Promise(()=>{}) : '- Second query';
  const result=await exportDataview(f.store,{...f.options,noStrict:true,blockTimeoutMs:20},{run:f.run});
  assert.equal(result.counts.errors,1);assert.equal(result.counts.materialized,1);
  assert.match(result.issues[0].message,/timed out/);assert.match(f.store.entries[0].note.body,/- Second query/);
});

test('export request validation rejects unsafe note paths and duplicate query IDs',()=>{
  const request={schemaVersion:1,id:'test',vaultPath:ROOT,blockTimeoutMs:100,queries:[{id:'q0',sourcePath:'Note.md',query:'LIST'}]};
  assert.doesNotThrow(()=>validateDataviewRequest(request));
  for(const sourcePath of ['../Note.md','D:/Note.md','/Note.md','folder\\Note.md','folder//Note.md','Note.json']) {
    assert.throws(()=>validateDataviewRequest({...request,queries:[{...request.queries[0],sourcePath}]}),/Invalid/);
  }
  assert.throws(()=>validateDataviewRequest({...request,queries:[request.queries[0],request.queries[0]]}),/Invalid/);
});

test('desktop exporter rejects vault mismatches and source-vault output, and stops pending work on unload',async t=>{
  const f=await fixture(t),requestPath=path.join(f.staging,'request.json'),resultPath=path.join(f.staging,'result.json'),progressPath=path.join(f.staging,'progress.json');
  const request={schemaVersion:1,id:'test',vaultPath:f.staging,blockTimeoutMs:100,queries:[{id:'q0',sourcePath:'Note.md',query:'LIST'}]};
  await fs.writeFile(requestPath,JSON.stringify(request));
  await assert.rejects(f.feature.runRequest({requestPath,resultPath,progressPath}),/different Obsidian vault/);
  assert.equal(f.calls.length,0);
  const unsafe=path.join(f.vault,'request.json');await fs.writeFile(unsafe,JSON.stringify({...request,vaultPath:f.vault}));
  await assert.rejects(f.feature.runRequest({requestPath:unsafe,resultPath:path.join(f.vault,'result.json'),progressPath:path.join(f.vault,'progress.json')}),/outside/);
  assert.equal(await fs.stat(path.join(f.vault,'result.json')).catch(()=>null),null);
  await fs.writeFile(requestPath,JSON.stringify({...request,vaultPath:f.vault}));
  let entered;
  const querying=new Promise(resolve=>{entered=resolve;});
  f.app.plugins.plugins.dataview.api.tryQueryMarkdown=()=>{entered();return new Promise(()=>{});};
  const exporting=f.feature.runRequest({requestPath,resultPath,progressPath});
  await querying;await assert.rejects(f.feature.runRequest({requestPath,resultPath,progressPath}),/already running/);
  f.feature.onunload();await assert.rejects(exporting,/unloaded/);
});

test('content preparation cleans and materializes before packaging without a legacy exporter installation',async t=>{
  const source='---\nheaderVersion: 1\ntags: [person]\n---\n# Saved header\n>[!info] Old\n\n## Remove\n```dataviewjs\nthrow 1;\n```\n\n## Results\n```dataview\nLIST FROM #person\n```\n';
  const f=await fixture(t,{'Note.md':source,'Target.md':'# Target\n'}),settings=loadSettings();
  for(const relative of ['.obsidian/metadata.json','_scripts/session_note_campaigns.json']) {
    await fs.mkdir(path.dirname(path.join(f.vault,relative)),{recursive:true});await fs.copyFile(path.join(settings.vault_dir,relative),path.join(f.vault,relative));
  }
  let materialized=false;
  const prepared=await prepareContent({...settings,vault_dir:f.vault,source_dir:f.vault,nav_source:null,home_source:null},path.join(f.directory,'package'),{commit:'a'.repeat(40),dirty:false},{},undefined,undefined,
    {materialize:async store=>{
      assert.match(store.entries.find(e=>e.id==='Note.md').note.body,/Saved header/);
      assert.match(store.entries.find(e=>e.id==='Note.md').note.body,/dataviewjs/,'DQL runs before compatibility conversion and cleanup');
      const result=await exportDataview(store,f.options,{run:f.run});materialized=true;return result;
    }});
  assert.equal(materialized,true);assert.equal(prepared.materialization.counts.materialized,1);
  const index=JSON.parse(await fs.readFile(prepared.indexFile,'utf8')),entry=index.entries.find(e=>e.id==='Note.md');
  const shardFile=path.join(path.dirname(prepared.indexFile),'notes',entry.note.shard+'.json');
  const packed=JSON.parse(await fs.readFile(shardFile,'utf8'))['Note.md'];
  assert.match(packed,/```taelgar-header\n```/);assert.match(packed,/Materialized \[\[Target\]\]/);
  assert.doesNotMatch(packed,/dataview|Saved header|## Remove/);
  assert.equal(await fs.readFile(path.join(f.vault,'Note.md'),'utf8'),source);
});
