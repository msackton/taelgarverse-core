import test from 'node:test';
import assert from 'node:assert/strict';
import {addMapBaseline,gridDetail,HEX_DETAIL_MIN_PIXELS} from '../src/browser/map-baseline.mjs';
import {LOCATOR_SCHEME} from '../src/map-locators.mjs';
import {visibleHexes,hexVertices} from '../src/map-core.mjs';
import {hexLevel,hierarchyGrid} from '../src/map-hex-hierarchy.mjs';

function setup({overlays=[],visible=true,showCoordinates=true,addressing,blockOrigin,zoom=0,grid={},
  crop={x:100,y:100,width:300,height:300},viewport={x:0,y:0,width:500,height:500}}={}) {
  const layers=[],events=new Map(),frames=new Map();let nextFrame=0,copied;
  class Element {
    constructor(){this.children=[];this.listeners={};this.style={};this.classes=new Set();this.classList={contains:name=>this.classes.has(name)};}
    setAttribute(name,value){this[name]=value;}
    append(...items){this.children.push(...items);}
    addEventListener(name,fn){this.listeners[name]=fn;}
    remove(){this.removed=true;}
    click(){if(!this.disabled)return this.listeners.click?.();}
  }
  const doc={createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:text=>({textContent:text}),defaultView:{
    requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),
    navigator:{clipboard:{writeText:async text=>{copied=text;}}},
  }};
  const canvas=new Element(),caption=new Element(),figure={querySelector:()=>caption};canvas.ownerDocument=doc;
  const map={on(names,fn){for(const name of names.split(' '))events.set(name,fn);},off(names){for(const name of names.split(' '))events.delete(name);},
    zoom,getZoom(){return this.zoom;},getZoomScale:(to,from)=>2**(to-from),
    overlayPane:new Element(),panes:[],getPane(){return this.overlayPane;},
    createPane(name,parent){const pane=new Element();parent.append(pane);this.panes.push(pane);return pane;},
    center:{lat:800,lng:200},getCenter(){return this.center;},
    viewport,getBounds(){const rect=this.viewport;return {getNorth:()=>1000-rect.y,getSouth:()=>1000-rect.y-rect.height,getWest:()=>rect.x,getEast:()=>rect.x+rect.width};}};
  const layer=(kind,points,options)=>({kind,points,options,children:[],addTo(parent){layers.push(this);parent.children?.push(this);return this;},
    setLatLngs(points){this.points=points;this.updates=(this.updates??0)+1;},setStyle(style){Object.assign(this.options,style);},bringToBack(){this.atBack=true;return this;},
    removeLayer(child){this.children=this.children.filter(item=>item!==child);child.remove();},
    clearLayers(){for(const child of this.children)child.remove();this.children=[];},remove(){this.clearLayers();this.removed=true;}});
  const L={canvas:options=>layer('renderer',[],options),layerGroup:()=>layer('group',[]),svgOverlay:(svg,bounds,options)=>({...layer('svg',bounds,options),svg}),
    marker:(points,options)=>layer('marker',points,options),divIcon:options=>options,
    polygon:(points,options)=>layer('polygon',points,options),polyline:(points,options)=>layer('line',points,options)};
  const dispose=addMapBaseline(L,map,canvas,figure,{bounds:[[0,0],[1000,1000]],crop,
    grid:{visible,showCoordinates,origin:[200,200],axialOrigin:[10,10],addressing,blockOrigin,...grid},overlays});
  const controls=caption.children[0],[label,output,center,copy,clear,detail]=controls.children,toggle=label.children[0];
  return {layers,canvas,output,center,copy,clear,detail,toggle,controls,events,frames,map,dispose,get copied(){return copied;},
    get markers(){return layers.filter(l=>l.kind==='marker' && !l.removed);},
    event:(name,point=[200,200])=>events.get(name)?.({latlng:{lng:point[0],lat:1000-point[1]}}),
    toggleGrid:checked=>{toggle.checked=checked;toggle.listeners.change();},
    flush:()=>{for(const [id,fn] of frames){frames.delete(id);fn();}}};
}

test('grid selection yields to measurement/editing and keeps only an explicitly pinned copy value',async()=>{
  const m=setup();assert.ok(m.layers.find(l=>l.kind==='line').points.length>0);
  for(const busy of ['map-measuring','map-editing']){
    m.canvas.classes.add(busy);m.center.click();assert.equal(m.copy.disabled,true);m.canvas.classes.delete(busy);
  }
  m.event('mousemove');assert.match(m.output.textContent,/axial 10, 10/);assert.equal(m.copy.disabled,true);
  m.center.click();assert.equal(m.copy.disabled,false);assert.equal(m.clear.hidden,false);
  m.event('mousemove',[300,300]);assert.match(m.output.textContent,/axial 10, 10/);
  await m.copy.click();assert.equal(m.copied,'axial 10, 10');
  m.toggleGrid(false);assert.equal(m.copy.disabled,true);assert.equal(m.center.hidden,true);
  assert.equal(m.output.textContent,'');assert.equal(m.layers.find(l=>l.kind==='line').points.length,0);
  m.toggleGrid(true);assert.equal(m.center.hidden,false);m.dispose();
});

test('crop edges bound grid selection, and retired masks do not affect it',()=>{
  const m=setup({overlays:[{retired:'mask'}]});
  m.event('mousemove',[160,160]);assert.match(m.output.textContent,/axial/);
  m.event('mousemove',[50,50]);assert.equal(m.output.textContent,'');
  assert.equal(m.layers.filter(l=>l.kind==='svg').length,0);
  m.dispose();
});

test('map instances isolate controls, coalesce viewport redraws, and dispose pending frames and layers',()=>{
  const first=setup(),second=setup({showCoordinates:false});
  first.event('move');first.event('move');assert.equal(first.frames.size,0,'drag frames never regenerate grid geometry');
  first.event('moveend');first.event('resize');assert.equal(first.frames.size,1);
  first.flush();assert.equal(first.frames.size,0);
  first.center.click();assert.equal(second.copy.disabled,true);assert.equal(second.center.hidden,true);
  first.toggleGrid(false);assert.equal(second.toggle.checked,true);
  first.event('zoomend');first.dispose();assert.equal(first.frames.size,0);assert.equal(first.events.size,0);
  assert.equal(first.controls.removed,true);
  assert.ok(first.layers.filter(l=>['renderer','group','svg'].includes(l.kind)).every(l=>l.removed));
  assert.equal(second.events.size,5);second.dispose();
});

test('verified global locators appear on hover and copy without axial formatting',async()=>{
  const m=setup({addressing:{status:'verified',scheme:LOCATOR_SCHEME}});
  m.event('mousemove');assert.match(m.output.textContent,/02\.01\.D\.20/);
  m.center.click();await m.copy.click();assert.equal(m.copied,'02.01.D.20');m.dispose();
});

test('screen size selects blocks, then full hexes, preserving a pinned source point',async()=>{
  assert.equal(gridDetail((HEX_DETAIL_MIN_PIXELS-.01)/40,true),'blocks');
  assert.equal(gridDetail(HEX_DETAIL_MIN_PIXELS/40,true),0);
  for(let depth=1;depth<=4;depth++){
    assert.equal(gridDetail((HEX_DETAIL_MIN_PIXELS-.01)/hexLevel(depth).hexPixels,true),depth-1);
    assert.equal(gridDetail(HEX_DETAIL_MIN_PIXELS/hexLevel(depth).hexPixels,true),depth);
  }
  assert.equal(gridDetail(1000,true),4,'subdivision stops at depth four');
  const m=setup({zoom:-2,crop:{x:0,y:0,width:1000,height:1000},blockOrigin:[0,0],addressing:{status:'verified',scheme:LOCATOR_SCHEME},grid:{origin:[16.5,20.5],axialOrigin:[0,0]}});
  assert.match(m.detail.textContent,/Blocks/);assert.equal(m.center.textContent,'Select center block');
  assert.equal(m.markers.length,0);
  assert.equal(m.map.panes[0].style.zIndex,'40');
  assert.deepEqual(m.map.overlayPane.children,m.map.panes,'grid lines share the image pane transform');
  m.center.click();await m.copy.click();assert.equal(m.copied,'01.01');
  const selection=m.layers.find(l=>l.options?.fill===false);assert.equal(selection.points.length,4);
  m.map.zoom=-1;m.event('zoomend');m.flush();
  assert.match(m.detail.textContent,/24-mile hexes/);assert.equal(m.markers.length,0);
  assert.equal(selection.points.length,6);assert.equal(m.copy.disabled,false);assert.equal(m.clear.hidden,false);
  await m.copy.click();const hex=m.copied;assert.match(hex,/^01\.01\.[A-I]\.\d{2}$/);
  m.map.zoom=-2;m.event('zoomend');m.flush();await m.copy.click();assert.equal(m.copied,'01.01');
  m.map.zoom=-1;m.event('zoomend');m.flush();await m.copy.click();assert.equal(m.copied,hex);
  m.dispose();assert.ok(m.map.panes.every(pane=>pane.removed));assert.equal(m.markers.length,0);
});

test('four seven-child levels keep parent outlines and slash references without printed labels',async()=>{
  const m=setup({zoom:0,blockOrigin:[0,0],addressing:{status:'verified',scheme:LOCATOR_SCHEME}});
  m.center.click();await m.copy.click();assert.equal(m.copied,'02.01.D.20');
  m.map.zoom=1;m.event('zoomend');m.flush();
  assert.match(m.detail.textContent,/^9.07-mile hexes/);assert.equal(m.markers.length,0);
  const lines=m.layers.filter(l=>l.kind==='line');assert.ok(lines[0].points.length>lines[1].points.length && lines[1].points.length>0);
  await m.copy.click();assert.equal(m.copied,'02.01.D.20/0');assert.ok(lines[2].points.length,'parent of selected fine cell is highlighted');
  for(const [zoom,path,miles] of [[2,'00','3.43'],[4,'000','1.30'],[5,'0000','0.49'],[6,'0000','0.49']]){
    // Real viewports shrink in source pixels as zoom increases.
    m.map.viewport={x:200-80/2**zoom,y:200-80/2**zoom,width:160/2**zoom,height:160/2**zoom};
    m.map.zoom=zoom;m.event('zoomend');m.flush();
    assert.ok(m.detail.textContent.startsWith(miles+'-mile hexes'));assert.equal(m.markers.length,0);
    await m.copy.click();assert.equal(m.copied,'02.01.D.20/'+path,'leading center-child zeros survive copy and zoom');
    assert.equal(lines[2].points.length,6);
  }
  m.map.zoom=0;m.event('zoomend');m.flush();await m.copy.click();assert.equal(m.copied,'02.01.D.20');
  m.toggleGrid(false);assert.equal(m.markers.length,0);assert.ok(lines.every(line=>line.points.length===0));
  m.dispose();
  const hidden=setup({zoom:2,showCoordinates:false,addressing:{status:'verified',scheme:LOCATOR_SCHEME}});
  assert.equal(hidden.markers.length,0);assert.equal(hidden.center.hidden,true);hidden.dispose();
  const legacy=setup({zoom:2});assert.equal(legacy.detail.textContent,'24-mile hexes');assert.equal(legacy.markers.length,0);legacy.dispose();
});

test('overview blocks remain selectable across zooms without printed labels',async()=>{
  const m=setup({zoom:-3,blockOrigin:[-360*Math.sqrt(3),-480],addressing:{status:'verified',scheme:LOCATOR_SCHEME}});
  assert.equal(m.markers.length,0);m.event('mousemove');assert.equal(m.output.textContent,'02.02 · block');
  m.center.click();assert.equal(m.output.textContent,'02.02 · block');await m.copy.click();assert.equal(m.copied,'02.02');
  m.map.zoom=-2;m.event('zoomend');m.flush();
  assert.equal(m.markers.length,0);
  assert.equal(m.output.textContent,'02.02 copied','a zoom within block detail keeps the pinned selection');
  m.dispose();
});

test('block lookup honors crop offsets, coordinate visibility, toggle and legacy addressing',()=>{
  const options={zoom:-2,blockOrigin:[-9*360*Math.sqrt(3),-15*480],addressing:{status:'verified',scheme:LOCATOR_SCHEME}};
  const m=setup(options);
  assert.equal(m.markers.length,0);
  m.center.click();assert.equal(m.copy.disabled,false);m.event('click',[300,300]);assert.match(m.output.textContent,/16\.10/);
  m.toggleGrid(false);assert.equal(m.markers.length,0);assert.equal(m.detail.hidden,true);
  m.toggleGrid(true);assert.equal(m.markers.length,0);m.dispose();
  const quiet=setup({...options,showCoordinates:false});assert.equal(quiet.markers.length,0);assert.equal(quiet.center.hidden,true);quiet.dispose();
  for(const addressing of [undefined,{status:'unverified'},options.addressing]){
    const legacy=setup({zoom:-2,addressing});assert.equal(legacy.markers.length,0);assert.equal(legacy.detail.textContent,'Zoom in for hexes');
    assert.equal(legacy.layers.find(l=>l.kind==='line').points.length,0);assert.equal(legacy.center.hidden,true);
    legacy.map.zoom=-1;legacy.event('zoomend');legacy.flush();assert.ok(legacy.layers.find(l=>l.kind==='line').points.length);legacy.dispose();
  }
});

test('faint block boundaries persist through hex detail and disappear when the visible crop lies in one block',()=>{
  // Nonzero export origin: block 16.10 starts at [0,0] in this image.
  const options={blockOrigin:[-9*360*Math.sqrt(3),-15*480],addressing:{status:'verified',scheme:LOCATOR_SCHEME},
    crop:{x:0,y:0,width:1000,height:1000},viewport:{x:400,y:300,width:400,height:300}};
  const m=setup({...options,zoom:-2});
  const boundary=m.layers.filter(layer=>layer.kind==='line')[3];
  assert.ok(boundary.points.length>0);const points=structuredClone(boundary.points);
  assert.equal(boundary.atBack,true);assert.equal(boundary.options.interactive,false);
  assert.equal(boundary.options.renderer,m.layers.find(layer=>layer.kind==='line').options.renderer);
  for(const zoom of [-1,1,2]){
    m.map.zoom=zoom;m.event('zoomend');m.flush();assert.deepEqual(boundary.points,points,'detail changes do not remove the registered block lines');
  }
  m.map.viewport={x:100,y:100,width:200,height:200};m.event('moveend');m.flush();
  assert.deepEqual(boundary.points,[],'one visible block has no boundary overlay');
  m.map.viewport={x:600,y:100,width:100,height:200};m.event('moveend');m.flush();
  assert.equal(boundary.points.length,1,'panning across a column boundary restores it, even at close zoom');
  m.map.viewport={x:100,y:470,width:200,height:100};m.event('resize');m.flush();
  assert.equal(boundary.points.length,1,'row boundaries respond to viewport changes too');
  m.toggleGrid(false);assert.deepEqual(boundary.points,[]);m.dispose();
  const cropped=setup({...options,crop:{x:100,y:100,width:200,height:200},viewport:{x:0,y:0,width:1000,height:1000}});
  assert.deepEqual(cropped.layers.filter(layer=>layer.kind==='line')[3].points,[],'off-crop blocks do not count');cropped.dispose();
  const unknown=setup({...options,addressing:{status:'unverified'}});
  assert.deepEqual(unknown.layers.filter(layer=>layer.kind==='line')[3].points,[],'unverified maps cannot invent block boundaries');unknown.dispose();
});


test('unchanged view and same-cell hover avoid geometry/selection redraws',()=>{
  const h=setup(),line=h.layers.find(layer=>layer.kind==='line'),selection=h.layers.find(layer=>layer.options?.fill===false);
  const updates=line.updates;h.event('moveend');h.event('zoomend');h.flush();assert.equal(line.updates,updates);
  h.event('mousemove',[200,200]);const selected=selection.updates;
  for(let i=0;i<20;i++)h.event('mousemove',[200+i*.01,200]);
  assert.equal(selection.updates,selected);h.event('click',[200,200]);assert.equal(h.copy.disabled,false);
  h.clear.click();h.event('mousemove',[200,200]);assert.equal(selection.updates,selected+2,'unpin clears the cached cell');h.dispose();
});

test('optimized grid segments match authoritative vertices at every hierarchy level',()=>{
  const grid={origin:[16.5,20.5],axialOrigin:[0,0]},viewport={x:300,y:300,width:200,height:200};
  for(let depth=0;depth<=4;depth++){
    const level=hexLevel(depth),zoom=Math.log2(19/level.hexPixels),cellGrid=hierarchyGrid(grid,depth);
    const h=setup({zoom,grid,viewport,crop:{x:0,y:0,width:1000,height:1000},blockOrigin:[0,0],addressing:{status:'verified',scheme:LOCATOR_SCHEME}});
    const expected=[];
    for(const axial of visibleHexes(cellGrid,viewport,level.hexPixels)){
      const vertices=hexVertices(cellGrid,axial,level.hexPixels);
      for(let i=0;i<3;i++)expected.push([vertices[i],vertices[i+1]].map(([x,y])=>[1000-y,x]));
    }
    const actual=h.layers.find(layer=>layer.kind==='line').points;assert.equal(actual.length,expected.length);
    for(let i=0;i<actual.length;i++)for(let j=0;j<2;j++)for(let k=0;k<2;k++)assert.ok(Math.abs(actual[i][j][k]-expected[i][j][k])<1e-8);
    h.dispose();
  }
});
