import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {ROOT} from '../src/config.mjs';

const bundle=await build({absWorkingDir:ROOT,entryPoints:['src/browser/map-view.mjs'],bundle:true,write:false,format:'cjs',platform:'node',external:['leaflet'],
  plugins:[{name:'presentation-fixtures',setup(builder){builder.onResolve({filter:/map-(baseline|measurement)\.mjs$/},args=>({path:args.path.includes('baseline')?'baseline':'measurement',external:true}));}}]});
const config={version:2,image:'map.png',bounds:[[0,0],[1000,1000]],crop:{x:200,y:100,width:200,height:200},
  minZoom:-5,maxZoom:3,fitBounds:true,measurement:null};
function setup(value=config){
  const {document}=parseHTML('<figure><div class="map-canvas"></div><figcaption><span class="map-status"></span></figcaption></figure>');
  const figure=document.querySelector('figure'),canvas=figure.querySelector('.map-canvas');figure.dataset.map=JSON.stringify(value);
  Object.assign(canvas,{clientWidth:640,clientHeight:400});
  const maps=[],images=[],baselines=[],measurements=[];let observer;
  const bounds=points=>({points,pad(){return this;},getEast:()=>points[1][1],getWest:()=>points[0][1],getNorth:()=>points[1][0],getSouth:()=>points[0][0],getCenter:()=>({lat:(points[0][0]+points[1][0])/2,lng:(points[0][1]+points[1][1])/2})});
  const L={CRS:{Simple:{}},latLngBounds:bounds,map:(canvas,options)=>{const map={options,on(){},off(){},invalidateSize(){},setMinZoom(value){this.minZoom=value;},fitBounds(value){this.fitted=value;},setView(){},setMaxBounds(value){this.maxBounds=value;},remove(){this.removed=true;}};maps.push(map);return map;},
    imageOverlay:(url,bounds)=>{const image={url,bounds,element:document.createElement('img'),on(){return this;},addTo(){return this;},getElement(){return this.element;}};images.push(image);return image;}};
  const presentation=list=>(...args)=>{const item={args,disposed:false};list.push(item);return ()=>{item.disposed=true;};};
  const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,console,
    require:name=>name==='leaflet'?L:name==='baseline'?{addMapBaseline:presentation(baselines),cropInset:()=>''}:{addMeasurement:presentation(measurements)},
    ResizeObserver:class{constructor(fn){observer=this;this.resize=fn;}observe(){}disconnect(){this.disconnected=true;}}});
  const dispose=module.exports.mountMap(figure);
  return {dispose,figure,canvas,maps,images,baselines,measurements,observer};
}

test('cropped views fit the rectangle and limit zoom-out; geometry updates retain map and imagery',()=>{
  const h=setup(),map=h.maps[0];assert.equal(map.options.maxBoundsViscosity,1);assert.equal(map.minZoom,1);assert.equal(map.options.zoomSnap,.25);
  assert.deepEqual(JSON.parse(JSON.stringify(map.fitted.points)),[[700,200],[900,400]]);
  const next=structuredClone(config);next.crop={x:100,y:100,width:500,height:500};
  h.dispose.update(next);assert.equal(h.maps.length,1);assert.equal(h.images.length,1);assert.equal(map.minZoom,-.5);
  assert.deepEqual(JSON.parse(JSON.stringify(map.maxBounds.points)),[[400,100],[900,600]]);assert.equal(h.baselines[0].disposed,true);assert.equal(h.measurements[0].disposed,true);
  const fitted=map.fitted;h.dispose.update({...next,grid:{visible:true}});assert.equal(map.fitted,fitted,'style/grid changes preserve the camera');
  h.canvas.clientWidth=200;h.observer.resize();assert.equal(map.minZoom,-1.5);
  assert.throws(()=>h.dispose.update({...next,image:'other.png'}),/same source/);assert.equal(map.removed,undefined);
  h.dispose();assert.equal(map.removed,true);assert.equal(h.observer.disconnected,true);assert.ok(h.baselines.every(b=>b.disposed));
});

test('legacy maps retain their authored zoom-out range',()=>{
  const h=setup({...config,version:undefined});assert.equal(h.maps[0].minZoom,-5);assert.equal(h.maps[0].options.maxBoundsViscosity,.8);h.dispose();
});
