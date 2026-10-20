import test from 'node:test';
import assert from 'node:assert/strict';
import {routeDistance,formatDistance,measurementOptions} from '../src/map-distance.mjs';
import {MAP_CALIBRATIONS,HEX_GRID} from '../src/map-calibrations.mjs';
import {addMeasurement} from '../src/browser/map-measurement.mjs';

test('planar measurement uses calibration once for every segment, regardless of coordinate origin',()=>{
  const points=[{lat:1000,lng:-200},{lat:1003,lng:-196},{lat:1003,lng:-186}];
  assert.equal(routeDistance(points),15);
  assert.equal(routeDistance(points,{xScale:0.5,yScale:0.5}),7.5);
  assert.equal(routeDistance(points,{xScale:0.6,yScale:0.6}),9);
  assert.equal(routeDistance([]),0);assert.equal(routeDistance(points.slice(0,1)),0);
  assert.match(formatDistance(7.5,'miles'),/7[.,]5 miles/);
});

test('every calibrated export measures one hex as 24 miles on either axis and between diagonal neighbors despite stretched bounds',()=>{
  for(const calibration of MAP_CALIBRATIONS){
    for(const bounds of [[[0,0],[953,1042]],[[-900,200],[1180,5900]]]){
      const options=measurementOptions({scale:999,unit:'wrong'},calibration,bounds);
      const position=(x,y)=>({lng:bounds[0][1]+x/calibration.width*(bounds[1][1]-bounds[0][1]),
        lat:bounds[0][0]+y/calibration.height*(bounds[1][0]-bounds[0][0])});
      const hexPixels=HEX_GRID.pixelsAcross/calibration.referenceScale,start=position(60,60);
      for(const [dx,dy] of [[hexPixels,0],[0,hexPixels],[hexPixels*Math.sqrt(3)/2,hexPixels/2]]){
        assert.ok(Math.abs(routeDistance([start,position(60+dx,60+dy)],options)-24)<1e-9,calibration.image);
      }
      assert.equal(options.unit,'miles');assert.equal(options.hexMiles,24);
    }
  }
});

test('long source-image grid span agrees with the hex calibration and changed known images cannot reuse it',()=>{
  const calibration=MAP_CALIBRATIONS.find(item=>item.image==='assets/world-map-regions-new.png');
  const bounds=[[0,0],[calibration.height,calibration.width]];
  const options=measurementOptions({},calibration,bounds);
  // Independent detected grid edges, separated by 123 complete hex widths.
  const distance=routeDistance([{lat:1510.3213566507684,lng:6500},{lat:3990.8793268736945,lng:6500}],options);
  assert.ok(Math.abs(distance-123*24)<0.1);
  assert.equal(measurementOptions({scale:1,unit:'miles'},{id:calibration.image,sha256:'changed'},bounds),null);
  assert.equal(measurementOptions({scale:1,unit:'miles'},{id:calibration.image},bounds),null);
});

function setup({scale=0.5,zoomEnabled=true}={}) {
  let focus,paths=[],markers=[],enabled=zoomEnabled;
  class Element {
    constructor(){this.children=[];this.listeners={};this.attributes={};this.hidden=false;this.disabled=false;this.classes=new Set();this.classList={toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value)};}
    append(...children){this.children.push(...children);}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(name,handler){this.listeners[name]=handler;}
    focus(){focus=this;}
    click(){if(!this.disabled)this.listeners.click?.();}
  }
  const doc={createElement:()=>new Element()},canvas=new Element(),caption=new Element(),figure=new Element();canvas.ownerDocument=doc;
  figure.querySelector=()=>caption;
  const events={},map={on:(name,handler)=>{events[name]=handler;},center:{lat:3,lng:4},getCenter(){return this.center;},
    doubleClickZoom:{enabled:()=>enabled,enable:()=>{enabled=true;},disable:()=>{enabled=false;}}};
  const group={addTo(){return this;},clearLayers(){paths=[];markers=[];}};
  const L={layerGroup:()=>group,polyline:points=>({addTo(){paths.push(structuredClone(points));}}),circleMarker:point=>({addTo(){markers.push({...point});}})};
  const bounds={contains:point=>point.lat>=0 && point.lng>=0 && point.lat<=100 && point.lng<=100};
  addMeasurement(L,map,canvas,figure,{xScale:scale,yScale:scale,unit:'miles'},bounds);
  const controls=caption.children[0], [toggle,undo,clear,summary]=controls.children,help=figure.children[0];
  return {canvas,map,toggle,undo,clear,summary,help,
    click:point=>events.click({latlng:point}),
    key:(key,target=canvas)=>{const event={key,target,preventDefault(){this.prevented=true;}};figure.listeners.keydown(event);return event;},
    get focus(){return focus;},get paths(){return paths;},get markers(){return markers;},get zoomEnabled(){return enabled;}};
}

test('measurement is opt-in, supports route totals, undo, finish, clear and rejects points outside the image',()=>{
  const m=setup();
  m.click({lat:0,lng:0});assert.equal(m.markers.length,0);assert.equal(m.help.hidden,true);assert.equal(m.clear.hidden,true);
  m.toggle.click();assert.equal(m.toggle.attributes['aria-pressed'],'true');assert.equal(m.focus,m.canvas);assert.equal(m.zoomEnabled,false);
  assert.equal(m.help.hidden,false);assert.equal(m.undo.disabled,true);
  m.click({lat:0,lng:0});m.click({lat:3,lng:4});m.click({lat:3,lng:14});
  assert.equal(m.summary.textContent,'Total: 7.5 miles');assert.equal(m.markers.length,3);assert.equal(m.paths.length,1);
  m.click({lat:3,lng:14});m.click({lat:101,lng:14});assert.equal(m.markers.length,3);
  m.undo.click();assert.equal(m.summary.textContent,'Total: 2.5 miles');assert.equal(m.markers.length,2);
  m.toggle.click();assert.equal(m.zoomEnabled,true);assert.equal(m.toggle.attributes['aria-pressed'],'false');assert.equal(m.undo.hidden,true);
  m.click({lat:30,lng:40});assert.equal(m.markers.length,2);assert.equal(m.paths.length,1);
  m.clear.click();assert.equal(m.markers.length,0);assert.equal(m.paths.length,0);assert.equal(m.summary.textContent,'');assert.equal(m.focus,m.toggle);
});

test('keyboard measurement uses the current center, preserves Leaflet controls and isolates maps',()=>{
  const a=setup({zoomEnabled:false}),b=setup({scale:1});
  a.toggle.click();a.map.center={lat:0,lng:0};assert.equal(a.key('Enter').prevented,true);
  a.map.center={lat:3,lng:4};a.key(' ');assert.equal(a.summary.textContent,'Total: 2.5 miles');
  assert.equal(b.markers.length,0);assert.equal(b.toggle.attributes['aria-pressed'],'false');
  assert.equal(a.key('Enter',a.toggle).prevented,undefined);assert.equal(a.markers.length,2);
  a.key('Backspace');assert.equal(a.markers.length,1);
  a.key('Escape',a.undo);assert.equal(a.zoomEnabled,false);assert.equal(a.focus,a.toggle);assert.equal(a.help.hidden,true);
  assert.equal(a.key('Enter').prevented,undefined);
});
