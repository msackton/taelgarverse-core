import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {validateDetailManifest,detailSources,resolveDetailManifest,regionalTemplate,detailRectangle,detailOpacity} from '../src/map-details.mjs';
import {addMapDetails} from '../src/browser/map-details.mjs';
import {baselineViewConfig} from '../src/map-block.mjs';
const detail={version:1,name:'Aveil',image:'aveil.png',worldBounds:{x:5100,y:7200,width:600,height:400},pixelSize:[4800,3200],fadeZoom:[0,2]};
test('regional art preserves a uniform world footprint independently of raster resolution',()=>{
  assert.deepEqual(regionalTemplate({name:'Aveil',image:'aveil.png',worldBounds:detail.worldBounds}),detail);
  assert.deepEqual(detailRectangle(detail,[5000,7000]),{x:100,y:200,width:600,height:400});
  assert.equal(resolveDetailManifest(detail,{width:4800,height:3200},'app://art').image,'app://art');
  assert.throws(()=>resolveDetailManifest(detail,{width:4799,height:3200},''),/dimensions/);
  const manifest={version:2,image:'world.png',sourceOffset:[5000,7000],width:2000,height:1500,detailLayers:[detail]};
  const base=baselineViewConfig({version:2,source:'world.map.json'},manifest,'world.png');
  assert.equal(base.detailLayers,undefined,'artwork requires per-map opt-in');
  const enabled=baselineViewConfig({version:2,source:'world.map.json',details:['assets/aveil.map-detail.json']},manifest,'world.png');
  assert.deepEqual(enabled.detailLayers,[detail]);assert.deepEqual(enabled.measurement,base.measurement);assert.deepEqual(enabled.bounds,base.bounds);
  assert.deepEqual([-2,0,1,2,4].map(z=>detailOpacity(z,[0,2])),[0,0,.5,1,1]);
});
test('regional manifests reject distorted, oversized, unsafe and ambiguous inputs',()=>{
  for(const patch of [{version:2},{name:''},{image:'../art.png'},{image:'https://host/art.png'},{pixelSize:[4800,3100]},
    {pixelSize:[24000,16000]},{pixelSize:[12000,8000]},{worldBounds:{...detail.worldBounds,x:-1}},
    {worldBounds:{...detail.worldBounds,y:99999}},{fadeZoom:[2,1]},{fadeZoom:[0,Infinity]},{extra:true}])assert.throws(()=>validateDetailManifest({...detail,...patch}));
  for(const value of [['/a.map-detail.json'],['../a.map-detail.json'],['a.map-detail.json','a.map-detail.json'],['https://host/a.map-detail.json'],['a.map.json'],['.private/a.map-detail.json'],'a.map-detail.json'])assert.throws(()=>detailSources(value));
});
function setup(){
  const {document,window}=parseHTML('<figure><div></div><figcaption></figcaption></figure>');
  const figure=document.querySelector('figure'),layers=[],events=new Map(),frames=new Map();let zoom=-2,id=0,view={x:0,y:0,width:2000,height:1500};
  window.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
  const map={createPane:()=>document.createElement('div'),on:(name,fn)=>events.set(name,fn),off:name=>events.delete(name),getZoom:()=>zoom,
    getBounds:()=>({getNorth:()=>1500-view.y,getSouth:()=>1500-view.y-view.height,getWest:()=>view.x,getEast:()=>view.x+view.width}),fitBounds:value=>{map.fitted=value;}};
  const L={imageOverlay:(url,bounds,options)=>{const handlers={},element=document.createElement('img');const layer={url,bounds,options,opacity:options.opacity,
    on(name,fn){handlers[name]=fn;return this;},off(){for(const name of Object.keys(handlers))delete handlers[name];},addTo(){layers.push(this);return this;},
    getElement:()=>element,setOpacity(value){this.opacity=value;},remove(){this.removed=true;},fire:name=>handlers[name]?.()};return layer;}};
  const config={bounds:[[0,0],[1500,2000]],crop:{x:200,y:100,width:500,height:500},sourceOffset:[5000,7000],detailLayers:[detail]};
  const dispose=addMapDetails(L,map,figure.querySelector('div'),figure,config);
  return {figure,layers,map,config,dispose,window,frames,change(z,v){zoom=z;view=v??view;events.get('zoom moveend resize')?.();for(const fn of frames.values())fn();frames.clear();}};
}
test('detail images load near zoom and viewport, fade, crop, release, and retain world fallback on errors',()=>{
  const h=setup();assert.equal(h.layers.length,0);assert.equal(h.figure.querySelectorAll('input[type="checkbox"]').length,0);
  h.change(-.5);const layer=h.layers[0];assert.equal(layer.opacity,0);assert.equal(layer.options.interactive,false);
  assert.deepEqual(layer.bounds,[[900,100],[1300,700]]);assert.equal(layer.getElement().style.clipPath,'inset(0% 0% 0% 16.666666666666664%)');
  layer.fire('load');h.change(1);assert.equal(layer.opacity,.5);h.change(3);assert.equal(layer.opacity,1);
  h.change(3,{x:1000,y:1000,width:100,height:100});assert.equal(layer.removed,true);
  h.change(1,{x:0,y:0,width:1000,height:1000});assert.equal(h.layers.length,2);h.layers[1].fire('error');
  assert.match(h.figure.textContent,/Could not load Aveil; showing world artwork/);h.change(2);assert.equal(h.layers.length,2,'failed images do not retry every frame');
  h.dispose.update({...h.config,detailLayers:[detail,{...detail,name:'Nested'}]});assert.equal(h.layers.length,4);
  assert.ok(h.layers[2].options.zIndex<h.layers[3].options.zIndex,'overlap order follows authored list, not download order');
  h.dispose();assert.equal(h.figure.querySelector('.map-detail-controls'),null);assert.equal(h.frames.size,0);
});
