import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {ROOT} from '../src/config.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {indexNotes} from './fixtures/indexes.mjs';
import {buildEvalCode,buildMaterializerRequest} from '../scripts/materialize-static.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/materializer.mjs'],write:false,bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});
function feature() {
  const module={exports:{}},globals={module,exports:module.exports,structuredClone,console,setTimeout,clearTimeout,TextEncoder,TextDecoder,
    window:{setTimeout,clearTimeout},require:name=>name==='obsidian'?{Component:class{},MarkdownRenderChild:class{},Notice:class{}}:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const fixture=headerFixture({baseNotes:indexNotes,date:'1720-01-01'}),pages=fixture.runtime.pages;
  const app={vault:{adapter:{getBasePath:()=>ROOT}},metadataCache:{getFirstLinkpathDest:target=>{
    const page=pages.find(p=>p.path===target || p.name===target);return page&&{path:page.path};
  }}};
  const materializer=new module.exports.MaterializerFeature({app,manifest:{id:'taelgarverse'},addCommand:()=>{}});
  return {materializer,runtime:{api:{tryQueryMarkdown:async()=>'- [[DQL output]]'},customJS:{},headers:async()=>({runtime:fixture.runtime,fallback:'1720-01-01'})}};
}

test('static materializer renders native headers/indexes, converts maps, and retains DQL/DataviewJS support',async()=>{
  const {materializer,runtime}=feature(),file={path:'Groups/Guild.md',name:'Guild.md',basename:'Guild'};
  const source='---\nheaderVersion: 1\ntags: [group]\n---\n```taelgar-header\n```\n\n```taelgar-index\ntype: members\n```\n\n'+
    '> ```taelgar-map\n> image: [[Map.png]]\n> ```\n\n```dataview\nLIST\n```\n\n```dataviewjs\ndv.paragraph("Legacy JS output");\n```\n';
  const config=materializer.normalizeConfig({headerType:'static',overrideDate:'1720-01-01'});
  materializer.regenerateHeader=()=>assert.fail('native header must not also run legacy regeneration');
  const result=await materializer.materializeMarkdown(source,file,runtime,materializer.loadCore(),config);
  assert.equal(result.report.counts.errors,0);assert.equal(result.report.counts.taelgarBlocks,2);assert.equal(result.report.counts.mapsConverted,1);
  assert.match(result.content,/# Guild/);assert.match(result.content,/People\/Alice.md/);
  assert.match(result.content,/> ```leaflet\n> image: \[\[Map.png\]\]/);assert.match(result.content,/DQL output/);assert.match(result.content,/Legacy JS output/);
  assert.doesNotMatch(result.content,/taelgar-header|taelgar-index|taelgar-map|```dataview/);
});

test('invalid native blocks remain visible in partial output with errors',async()=>{
  const {materializer,runtime}=feature(),source='```taelgar-header\ninvalid\n```\n';
  materializer.regenerateHeader=()=>assert.fail('invalid native block must not be swallowed by a saved-header rewrite');
  const result=await materializer.materializeMarkdown(source,{path:'Groups/Guild.md',name:'Guild.md'},runtime,materializer.loadCore(),{headerType:'static',blockTimeoutMs:1000});
  assert.equal(result.report.counts.errors,1);assert.match(result.content,/invalid/);
});

test('an authored title immediately before a native header is preserved, including CRLF source',async()=>{
  const {materializer,runtime}=feature();
  const source='---\r\nheaderVersion: 1\r\ntags: [group]\r\n---\r\n# Saved name\r\n\r\n```taelgar-header\r\n```\r\n\r\nProse.\r\n';
  const result=await materializer.materializeMarkdown(source,{path:'Groups/Guild.md',name:'Guild.md',basename:'Guild'},runtime,materializer.loadCore(),{headerType:'static',blockTimeoutMs:1000});
  assert.equal(result.report.counts.errors,0);assert.equal((result.content.match(/^# /gm)||[]).length,1);
  assert.match(result.content,/# Saved name\r\n/);assert.doesNotMatch(result.content,/# Guild|taelgar-header/);assert.match(result.content,/Prose\.\r\n/);
});

test('static CLI dispatches only to Taelgarverse materializer and keeps legacy export flags',async()=>{
  const request=buildMaterializerRequest({vaultPath:ROOT,mode:'audit',strict:false,headerType:'static'},{id:'static-test'}).request;
  let received;
  const legacy={runRequest:()=>assert.fail('the explicit Taelgarverse CLI must never select the original plugin')};
  await vm.runInNewContext(buildEvalCode(request),{app:{plugins:{plugins:{'taelgar-dataview-materializer':legacy,taelgarverse:{materializer:{runRequest:async value=>{received=value;}}}}}}});
  assert.equal(received.id,'static-test');assert.equal(received.config.dynamicWebsite,false);assert.equal(received.config.headerType,'static');
  await assert.rejects(vm.runInNewContext(buildEvalCode(request),{app:{plugins:{plugins:{'taelgar-dataview-materializer':legacy}}}}),/Plugin not loaded: taelgarverse/);
});

test('static export rejects filesystem roots and ancestors of the source vault before starting Obsidian services',async()=>{
  const {materializer}=feature();
  await assert.rejects(materializer.runMaterialization({outputPath:pathParent(ROOT)}),/cannot contain the vault|filesystem root/);
  await assert.rejects(materializer.runMaterialization({outputPath:ROOT}),/outside the source vault/);
});

test('materializer website mode delegates only DQL export and shares the static export lock',async()=>{
  const {materializer}=feature();let called=0;
  materializer.plugin.exporter={runRequest:async request=>{assert.equal(materializer.running,true);called++;return request;}};
  const request={requestPath:'request'};
  assert.equal(await materializer.exportDataview(request),request);assert.equal(called,1);assert.equal(materializer.running,false);
  materializer.running=true;await assert.rejects(materializer.exportDataview(request),/already running/);assert.equal(called,1);
  materializer.running=false;materializer.plugin.exporter.runRequest=async()=>{throw new Error('fixture error');};
  await assert.rejects(materializer.exportDataview(request),/fixture error/);assert.equal(materializer.running,false);
});

function pathParent(value){return value.replace(/[\\/][^\\/]+[\\/]?$/,'');}
