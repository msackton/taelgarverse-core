import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {ROOT} from '../src/config.mjs';
const require=createRequire(import.meta.url);
const bundle=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/maps/view.mjs'],bundle:true,write:false,
  format:'cjs',platform:'node',external:['obsidian'],plugins:[{name:'host',setup(b){
    b.onResolve({filter:/map-view\.mjs$/},()=>({path:'test-renderer',external:true}));
    b.onResolve({filter:/\/tracing-image\.mjs$/},()=>({path:'test-tracing',external:true}));
    b.onResolve({filter:/\/regions\.mjs$/},()=>({path:'test-regions',external:true}));
    b.onResolve({filter:/\/paths\.mjs$/},()=>({path:'test-paths',external:true}));
    b.onResolve({filter:/\/towns\.mjs$/},()=>({path:'test-towns',external:true}));
  }}]});
const plain=value=>JSON.parse(JSON.stringify(value));
function host(){
  const {document}=parseHTML('<main></main>'),renders=[],placements=[],leaves=[],revealed=[];
  class TFile {constructor(path){this.path=path;}}
  const manifestFile=new TFile('assets/core.map.json'),imageFile=new TFile('assets/core.png'),noteFile=new TFile('Map.md');
  const block={version:2,source:'assets/core.map.json',crop:{x:5100,y:7100,width:100,height:100},overlays:[{retired:'mask'}]};
  let note='Prose\n\n'+String.fromCharCode(96).repeat(3)+'taelgar-map\n'+JSON.stringify(block)+'\n'+String.fromCharCode(96).repeat(3),delay;
  const png=new Uint8Array(33),bytes=new DataView(png.buffer);
  for(const [offset,value] of [[0,0x89504e47],[4,0x0d0a1a0a],[12,0x49484452],[16,1000],[20,800]])bytes.setUint32(offset,value);
  const app={vault:{getAbstractFileByPath:path=>[imageFile,noteFile].find(f=>f.path===path),getResourcePath:()=> 'app://core.png',
    readBinary:async()=>png.buffer,read:async file=>{if(delay)await delay;return file===noteFile?note:JSON.stringify({version:2,image:'core.png',sourceOffset:[5000,7000]});}},
    metadataCache:{getFirstLinkpathDest:()=>manifestFile},
    workspace:{getLeavesOfType:()=>[],getLeaf:()=>{const leaf={app,async setViewState(state){this.savedState=state;this.view=new api.MapEditorView(this,feature);this.view.onOpen();await this.view.setState(state.state,{});}};leaves.push(leaf);return leaf;},
      revealLeaf:async leaf=>revealed.push(leaf)}};
  class ItemView {constructor(leaf){this.leaf=leaf;this.app=leaf.app;this.contentEl=document.createElement('main');}async setState(){}}
  const module={exports:{}};
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,structuredClone,console,
    require:name=>name==='obsidian'?{ItemView,TFile}:name==='test-renderer'?{mountMap:(figure,options)=>{
      const row={config:JSON.parse(figure.dataset.map),figure,disposed:false};renders.push(row);
      const decoration=options?.decorate?.({config:row.config,canvas:figure.querySelector('.map-canvas')});
      return ()=>{row.disposed=true;decoration?.();};
    }}:name==='test-paths'?{mountNotePaths:()=>()=>{}}:name==='test-tracing'?{mountTracingImage:()=>()=>{}}:name==='test-regions'?{mountRegionEditor:()=>()=>{}}:name==='test-towns'?{mountTownPlacement:options=>{placements.push(options);const dispose=()=>{};dispose.updateNote=()=>{};return dispose;}}:require(name)});
  const api=module.exports,feature={app,active:true,editors:new Set(),maps:new Set()};
  return {api,app,feature,document,renders,placements,leaves,revealed,block,get note(){return note;},set delay(value){delay=value;}};
}

test('opening a cropped embed creates a full-source editor tab without changing its note',async()=>{
  const h=host(),before=h.note;
  const view=await h.api.openMapEditor(h.feature,'Map.md',{source:JSON.stringify(h.block)});
  assert.equal(h.leaves.length,1);assert.equal(h.leaves[0].savedState.type,'taelgar-map-editor');
  assert.deepEqual(plain(view.getState()),{source:'assets/core.map.json',sourcePath:'Map.md'});
  assert.deepEqual(h.renders[0].config.crop,{x:0,y:0,width:1000,height:800});
  assert.equal(h.renders[0].config.overlays,undefined);
  assert.equal(h.placements[0].editable,true);
  assert.equal(h.note,before);
  assert.equal(view.contentEl.querySelectorAll('input,select').length,0,'no old mask/crop inspector');
  const again=await h.api.openMapEditor(h.feature,'Map.md',{source:JSON.stringify(h.block)});
  assert.equal(again,view);assert.equal(h.renders.length,1,'reopening keeps the editor and town draft');
  view.onClose();assert.equal(h.renders[0].disposed,true);assert.equal(h.feature.editors.size,0);
});

test('editor tabs restore their source and cancel asynchronous rendering after close',async()=>{
  const h=host(),leaf={app:h.app},view=new h.api.MapEditorView(leaf,h.feature);view.onOpen();
  await view.setState({source:'assets/core.map.json',sourcePath:'Map.md'},{});
  assert.equal(h.renders.length,1);assert.deepEqual(h.renders[0].config.bounds,[[0,0],[800,1000]]);
  let release;h.delay=new Promise(resolve=>{release=resolve;});
  const pending=view.setState(view.getState(),{});view.onClose();release();await pending;
  assert.equal(h.renders.length,1,'a closed tab cannot mount after an awaited source read');
  assert.equal(h.renders[0].disposed,true);
});
