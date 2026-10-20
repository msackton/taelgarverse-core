import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {buildObsidianMaps} from '../scripts/build-obsidian-maps.mjs';
import {installObsidianMaps} from '../scripts/install-obsidian-maps.mjs';
import {ROOT} from '../src/config.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgar-map-tools/main.mjs'],write:false,bundle:true,
  platform:'node',format:'cjs',external:['obsidian','leaflet'],logLevel:'silent'});

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
  class Plugin {registerMarkdownCodeBlockProcessor(language,processor){this.language=language;this.processor=processor;}}
  class MarkdownRenderChild {constructor(container){this.containerEl=container;}unload(){this.onunload();}}
  const handler=()=>({enabled:()=>true,disable(){},enable(){}});
  const L={CRS:{Simple:{}},latLngBounds(points){return {pad(){return this;},getEast:()=>points[1][1],getWest:()=>points[0][1],getNorth:()=>points[1][0],getSouth:()=>points[0][0],getCenter:()=>({lat:50,lng:50})};},
    map(){maps++;return {invalidateSize(){},setMinZoom(){},setView(){},fitBounds(){},on(){},off(){},remove(){removed++;},doubleClickZoom:handler(),dragging:handler(),touchZoom:handler(),boxZoom:handler()};},
    imageOverlay(){return {on(){return this;},addTo(){return this;}};},layerGroup(){return {addTo(){return this;},clearLayers(){}};}};
  const module={exports:{}},context={module,exports:module.exports,Buffer,TextDecoder,TextEncoder,console,
    ResizeObserver:class{observe(){}disconnect(){disconnected++;}},
    require:name=>name==='obsidian'?{Plugin,MarkdownRenderChild,TFile}:name==='leaflet'?L:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,context);
  const file=new TFile('assets/local map.png');let reads=0,fail=false,resolve;
  const app={metadataCache:{getFirstLinkpathDest:(image,source)=>{assert.equal(image,'local map.png');assert.equal(source,'Places/Map.md');return file;}},
    vault:{readBinary:async()=>{reads++;if(fail)throw new Error('read failed');if(resolve)return await new Promise(r=>{resolve=r;});return Uint8Array.from([1,2,3,4]).buffer;},getResourcePath:()=> 'app://local/assets/local%20map.png'}};
  return {...module.exports,doc,app,file,get reads(){return reads;},set fail(value){fail=value;},
    defer(){resolve=true;},release(){resolve(Uint8Array.from([1,2,3,4]).buffer);},get counts(){return {maps,removed,disconnected};}};
}
const source='image: [[local map.png]]\nbounds: [[0,0],[100,200]]\nunit: miles\nscale: 0.5\n';

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

test('Obsidian map components mount the shared controller and dispose observers and Leaflet state when notes unload',async()=>{
  const h=host(),plugin=new h.default();plugin.app=h.app;plugin.onload();assert.equal(plugin.language,'leaflet');
  let child;
  plugin.processor(source,h.doc.createElement('div'),{sourcePath:'Places/Map.md',addChild(value){child=value;}});
  await child.onload();assert.equal(h.counts.maps,1);
  plugin.onunload();assert.deepEqual(h.counts,{maps:1,removed:1,disconnected:1});assert.equal(plugin.hashes.size,0);assert.equal(plugin.maps.size,0);
});

test('an Obsidian note closed during image hashing never mounts a stale map',async()=>{
  const h=host(),plugin=new h.default();plugin.app=h.app;plugin.onload();h.defer();
  let child;plugin.processor(source,h.doc.createElement('div'),{sourcePath:'Places/Map.md',addChild(value){child=value;}});
  const pending=child.onload();child.onunload();h.release();await pending;assert.equal(h.counts.maps,0);
});

test('Obsidian release bundle is self-contained except for the host API and has inline Leaflet icons',async()=>{
  const output=await buildObsidianMaps(),main=await fs.readFile(path.join(output,'main.js'),'utf8');
  assert.doesNotThrow(()=>new vm.Script(main));assert.match(main,/require\("obsidian"\)/);assert.match(main,/Trace path/);
  const styles=await fs.readFile(path.join(output,'styles.css'),'utf8');assert.doesNotMatch(styles,/url\(images\//);assert.match(styles,/data:image\/png;base64/);
  assert.equal(JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8')).id,'taelgar-map-tools');
});

test('installer operates only on its plugin in a disposable fixture and preserves notes and other enabled plugins',async t=>{
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','obsidian-install-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.mkdir(path.join(directory,'.obsidian'));await fs.writeFile(path.join(directory,'Note.md'),'Original note');
  const list=path.join(directory,'.obsidian/community-plugins.json');await fs.writeFile(list,JSON.stringify(['dataview','customjs']));
  const installed=await installObsidianMaps(directory,{enable:true});assert.equal(path.dirname(installed),path.join(directory,'.obsidian/plugins'));
  assert.deepEqual(JSON.parse(await fs.readFile(list,'utf8')),['dataview','customjs','taelgar-map-tools']);
  assert.equal(await fs.readFile(path.join(directory,'Note.md'),'utf8'),'Original note');
  for(const file of ['main.js','styles.css','manifest.json'])assert.ok((await fs.stat(path.join(installed,file))).size>0);
});
