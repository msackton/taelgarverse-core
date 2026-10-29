import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {captureMapBlock} from '../src/map-block.mjs';
import {ROOT} from '../src/config.mjs';
const require=createRequire(import.meta.url);
const bundle=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/maps/detail-editor.mjs'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']});
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
function setup(){
  const {document,window}=parseHTML('<body><figure><div></div><figcaption></figcaption></figure></body>'),figure=document.querySelector('figure'),canvas=figure.querySelector('div');
  class TFile{constructor(path){this.path=path;}}
  const files=new Map(['Map.md','assets/detail.map-detail.json','assets/detail.png'].map(p=>[p,new TFile(p)]));
  const block={version:2,source:'assets/core.map.json',crop:{x:5100,y:7100,width:100,height:100},grid:{visible:true}};
  let note='Before\n\n```taelgar-map\n# Keep this comment\n'+JSON.stringify(block)+'\n```\n\nAfter';
  const manifest={version:2,image:'core.png',width:1000,height:800,sourceOffset:[5000,7000]};
  const detail={version:1,name:'Detail',image:'detail.png',worldBounds:{x:5100,y:7100,width:100,height:100},pixelSize:[800,800],fadeZoom:[0,2]};
  const png=new ArrayBuffer(33),header=new DataView(png);for(const [index,value] of [[0,0x89504e47],[4,0x0d0a1a0a],[12,0x49484452],[16,800],[20,800]])header.setUint32(index,value);
  const app={vault:{getAbstractFileByPath:p=>files.get(p),read:async file=>file.path==='Map.md'?note:JSON.stringify(detail),readBinary:async()=>png,getResourcePath:()=> 'app://detail.png',process:async(file,fn)=>{note=fn(note);}},workspace:{getLeavesOfType:()=>[]}};
  const events=new Map(),outlines=[],previews=[],saved=[],exports=[],blobs=[];
  const map={on:(name,fn)=>events.set(name,fn),off:name=>events.delete(name)};
  const L={rectangle:(bounds,options)=>{const layer={bounds,options,addTo(){outlines.push(this);return this;},remove(){this.removed=true;}};return layer;}};
  window.Blob=Blob;window.URL={createObjectURL:blob=>{blobs.push(blob);return 'blob:'+blobs.length;},revokeObjectURL:()=>{}};
  const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,structuredClone,crypto,console,require:name=>name==='obsidian'?{TFile}:require(name)});
  const dispose=module.exports.mountDetailEditor({L,map,canvas,figure,manifest,manifestPath:'assets/core.map.json',app,block,
    session:{path:'Map.md',guard:captureMapBlock(note,{source:'# Keep this comment\n'+JSON.stringify(block)})},
    onSaved:(result,previous)=>saved.push({result,previous}),onPreview:value=>previews.push(value),exportGuide:async(...args)=>{exports.push(args[3]);return new Blob(['PNG']);}});
  const input=name=>figure.querySelector('[aria-label="'+name+'"]'),click=name=>[...figure.querySelectorAll('button')].find(b=>b.textContent===name).click();
  return {dispose,figure,canvas,events,input,click,outlines,previews,saved,exports,blobs,get note(){return note;},set note(value){note=value;}};
}
test('template corner selection uses original world coordinates and leaves notes untouched',async()=>{
  const h=setup(),before=h.note;h.click('Select two corners');assert.ok(h.canvas.classList.contains('map-editing'));
  h.events.get('click')({latlng:{lat:700,lng:100}});h.events.get('click')({latlng:{lat:500,lng:400}});
  assert.equal(h.input('Region x').value,'5100');assert.equal(h.input('Region y').value,'7100');assert.equal(h.input('Region width').value,'300');
  assert.ok(!h.canvas.classList.contains('map-editing'));assert.equal(h.note,before);
  h.click('Export tracing guide PNG');await settle();assert.equal(h.exports.length,1);assert.deepEqual([...h.exports[0].pixelSize],[2400,1600]);assert.equal(h.note,before);
  h.click('Export regional manifest');assert.equal(h.blobs.length,2);assert.equal(JSON.parse(await h.blobs[1].text()).worldBounds.x,5100);
  h.dispose();assert.equal(h.events.size,0);
});
test('artwork attachment saves only the selected block, previews immediately, and removes references without deleting files',async()=>{
  const h=setup();h.input('Regional manifest path').value='assets/detail.map-detail.json';h.click('Add artwork to this map');await settle();
  assert.equal(h.saved.length,1);assert.match(h.note,/# Keep this comment/);assert.match(h.note,/Before/);assert.match(h.note,/After/);
  assert.equal(h.saved[0].result.block.details[0],'assets/detail.map-detail.json');assert.equal(h.previews[0][0].image,'app://detail.png');
  assert.deepEqual(JSON.parse(JSON.stringify(h.saved[0].result.block.crop)),{x:5100,y:7100,width:100,height:100});
  // Linkedom does not choose the first option automatically like a browser.
  Object.defineProperty(h.input('Attached regional artwork'),'value',{configurable:true,value:'assets/detail.map-detail.json'});
  h.click('Remove artwork from this map');await settle();assert.equal(h.saved.length,2);assert.equal(h.previews[1].length,0);h.dispose();
});
test('changed blocks and unsafe or missing references retain the note and do not attach artwork',async()=>{
  const h=setup();h.input('Regional manifest path').value='../detail.map-detail.json';h.click('Add artwork to this map');await settle();assert.equal(h.saved.length,0);
  h.input('Regional manifest path').value='assets/detail.map-detail.json';h.note=h.note.replace('"visible":true','"visible":false');const before=h.note;
  h.click('Add artwork to this map');await settle();assert.equal(h.note,before);assert.equal(h.previews.length,0);assert.match(h.figure.textContent,/changed or is ambiguous/);h.dispose();
});
