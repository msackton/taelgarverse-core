import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {validateMapLayers,resolvedMapLayers} from '../src/map-layers.mjs';
import {validateManifest,validateMapDefinition} from '../src/map-core.mjs';
import {addMapRegions} from '../src/browser/map-regions.mjs';
import {saveMapLayerDocument} from '../obsidian/taelgarverse/maps/region-persistence.mjs';
import {mountRegionEditor} from '../obsidian/taelgarverse/maps/regions.mjs';
const data=()=>({version:1,layers:[{id:'realms',name:'Realms',regions:[{id:'one',name:'Realm <One>',points:[[5000,7000],[5400,7000],[5200,7400]],color:'#123456',note:'Places/One.md'}]}]});

test('region geometry rejects crossing, degenerate, duplicate and unbounded vertices and unsafe metadata',()=>{
  assert.equal(validateMapLayers(data()).layers.length,1);
  for(const points of [[[0,0],[10,10],[0,10],[10,0]],[[1,1],[2,2],[3,3]],[[0,0],[10,0],[10,10],[0,0]],[[0,0],[-1,10],[10,10]]]){
    const d=data();d.layers[0].regions[0].points=points;assert.throws(()=>validateMapLayers(d));
  }
  for(const patch of [{color:'red;url(x)'},{fillOpacity:2},{width:Infinity},{note:'javascript:alert(1)'}]){
    const d=data();Object.assign(d.layers[0].regions[0],patch);assert.throws(()=>validateMapLayers(d));
  }
  const d=data();d.layers.push(d.layers[0]);assert.throws(()=>validateMapLayers(d),/unique/);
  for(const layers of [['../private.map-layers.json'],['/a.map-layers.json'],['x.json'],['x.map-layers.json','x.map-layers.json']])
    assert.throws(()=>validateManifest({version:2,image:'a.png',sourceOffset:[0,0],layers}));
});

test('borders keep source coordinates, clip without crop-edge strokes, escape labels and preserve per-view toggles',()=>{
  const {document,window}=parseHTML('<figure><div></div><figcaption></figcaption></figure>'),figure=document.querySelector('figure'),overlays=[];
  const L={svgOverlay:(svg,bounds)=>{const item={svg,bounds,addTo(){overlays.push(this);return this;},remove(){this.removed=true;}};return item;}};
  const config={bounds:[[0,0],[800,1000]],crop:{x:100,y:100,width:200,height:200},sourceOffset:[5000,7000],regionLayers:resolvedMapLayers([{path:'borders.map-layers.json',data:data()}])};
  const api=addMapRegions(L,{},figure.querySelector('div'),figure,config);
  assert.equal(figure.querySelectorAll('input').length,0,'no toggles without per-map opt-in');
  config.regionLayers=config.regionLayers.map(layer=>({...layer,toggleable:true}));api.update(config);overlays.shift();
  assert.equal(overlays[0].svg.querySelector('polygon').getAttribute('points'),'0,0 400,0 200,400');
  assert.match(overlays[0].svg.style.clipPath,/inset/);assert.equal(overlays[0].svg.querySelectorAll('one').length,0);
  const toggle=figure.querySelector('input');toggle.checked=false;toggle.dispatchEvent(new window.Event('change'));
  assert.equal(overlays[0].svg.querySelector('g').style.display,'none');
  api.update({...config,sourceOffset:[4900,6900]});
  assert.equal(overlays[1].svg.querySelector('polygon').getAttribute('points'),'100,100 500,100 300,500');
  assert.equal(overlays[1].svg.querySelector('g').style.display,'none');api();assert.ok(overlays[1].removed);
});

function vault(){
  const files=new Map([['core.map.json',JSON.stringify({version:2,image:'core.png',sourceOffset:[5000,7000]})]]);
  const app={vault:{getAbstractFileByPath:path=>files.has(path)?{path}:null,
    async create(path,text){assert.ok(!files.has(path));files.set(path,text);},async process(file,fn){files.set(file.path,fn(files.get(file.path)));}}};
  return {app,files};
}
test('first save attaches a reusable file; later saves guard conflicts and never rewrite the manifest',async()=>{
  const {app,files}=vault(),manifest=JSON.parse(files.get('core.map.json'));
  const saved=await saveMapLayerDocument(app,{manifestPath:'core.map.json',manifest,data:data()});
  assert.equal(JSON.parse(files.get('core.map.json')).layers[0],saved.path);
  const before=files.get('core.map.json'),changed=data();changed.layers[0].regions[0].name='Edited';
  const result=await saveMapLayerDocument(app,{manifestPath:'core.map.json',manifest,document:saved,data:changed});
  assert.equal(files.get('core.map.json'),before);assert.equal(result.data.layers[0].regions[0].name,'Edited');
  await assert.rejects(saveMapLayerDocument(app,{manifestPath:'core.map.json',manifest,document:saved,data:data()}),/changed elsewhere/);
  assert.equal(files.get(saved.path),result.text);
  await assert.rejects(saveMapLayerDocument(app,{manifestPath:'core.map.json',manifest,document:result,data:data(),isOpen:()=>false}),/closed/);
});

test('failed manifest attachment preserves the new file and identifies its recovery path',async()=>{
  const {app,files}=vault();app.vault.process=async()=>{throw new Error('Conflict');};
  await assert.rejects(saveMapLayerDocument(app,{manifestPath:'core.map.json',manifest:{},data:data()}),/saved layer file remains at .*map-layers.json/);
  assert.equal(files.size,2);assert.equal(JSON.parse(files.get('core.map.json')).layers,undefined);
});

function editor(){
  const {document,window}=parseHTML('<figure><div class="map-canvas"></div><figcaption></figcaption></figure>');
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.selected)?.value??this.options[0]?.value??'';},set(value){for(const o of this.options)o.removeAttribute('selected');const target=[...this.options].find(o=>o.value===String(value));if(target)target.selected=true;}});
  const {app,files}=vault(),figure=document.querySelector('figure'),canvas=document.querySelector('div'),handlers={};let saved;
  const map={on:(name,fn)=>handlers[name]=fn,off:name=>delete handlers[name],getCenter:()=>({lng:100,lat:600})};
  const L={layerGroup:()=>({addTo(){return this;},clearLayers(){},remove(){}}),polyline:()=>({addTo(){}}),circleMarker:()=>({addTo(){}})};
  const api=mountRegionEditor({L,map,canvas,figure,app,manifestPath:'core.map.json',manifest:{version:2,image:'core.png',sourceOffset:[5000,7000],width:1000,height:800},onSaved:value=>{saved=value;}});
  const click=label=>{const button=[...figure.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button);button.click();};
  const input=name=>figure.querySelector('[aria-label="'+name+'"]');
  const pick=(x,y)=>handlers.click({latlng:{lng:x,lat:800-y}});
  return {api,files,figure,canvas,click,input,pick,get saved(){return saved;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('editor saves exact points, supports vertex edits, cancellation and confirmed deletion',async()=>{
  const h=editor();h.click('Draw region');h.input('Region name').value='Test realm';
  h.pick(10,10);h.pick(200,10);h.pick(100,200);h.click('Save region');await settle();
  assert.deepEqual(h.saved[0].regions[0].points,[[5010,7010],[5200,7010],[5100,7200]]);
  assert.equal(h.canvas.classList.contains('map-editing'),false);
  h.input('Layer').value='0';h.input('Layer').dispatchEvent(new h.figure.ownerDocument.defaultView.Event('change'));
  h.click('Edit region');h.input('Vertex').value='1';h.pick(250,15);h.click('Cancel region');
  assert.deepEqual(h.saved[0].regions[0].points[1],[5200,7010]);
  h.click('Edit region');h.input('Vertex').value='1';h.pick(250,15);h.click('Save region');await settle();
  assert.deepEqual(h.saved[0].regions[0].points[1],[5250,7015]);
  h.click('Edit region');h.click('Delete region');assert.equal(h.saved[0].regions.length,1);
  h.click('Confirm deletion');await settle();assert.equal(h.saved[0].regions.length,0);h.api();
});
test('editor blocks concurrent tools, retains invalid drafts and cancellation does not write',async()=>{
  const h=editor();h.canvas.classList.add('map-measuring');h.click('Draw region');assert.equal(h.canvas.classList.contains('map-editing-region'),false);
  h.canvas.classList.remove('map-measuring');h.click('Draw region');h.input('Region name').value='Broken';h.pick(10,10);h.pick(20,20);h.pick(30,30);
  h.click('Save region');await settle();assert.match(h.figure.querySelector('.map-region-status').textContent,/enclose/);assert.ok(h.canvas.classList.contains('map-editing-region'));
  h.click('Cancel region');assert.equal(h.files.size,1);h.api();
});


test('each map opts into layer toggles independently; ambiguous and missing selections fail',()=>{
  const regionLayers=resolvedMapLayers([{path:'borders.map-layers.json',data:data()}]);
  const manifest={version:2,image:'core.png',sourceOffset:[5000,7000],width:1000,height:800,regionLayers};
  const block={version:2,source:'core.map.json'};
  assert.equal(validateMapDefinition(block,manifest).regionLayers[0].toggleable,false);
  assert.equal(validateMapDefinition({...block,toggleableLayers:['realms']},manifest).regionLayers[0].toggleable,true);
  assert.equal(validateMapDefinition(block,manifest).regionLayers[0].toggleable,false,'another embed stays fixed');
  assert.equal(regionLayers[0].toggleable,undefined,'shared definitions stay unchanged');
  for(const toggleableLayers of [true,'realms',['missing'],['realms','realms']])assert.throws(()=>validateMapDefinition({...block,toggleableLayers},manifest));
  const duplicate={...manifest,regionLayers:[...regionLayers,...resolvedMapLayers([{path:'other.map-layers.json',data:data()}])]};
  assert.throws(()=>validateMapDefinition({...block,toggleableLayers:['realms']},duplicate),/ambiguous/);
  assert.deepEqual(validateMapDefinition({...block,toggleableLayers:['borders.map-layers.json#realms']},duplicate).regionLayers.map(l=>l.toggleable),[true,false]);
});
