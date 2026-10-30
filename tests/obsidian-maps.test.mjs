import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {buildObsidian} from '../scripts/build-obsidian.mjs';
import {installObsidian} from '../scripts/install-obsidian.mjs';
import {ROOT} from '../src/config.mjs';
import {codeMirrorHost} from './helpers/codemirror-host.mjs';

const require=createRequire(import.meta.url);
await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
const compiled=await build({absWorkingDir:ROOT,stdin:{contents:"export {default} from './obsidian/taelgarverse/main.mjs'; export {obsidianMapConfig} from './obsidian/taelgarverse/features/maps.mjs';",resolveDir:ROOT},write:false,bundle:true,
  platform:'node',format:'cjs',external:['obsidian','leaflet','@codemirror/view','@codemirror/state'],logLevel:'silent'});

function host(){
  let maps=0,removed=0,disconnected=0;
  class Element {
    constructor(doc){this.ownerDocument=doc;this.children=[];this.dataset={};this.style={setProperty(){}};this.classList={add(){},toggle(){}};this.listeners={};this.clientWidth=400;this.clientHeight=300;}
    append(...items){this.children.push(...items);}
    prepend(...items){this.children.unshift(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(){}
    addEventListener(key,fn){this.listeners[key]=fn;}
    removeEventListener(key){delete this.listeners[key];}
    remove(){this.removed=true;}
    focus(){}
    querySelector(selector){return this.children.flatMap(item=>[item,...(item.children || [])]).find(item=>
      selector==='figcaption'?item.tag==='figcaption':selector==='.map-canvas'?item.className==='map-canvas':item.className==='map-status');}
  }
  const doc={createElement(tag){const element=new Element(doc);element.tag=tag;return element;}};
  class TFile {constructor(filePath){this.path=filePath;this.extension=filePath.split('.').at(-1);this.stat={mtime:1,size:4};}}
  class Component {
    constructor(){this.children=[];}
    addChild(child){this.children.push(child);child.onload?.();return child;}
    registerEvent(){}
    unload(){this.onunload?.();for(const child of [...this.children])child.unload();}
  }
  class Plugin extends Component {
    async loadData(){return this.savedData || {};}
    async saveData(data){this.savedData=data;}
    addSettingTab(){}
    registerView(){}
    addRibbonIcon(){}
    addCommand(command){(this.commands??=[]).push(command);}
    registerEditorExtension(){}
    registerMarkdownPostProcessor(){}
    registerMarkdownCodeBlockProcessor(language,processor){(this.processors ??= new Map()).set(language,processor);if(['taelgar-map','leaflet'].includes(language)){this.language=language;this.processor=processor;}}
  }
  class MarkdownRenderChild {constructor(container){this.containerEl=container;}unload(){this.onunload();}}
  const handler=()=>({enabled:()=>true,disable(){},enable(){}});
  const L={CRS:{Simple:{}},latLngBounds(points){return {pad(){return this;},getEast:()=>points[1][1],getWest:()=>points[0][1],getNorth:()=>points[1][0],getSouth:()=>points[0][0],getCenter:()=>({lat:50,lng:50})};},
    map(){maps++;return {invalidateSize(){},setMinZoom(){},setView(){},fitBounds(){},on(){},off(){},remove(){removed++;},doubleClickZoom:handler(),dragging:handler(),touchZoom:handler(),boxZoom:handler()};},
    imageOverlay(){return {on(){return this;},addTo(){return this;}};},layerGroup(){return {addTo(){return this;},clearLayers(){},remove(){this.clearLayers();}};}};
  const cm=codeMirrorHost();
  const module={exports:{}},context={module,exports:module.exports,Buffer,TextDecoder,TextEncoder,structuredClone,crypto:globalThis.crypto,console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},
    ResizeObserver:class{observe(){}disconnect(){disconnected++;}},
    require:name=>name==='obsidian'?{Plugin,Component,ItemView:class{},PluginSettingTab:class{},Setting:class{},Notice:class{},MarkdownRenderChild,TFile}:name==='leaflet'?L:
      name==='@codemirror/view'?cm.view:name==='@codemirror/state'?cm.state:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,context);
  const file=new TFile('assets/local map.png');let reads=0,fail=false,resolve;
  const app={workspace:{on(){return {};},onLayoutReady(fn){fn();},iterateAllLeaves(){}},
    metadataCache:{getFirstLinkpathDest:(image,source)=>{assert.equal(image,'local map.png');assert.equal(source,'Places/Map.md');return file;}},
    vault:{readBinary:async()=>{reads++;if(fail)throw new Error('read failed');if(resolve)return await new Promise(r=>{resolve=r;});return Uint8Array.from([1,2,3,4]).buffer;},getResourcePath:()=> 'app://local/assets/local%20map.png'}};
  return {...module.exports,TFile,doc,app,file,get reads(){return reads;},set fail(value){fail=value;},
    defer(){resolve=true;},release(){resolve(Uint8Array.from([1,2,3,4]).buffer);},get counts(){return {maps,removed,disconnected};}};
}
const source='image: [[local map.png]]\nbounds: [[0,0],[100,200]]\nunit: miles\nscale: 0.5\n';

test('Obsidian v2 loader resolves the manifest image exactly and decodes PNG dimensions and translates Photoshop coordinates',async()=>{
  const h=host(),sharp=(await import('sharp')).default,bytes=await sharp({create:{width:600,height:400,channels:3,background:'white'}}).png().toBuffer();
  const manifest={version:2,image:'core.png',sourceOffset:[1000,2000]};
  const manifestFile=new h.TFile('assets/maps/core.map.json'),image=new h.TFile('assets/maps/core.png');
  h.app.metadataCache.getFirstLinkpathDest=(target,sourcePath)=>{assert.equal(target,'assets/maps/core.map.json');assert.equal(sourcePath,'Places/Map.md');return manifestFile;};
  h.app.vault.getAbstractFileByPath=target=>{assert.equal(target,'assets/maps/core.png');return image;};
  h.app.vault.read=async()=>JSON.stringify(manifest);h.app.vault.readBinary=async()=>bytes;
  const block='version: 2\nsource: "[[assets/maps/core.map.json]]"\ncrop: {x: 1100, y: 2100, width: 200, height: 200}\n';
  const config=await h.obsidianMapConfig(h.app,block,'Places/Map.md',new Map());assert.equal(config.version,2);assert.equal(config.crop.x,100);assert.equal(config.measurement.xScale,.6);
  await assert.rejects(h.obsidianMapConfig(h.app,block+'coordinateFrame: old-frame\n','Places/Map.md',new Map()),/Old coordinateFrame/);
  manifest.sourceOffset=[-1,0];await assert.rejects(h.obsidianMapConfig(h.app,block,'Places/Map.md',new Map()),/sourceOffset/);manifest.sourceOffset=[1000,2000];
  manifest.layers=['borders.map-layers.json'];
  const layerFile=new h.TFile('assets/maps/borders.map-layers.json');
  const layerData={version:1,layers:[{id:'realms',name:'Realms',regions:[{id:'one',name:'One',points:[[1000,2000],[1500,2000],[1200,2300]]}]}]};
  h.app.vault.getAbstractFileByPath=target=>target===image.path?image:target===layerFile.path?layerFile:null;
  h.app.vault.read=async file=>JSON.stringify(file===layerFile?layerData:manifest);
  const withLayers=await h.obsidianMapConfig(h.app,block,'Places/Map.md',new Map());
  assert.deepEqual(JSON.parse(JSON.stringify(withLayers.regionLayers[0].regions)),layerData.layers[0].regions);
  assert.deepEqual(JSON.parse(JSON.stringify(withLayers.sourceOffset)),[1000,2000]);
  manifest.layers=['missing.map-layers.json'];await assert.rejects(h.obsidianMapConfig(h.app,block,'Places/Map.md',new Map()),/layer file is missing/);delete manifest.layers;
  h.app.vault.readBinary=async()=>Buffer.from('changed');await assert.rejects(h.obsidianMapConfig(h.app,block,'Places/Map.md',new Map()),/PNG/);
});

test('Obsidian adapter resolves authored image links, hashes original bytes, caches per revision, and uses local resource URLs',async()=>{
  const h=host(),cache=new Map();
  const result=await h.obsidianMapConfig(h.app,source,'Places/Map.md',cache);
  assert.equal(result.image,'app://local/assets/local%20map.png');assert.equal(result.measurement.xScale,0.5);
  assert.equal(result.measurement.unit,'miles');
  assert.equal(await [...cache.values()][0],createHash('sha256').update(Buffer.from([1,2,3,4])).digest('hex'));
  await h.obsidianMapConfig(h.app,source,'Places/Map.md',cache);assert.equal(h.reads,1);
  h.file.stat.mtime++;await h.obsidianMapConfig(h.app,source,'Places/Map.md',cache);assert.equal(h.reads,2);
  h.file.stat.mtime++;h.fail=true;await assert.rejects(h.obsidianMapConfig(h.app,source,'Places/Map.md',cache),/read failed/);
  h.fail=false;await h.obsidianMapConfig(h.app,source,'Places/Map.md',cache);assert.equal(h.reads,4);
});

test('Taelgarverse keeps Images opt-in within the existing plugin and preserves existing settings',async()=>{
  for(const enabled of [undefined,true]){
    const h=host(),plugin=new h.default();plugin.app=h.app;plugin.savedData={legacyLeafletBlocks:true,...(enabled===undefined?{}:{imageViewer:enabled})};
    await plugin.onload();assert.equal(plugin.settings.imageViewer,enabled===true);
    assert.ok(plugin.commands.some(c=>c.id==='create-map-from-image' && typeof c.callback==='function'));
    assert.ok(plugin.commands.some(c=>c.id==='create-map-from-photoshop' && typeof c.callback==='function'));
    assert.equal(plugin.images.enabled,enabled===true);assert.equal(plugin.settings.legacyLeafletBlocks,true);
    assert.equal(plugin.settings.calendarEnabled,false);assert.equal(plugin.calendar.enabled,false);
    assert.deepEqual([...plugin.processors.keys()],['taelgar-map','leaflet','taelgar-index','taelgar-header','taelgar-interactions','taelgar-relationship']);plugin.unload();
  }
});

test('Obsidian reads calibration from the note block, applies edits without rebuilding, and checks the image fingerprint',async()=>{
  const h=host(),cache=new Map();
  const fingerprint=createHash('sha256').update(Buffer.from([1,2,3,4])).digest('hex');
  const block=source+'calibration:\n  hexMiles: 24\n  hexPixels: 40\n  imageSize: [400, 100]\n  imageSha256: '+fingerprint+'\n';
  const initial=await h.obsidianMapConfig(h.app,block,'Places/Map.md',cache);
  assert.equal(initial.measurement.xScale,1.2);assert.equal(initial.measurement.yScale,0.6);
  const edited=await h.obsidianMapConfig(h.app,block.replace('hexPixels: 40','hexPixels: 80'),'Places/Map.md',cache);
  assert.equal(edited.measurement.xScale,0.6);assert.equal(edited.measurement.yScale,0.3);assert.equal(h.reads,1);
  const changed=await h.obsidianMapConfig(h.app,block.replace(fingerprint,'a'.repeat(64)),'Places/Map.md',cache);
  assert.equal(changed.measurement,null);
});

test('Obsidian map components mount the shared controller and dispose observers and Leaflet state when notes unload',async()=>{
  const h=host(),plugin=new h.default();plugin.app=h.app;await plugin.onload();assert.equal(plugin.language,'taelgar-map');
  let child;
  plugin.processor(source,h.doc.createElement('div'),{sourcePath:'Places/Map.md',addChild(value){child=value;}});
  await child.onload();assert.equal(h.counts.maps,1);
  plugin.unload();assert.deepEqual(h.counts,{maps:1,removed:1,disconnected:1});assert.equal(plugin.children[0].hashes.size,0);assert.equal(plugin.children[0].maps.size,0);
});

test('an Obsidian note closed during image hashing never mounts a stale map',async()=>{
  const h=host(),plugin=new h.default();plugin.app=h.app;await plugin.onload();h.defer();
  let child;plugin.processor(source,h.doc.createElement('div'),{sourcePath:'Places/Map.md',addChild(value){child=value;}});
  const pending=child.onload();child.onunload();h.release();await pending;assert.equal(h.counts.maps,0);
});

test('Obsidian release bundle is self-contained except for the host API and has inline Leaflet icons',async()=>{
  const output=await buildObsidian(),main=await fs.readFile(path.join(output,'main.js'),'utf8');
  assert.doesNotThrow(()=>new vm.Script(main));assert.match(main,/require\("obsidian"\)/);assert.match(main,/Trace path/);assert.match(main,/def download_link/);assert.match(main,/def pixel_bounds/);assert.match(main,/psd-tools==1\.26\.0/);
  const styles=await fs.readFile(path.join(output,'styles.css'),'utf8');assert.doesNotMatch(styles,/url\(images\//);assert.match(styles,/data:image\/png;base64/);
  const manifest=JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8'));
  assert.equal(manifest.id,'taelgarverse');
  const provenance=JSON.parse(await fs.readFile(path.join(output,'release.json'),'utf8'));
  assert.equal(provenance.version,manifest.version);assert.equal(typeof provenance.sourceDirty,'boolean');
});

test('installer operates only on its plugin in a disposable fixture and preserves notes and other enabled plugins',async t=>{
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','obsidian-install-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.mkdir(path.join(directory,'.obsidian'));await fs.writeFile(path.join(directory,'Note.md'),'Original note');
  const list=path.join(directory,'.obsidian/community-plugins.json');await fs.writeFile(list,JSON.stringify(['dataview','customjs']));
  const installed=await installObsidian(directory,{enable:true});assert.equal(path.dirname(installed),path.join(directory,'.obsidian/plugins'));
  assert.deepEqual(JSON.parse(await fs.readFile(list,'utf8')),['dataview','customjs','taelgarverse']);
  assert.equal(await fs.readFile(path.join(directory,'Note.md'),'utf8'),'Original note');
  for(const file of ['main.js','styles.css','manifest.json'])assert.ok((await fs.stat(path.join(installed,file))).size>0);
});

test('Taelgarverse leaves leaflet blocks alone by default and declines legacy ownership when another renderer is enabled',async()=>{
  for(const other of ['obsidian-leaflet-plugin','obsidian-leaflet','taelgar-map-tools']){
    const h=host(),plugin=new h.default();plugin.app=h.app;
    plugin.app.plugins={enabledPlugins:new Set([other])};
    await plugin.onload();assert.deepEqual([...plugin.processors.keys()],['taelgar-map','taelgar-index','taelgar-header','taelgar-interactions','taelgar-relationship']);
    plugin.unload();
    plugin.savedData={legacyLeafletBlocks:true};await plugin.onload();
    assert.deepEqual([...plugin.processors.keys()],['taelgar-map','taelgar-index','taelgar-header','taelgar-interactions','taelgar-relationship']);
  }
  const h=host(),plugin=new h.default();plugin.app=h.app;plugin.savedData={legacyLeafletBlocks:true};
  await plugin.onload();assert.deepEqual([...plugin.processors.keys()],['taelgar-map','leaflet','taelgar-index','taelgar-header','taelgar-interactions','taelgar-relationship']);
});

test('local upgrade retires Map Tools, coexists with Leaflet, and preserves plugin settings and old files',async t=>{
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','obsidian-migration-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const config=path.join(directory,'.obsidian'),target=path.join(config,'plugins/taelgarverse');
  await fs.mkdir(target,{recursive:true});
  const old=path.join(config,'plugins/taelgar-map-tools');await fs.mkdir(old);
  await fs.writeFile(path.join(old,'main.js'),'old plugin');
  await fs.writeFile(path.join(target,'data.json'),'{"legacyLeafletBlocks":true}');
  const list=path.join(config,'community-plugins.json');
  await fs.writeFile(list,JSON.stringify(['dataview','taelgar-map-tools','obsidian-leaflet-plugin']));
  await installObsidian(directory,{enable:true});
  assert.deepEqual(JSON.parse(await fs.readFile(list,'utf8')),['dataview','obsidian-leaflet-plugin','taelgarverse']);
  assert.equal(await fs.readFile(path.join(target,'data.json'),'utf8'),'{"legacyLeafletBlocks":true}');
  assert.equal(await fs.readFile(path.join(old,'main.js'),'utf8'),'old plugin');
});
