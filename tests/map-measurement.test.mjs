import test from 'node:test';
import assert from 'node:assert/strict';
import {routeDistance,formatDistance,measurementOptions,routeArea,formatArea} from '../src/map-distance.mjs';
import {addMeasurement} from '../src/browser/map-measurement.mjs';
import {measurementRoutes,repairClosedRoute,shapeLabelPoint} from '../src/map-path.mjs';

test('planar measurement uses calibration once for every segment, regardless of coordinate origin',()=>{
  const points=[{lat:1000,lng:-200},{lat:1003,lng:-196},{lat:1003,lng:-186}];
  assert.equal(routeDistance(points),15);
  assert.equal(routeDistance(points,{xScale:0.5,yScale:0.5}),7.5);
  assert.equal(routeDistance(points,{xScale:0.6,yScale:0.6}),9);
  assert.equal(routeDistance([]),0);assert.equal(routeDistance(points.slice(0,1)),0);
  assert.match(formatDistance(7.5,'miles'),/7[.,]5 miles/);
});

test('block-authored calibrations measure a 24-mile hex at different source resolutions and stretched bounds',()=>{
  for(const hexPixels of [121/6,121/3,121/4]){
    const calibration={hexMiles:24,hexPixels,imageSize:[7200,4536]};
    for(const bounds of [[[0,0],[953,1042]],[[-900,200],[1180,5900]]]){
      const options=measurementOptions({calibration,scale:999,unit:'wrong'},{},bounds);
      const position=(x,y)=>({lng:bounds[0][1]+x/calibration.imageSize[0]*(bounds[1][1]-bounds[0][1]),
        lat:bounds[0][0]+y/calibration.imageSize[1]*(bounds[1][0]-bounds[0][0])});
      const start=position(60,60);
      for(const [dx,dy] of [[hexPixels,0],[0,hexPixels],[hexPixels*Math.sqrt(3)/2,hexPixels/2]]){
        assert.ok(Math.abs(routeDistance([start,position(60+dx,60+dy)],options)-24)<1e-9);
      }
      assert.equal(options.unit,'miles');assert.equal(options.hexMiles,24);
    }
  }
});

test('long reference-image grid span agrees with the block calibration and fingerprints reject changed images',()=>{
  const calibration={hexMiles:24,hexPixels:121/6,imageSize:[7200,4536],imageSha256:'a'.repeat(64)};
  const bounds=[[0,0],[4536,7200]];
  const data={calibration,scale:1,unit:'miles'};
  const options=measurementOptions(data,{sha256:calibration.imageSha256},bounds);
  // Independent detected grid edges, separated by 123 complete hex widths.
  const distance=routeDistance([{lat:1510.3213566507684,lng:6500},{lat:3990.8793268736945,lng:6500}],options);
  assert.ok(Math.abs(distance-123*24)<0.1);
  assert.equal(measurementOptions(data,{sha256:'changed'},bounds),null);
  assert.equal(measurementOptions(data,{},bounds),null);
});

test('invalid explicit calibration never falls back to a plausible but incorrect legacy scale',()=>{
  const valid={hexMiles:24,hexPixels:40,imageSize:[200,100]};
  for(const calibration of [null,[],{},...[
    {hexMiles:0},{hexMiles:'24'},{hexPixels:-1},{hexPixels:Infinity},
    {imageSize:[0,100]},{imageSize:[200]},{imageSize:[200,100.5]},
    {imageSha256:'bad'},{hexPixels:Number.MIN_VALUE},
  ].map(fields=>({...valid,...fields}))]){
    assert.equal(measurementOptions({calibration,scale:1,unit:'miles'},{},[[0,0],[100,200]]),null);
  }
});

function setup({scale=0.5,zoomEnabled=true,screenScale,calibrated=true}={}) {
  let focus,paths=[],markers=[],polygons=[],labels=[],enabled=zoomEnabled;
  class Element {
    constructor(){this.children=[];this.listeners={};this.attributes={};this.hidden=false;this.disabled=false;this.classes=new Set();this.classList={toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value)};}
    append(...children){this.children.push(...children);}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(name,handler){this.listeners[name]=handler;}
    removeEventListener(name){delete this.listeners[name];}
    setPointerCapture(id){this.capture=id;}
    hasPointerCapture(id){return this.capture===id;}
    releasePointerCapture(){this.capture=null;}
    remove(){this.removed=true;}
    focus(){focus=this;}
    click(){if(!this.disabled)this.listeners.click?.();}
  }
  const doc={createElement:()=>new Element()},canvas=new Element(),caption=new Element(),figure=new Element();canvas.ownerDocument=doc;
  figure.querySelector=()=>caption;
  const handler=(initial=true)=>{let enabled=initial;return {enabled:()=>enabled,enable(){enabled=true;},disable(){enabled=false;}};};
  const events={},map={on:(name,handler)=>{events[name]=handler;},off:name=>{delete events[name];},center:{lat:3,lng:4},getCenter(){return this.center;},
    mouseEventToLatLng:event=>({lng:event.clientX,lat:event.clientY}),dragging:handler(),touchZoom:handler(),boxZoom:handler(false),
    doubleClickZoom:{enabled:()=>enabled,enable:()=>{enabled=true;},disable:()=>{enabled=false;}}};
  if(screenScale)map.latLngToContainerPoint=point=>({x:point.lng*screenScale,y:point.lat*screenScale});
  const group={addTo(){return this;},clearLayers(){paths=[];markers=[];polygons=[];labels=[];}};
  const L={layerGroup:()=>group,divIcon:options=>options,marker:(point,options)=>({addTo(){labels.push({point,...options});}}),polygon:points=>({addTo(){polygons.push(structuredClone(points));}}),polyline:points=>({addTo(){paths.push(structuredClone(points));}}),circleMarker:point=>({addTo(){markers.push({...point});}})};
  const bounds={contains:point=>point.lat>=0 && point.lng>=0 && point.lat<=100 && point.lng<=100};
  const dispose=addMeasurement(L,map,canvas,figure,calibrated?{xScale:scale,yScale:scale,unit:'miles'}:null,bounds);
  const controls=caption.children[0], [toggle,sketch,trace,close,undo,clear,summary]=controls.children,help=figure.children[0];
  return {canvas,map,toggle,sketch,trace,close,undo,clear,summary,help,dispose,
    click:point=>events.click({latlng:point}),
    viewChange:()=>events['movestart zoomstart'](),
    pointer:(name,x,y,extra={})=>{
      const event={pointerId:1,clientX:x,clientY:y,button:0,target:canvas,preventDefault(){this.prevented=true;},...extra};
      canvas.listeners[name](event);return event;
    },
    key:(key,target=canvas)=>{const event={key,target,preventDefault(){this.prevented=true;}};figure.listeners.keydown(event);return event;},
    get focus(){return focus;},get paths(){return paths;},get polygons(){return polygons;},get markers(){return markers;},get labels(){return labels;},get zoomEnabled(){return enabled;}};
}

test('closed outlines measure calibrated square miles, concavity and winding independently of map origin',()=>{
  const p=(x,y)=>({lng:x+1_000_000,lat:y-1_000_000});
  const concave=[p(0,0),p(4,0),p(4,1),p(1,1),p(1,4),p(0,4),p(0,0)];
  assert.equal(routeArea(concave,{xScale:2,yScale:3}),42);
  assert.equal(routeArea([...concave].reverse(),{xScale:2,yScale:3}),42);
  assert.equal(routeArea(concave.slice(0,-1)),null);
  assert.equal(routeArea([p(0,0),p(1,0),p(2,0),p(0,0)]),null);
  assert.equal(routeArea([p(0,0),p(4,4),p(0,3),p(4,0),p(0,0)]),null,'crossed outlines have no unambiguous area');
  assert.equal(routeArea([p(0,0),p(4,0),p(2,0),p(2,3),p(0,0)]),null,'retraced adjacent edges are rejected');
  assert.equal(routeArea([p(0,0),p(4,0),p(4,4),p(2,0),p(0,4),p(0,0)]),null,'nonadjacent touching edges are rejected');
  assert.equal(routeArea([p(0,0),p(0,0),p(4,0),p(4,4),p(0,4),p(0,0)]),16);
  assert.equal(formatArea(42,'miles'),'42 square miles');assert.equal(formatArea(42,'map units'),'42 square map units');
  const calibration={hexMiles:24,hexPixels:40,imageSize:[200,100]};
  for(const bounds of [[[0,0],[100,200]],[[-200,900],[400,1700]]]){
    const point=(x,y)=>({lng:bounds[0][1]+x/200*(bounds[1][1]-bounds[0][1]),lat:bounds[0][0]+y/100*(bounds[1][0]-bounds[0][0])});
    const options=measurementOptions({calibration},{},bounds);
    assert.ok(Math.abs(routeArea([point(0,0),point(40,0),point(40,40),point(0,40),point(0,0)],options)-576)<1e-9);
  }
  const circle=Array.from({length:1000},(_,i)=>p(10*Math.cos(i*2*Math.PI/1000),10*Math.sin(i*2*Math.PI/1000)));
  circle.push(circle[0]);assert.ok(Math.abs(routeArea(circle)-Math.PI*100)<0.01,'dense freehand outlines retain their bends');
});

test('Close shape adds area and a fill, Undo reopens it, and Clear removes it',()=>{
  const m=setup({scale:1});m.toggle.click();assert.equal(m.close.hidden,true);
  for(const point of [{lat:10,lng:10},{lat:10,lng:30},{lat:30,lng:30},{lat:30,lng:10}])m.click(point);
  assert.equal(m.close.hidden,false);assert.doesNotMatch(m.summary.textContent,/Area/);
  m.close.click();assert.equal(m.summary.textContent,'Total: 80 miles · Area: 400 square miles');assert.equal(m.polygons.length,1);
  assert.equal(m.close.hidden,true);m.toggle.click();assert.match(m.summary.textContent,/Area: 400 square miles/);
  m.toggle.click();m.undo.click();assert.doesNotMatch(m.summary.textContent,/Area/);assert.equal(m.polygons.length,0);assert.equal(m.close.hidden,false);
  m.close.click();m.clear.click();assert.equal(m.polygons.length,0);assert.doesNotMatch(m.summary.textContent,/Area/);
});

test('point and freehand outlines snap closed near the start using screen pixels, with separate area readings',()=>{
  const m=setup({scale:1,screenScale:4});m.toggle.click();
  for(const point of [{lat:10,lng:10},{lat:10,lng:30},{lat:30,lng:30},{lat:30,lng:10},{lat:11,lng:10}])m.click(point);
  assert.match(m.summary.textContent,/Area: 400 square miles/);
  m.trace.click();m.pointer('pointerdown',50,50);m.pointer('pointermove',60,50);m.pointer('pointermove',60,60);m.pointer('pointermove',50,60);m.pointer('pointerup',50,51);
  assert.equal(m.paths.length,2);assert.equal(m.polygons.length,2);
  assert.match(m.summary.textContent,/Area 1: 400 square miles · Area 2: 100 square miles/);
  m.undo.click();assert.equal(m.polygons.length,1);assert.match(m.summary.textContent,/Area: 400 square miles/);
  m.trace.click();m.click({lat:80,lng:80});assert.equal(m.paths.length,1);assert.match(m.summary.textContent,/Area: 400 square miles/);
});

test('Close shape repairs a crossed outline, including an already closed invalid ring, and Undo restores it',()=>{
  const m=setup();m.toggle.click();
  for(const point of [{lat:10,lng:10},{lat:30,lng:30},{lat:30,lng:10},{lat:10,lng:30},{lat:10,lng:10}])m.click(point);
  assert.match(m.summary.textContent,/Area: unavailable/);assert.equal(m.polygons.length,0);assert.equal(m.close.hidden,false);
  const original=structuredClone(m.paths[0]);
  m.close.click();assert.match(m.summary.textContent,/Area: 25 square miles/);assert.equal(m.polygons.length,1);assert.equal(m.labels.length,1);
  m.undo.click();assert.deepEqual(m.paths[0],original);assert.equal(m.polygons.length,0);
  assert.match(m.summary.textContent,/Area: unavailable/);
});

test('forgiving closure removes large edge loops and retraces at any zoom, retaining the main outline and its concavity',()=>{
  const p=([lng,lat])=>({lng,lat});
  const outlines=[
    [[10,10],[90,10],[90,90],[10,90],[10,40],[30,60],[0,60],[10,70],[10,10]],
    [[10,10],[90,10],[90,90],[10,90],[10,-20],[10,10]],
    [[10,10],[90,10],[90,90],[10,90],[10,40],[40,40],[10,40],[10,10]],
  ];
  for(const outline of outlines.map(r=>r.map(p)))for(const direction of [outline,[...outline].reverse()]){
    for(const scale of [0.1,1,10]){
      const repaired=repairClosedRoute(direction,point=>({x:Math.round(point.lng*scale),y:Math.round(point.lat*scale)}),{forgiving:true});
      assert.equal(routeArea(repaired),6400);assert.ok(repaired.length<direction.length);
    }
    assert.equal(routeArea(repairClosedRoute(direction,null,{forgiving:true})),6400);
  }
  const concave=[[0,0],[60,0],[60,20],[20,20],[20,60],[0,60],[0,0]].map(p);
  assert.deepEqual(repairClosedRoute(concave,null,{forgiving:true}),concave,'valid concave outlines are not replaced with a hull');
  const line=[[0,0],[20,0],[40,0],[0,0]].map(p);
  assert.equal(routeArea(repairClosedRoute(line,null,{forgiving:true})),null,'no area is invented for a line');
});

test('closure trims tiny edge loops, touches and retraced overshoots in screen pixels without changing substantial crossings',()=>{
  const p=([lng,lat])=>({lng,lat}),project=point=>({x:point.lng,y:point.lat});
  const overshoot=[[10,10],[50,10],[50,50],[10,50],[10,8],[10,10]].map(p);
  const edgeLoop=[[10,10],[50,10],[50,50],[10,50],[10,28],[12,30],[8,30],[10,32],[10,10]].map(p);
  const touch=[[10,10],[50,10],[50,50],[10,50],[10,30],[12,32],[10,30],[10,10]].map(p);
  for(const outline of [overshoot,edgeLoop,touch]){
    const original=structuredClone(outline);
    assert.equal(routeArea(outline),null);
    assert.equal(routeArea(repairClosedRoute(outline,project)),1600);
    assert.equal(routeArea(repairClosedRoute([...outline].reverse(),project)),1600);
    assert.deepEqual(outline,original,'correction does not mutate the actions used by Undo');
  }
  const zoomed=point=>({x:point.lng*10,y:point.lat*10});
  assert.equal(routeArea(repairClosedRoute(edgeLoop,zoomed)),null,'visibly large loops remain invalid');
  assert.deepEqual(repairClosedRoute(edgeLoop,null),edgeLoop,'no map-coordinate tolerance is guessed');
  for(const size of [4,40]){
    const bowtie=[[0,0],[size,size],[0,size],[size,0],[0,0]].map(p);
    assert.equal(routeArea(repairClosedRoute(bowtie,project)),null,'a crossed shape is not reduced to one lobe');
  }
});

test('explicit and automatic point and trace closure use the repaired outline for both the line and area',()=>{
  for(const freehand of [false,true])for(const automatic of [false,true]){
    const m=setup({scale:1,screenScale:1});m.toggle.click();
    const outline=[[10,10],[50,10],[50,50],[10,50],[10,28],[12,30],[8,30],[10,32],[10,automatic?8:22]];
    if(freehand){
      m.trace.click();m.pointer('pointerdown',...outline[0]);
      for(const point of outline.slice(1))m.pointer('pointermove',...point);
      m.pointer('pointerup',...outline.at(-1));
    }else for(const [lng,lat] of outline)m.click({lng,lat});
    if(!automatic)m.close.click();
    assert.equal(m.polygons.length,1);assert.match(m.summary.textContent,/Area: 1,600 square miles/);
    assert.deepEqual(m.polygons[0],m.paths[0],'line, fill, and measurements use the same geometry');
    m.undo.click();assert.equal(m.polygons.length,0);
  }
});

test('Sketch starts freehand, supports point outlines and Undo, preserves measurements and Clear removes all drawings',()=>{
  const m=setup({scale:1,screenScale:1});m.toggle.click();m.click({lat:80,lng:80});m.click({lat:80,lng:90});
  m.sketch.click();assert.equal(m.toggle.attributes['aria-pressed'],'false');assert.equal(m.sketch.attributes['aria-pressed'],'true');
  assert.equal(m.trace.attributes['aria-pressed'],'true');assert.equal(m.map.dragging.enabled(),false);
  m.pointer('pointerdown',10,10);m.pointer('pointermove',50,10);m.pointer('pointermove',50,50);m.pointer('pointermove',10,50);m.pointer('pointerup',10,8);
  assert.equal(m.paths.length,2);assert.equal(m.polygons.length,1);assert.equal(m.summary.textContent,'Temporary sketch.');
  m.key('Escape');assert.equal(m.map.dragging.enabled(),true);assert.equal(m.paths.length,2);
  m.toggle.click();assert.equal(m.summary.textContent,'Total: 10 miles');assert.equal(m.paths.length,2);
  m.sketch.click();m.undo.click();assert.equal(m.paths.length,1,'sketch Undo leaves the measurement intact');
  m.trace.click();for(const point of [{lng:10,lat:10},{lng:50,lat:10},{lng:50,lat:50}])m.click(point);
  m.close.click();assert.equal(m.polygons.length,1);assert.doesNotMatch(m.summary.textContent,/miles|Area|Total/);
  m.sketch.click();assert.equal(m.clear.hidden,false);m.clear.click();assert.equal(m.paths.length,0);assert.equal(m.polygons.length,0);
  m.toggle.click();assert.equal(m.summary.textContent,'Choose a starting point.');
});

test('Sketch is available without valid calibration, is isolated per map, and never survives remounting',()=>{
  const m=setup({calibrated:false,screenScale:1});assert.equal(m.toggle.hidden,true);m.sketch.click();
  m.pointer('pointerdown',10,10);m.pointer('pointermove',50,10);m.pointer('pointerup',50,50);m.close.click();
  assert.equal(m.polygons.length,1);assert.equal(m.summary.textContent,'Temporary sketch.');
  const other=setup({calibrated:false});assert.equal(other.paths.length,0);
  m.clear.click();assert.equal(m.paths.length,0);assert.equal(m.map.dragging.enabled(),false);
  m.dispose();assert.deepEqual(m.canvas.listeners,{});
  const remounted=setup({calibrated:false});assert.equal(remounted.paths.length,0);assert.equal(remounted.clear.hidden,true);
});

test('closed freehand shapes receive sequential temporary labels that follow Undo, Clear and tool switching',()=>{
  const m=setup({screenScale:1});m.sketch.click();
  function square(x,y){
    m.pointer('pointerdown',x,y);m.pointer('pointermove',x+25,y);m.pointer('pointermove',x+25,y+25);
    m.pointer('pointermove',x,y+25);m.pointer('pointerup',x,y);
  }
  square(5,5);square(60,60);
  assert.deepEqual(m.labels.map(label=>label.icon.html),['1','2']);
  assert.deepEqual(m.labels.map(label=>label.point),[{lng:17.5,lat:17.5},{lng:72.5,lat:72.5}]);
  assert.ok(m.labels.every(label=>!label.interactive && !label.keyboard),'labels do not intercept drawing or keyboard input');
  m.toggle.click();assert.deepEqual(m.labels.map(label=>label.icon.html),['1','2']);
  m.sketch.click();m.undo.click();assert.deepEqual(m.labels.map(label=>label.icon.html),['1']);
  square(60,5);assert.deepEqual(m.labels.map(label=>label.icon.html),['1','2']);
  m.pointer('pointerdown',40,40);m.pointer('pointerup',45,45);
  assert.equal(m.labels.length,2,'open paths have no shape label');
  m.clear.click();assert.equal(m.labels.length,0);
  square(5,5);assert.deepEqual(m.labels.map(label=>label.icon.html),['1']);
});

test('Sketch always reenters tracing and stays ready to draw after Clear and Close shape',()=>{
  const m=setup();m.sketch.click();m.trace.click();assert.equal(m.map.dragging.enabled(),true);
  m.key('Escape');m.sketch.click();assert.equal(m.trace.attributes['aria-pressed'],'true');
  assert.equal(m.map.dragging.enabled(),false);
  m.pointer('pointerdown',10,10);m.pointer('pointermove',80,80);m.pointer('pointermove',10,80);m.pointer('pointerup',80,10);
  m.close.click();assert.equal(m.polygons.length,1);assert.equal(m.labels.length,1);assert.equal(m.trace.attributes['aria-pressed'],'true');
  m.pointer('pointerdown',20,20);m.pointer('pointermove',40,20);m.clear.click();
  assert.equal(m.canvas.capture,null);assert.equal(m.labels.length,0);assert.equal(m.trace.attributes['aria-pressed'],'true');
  assert.equal(m.map.dragging.enabled(),false);
  m.pointer('pointerdown',10,10);m.pointer('pointermove',80,10);m.pointer('pointermove',80,80);m.pointer('pointerup',10,10);
  assert.equal(m.polygons.length,1,'drawing works immediately after Clear');
});

test('shape labels stay inside concave outlines in either winding and at large coordinate origins',()=>{
  const outline=[[0,0],[6,0],[6,6],[4,6],[4,2],[2,2],[2,6],[0,6],[0,0]].map(([lng,lat])=>({lng:lng+1e6,lat:lat-1e6}));
  for(const ring of [outline,[...outline].reverse()]){
    const label=shapeLabelPoint(ring),x=label.lng-1e6,y=label.lat+1e6;
    assert.ok(x>0 && x<6 && y>0 && y<6);
    assert.ok(x<2 || x>4 || y<2,'the label avoids the empty center of the U');
  }
});

test('short open traces do not snap shut, while explicit closure still measures small outlines',()=>{
  const m=setup({scale:1,screenScale:1});m.toggle.click();m.trace.click();
  m.pointer('pointerdown',10,10);m.pointer('pointermove',14,10);m.pointer('pointerup',14,14);
  assert.doesNotMatch(m.summary.textContent,/Area/);assert.equal(m.polygons.length,0);
  m.close.click();assert.equal(m.trace.attributes['aria-pressed'],'false');assert.equal(m.map.dragging.enabled(),true);
  assert.match(m.summary.textContent,/Area: 8 square miles/);
  m.clear.click();assert.equal(m.polygons.length,0);
});

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

test('freehand measures winding geometry, keeps disconnected strokes separate, and Undo removes one stroke',()=>{
  const m=setup({scale:1});m.toggle.click();m.trace.click();
  assert.equal(m.map.dragging.enabled(),false);assert.equal(m.map.touchZoom.enabled(),false);
  m.pointer('pointerdown',60,50);
  const points=[{lat:50,lng:60}];
  for(let i=1;i<=100;i++){
    const angle=i/100*Math.PI/2,x=50+10*Math.cos(angle),y=50+10*Math.sin(angle);
    // Coalesced pointer samples retain bends that a single final event misses.
    points.push({lat:y,lng:x});
  }
  m.pointer('pointermove',50,60,{getCoalescedEvents:()=>points.slice(1).map(p=>({pointerId:1,clientX:p.lng,clientY:p.lat}))});
  m.pointer('pointerup',50,60);
  assert.ok(Math.abs(routeDistance(m.paths[0])-Math.PI*5)<0.1);
  assert.ok(routeDistance(m.paths[0])>Math.hypot(10,10)+1);
  m.pointer('pointerdown',10,10);m.pointer('pointermove',13,14);m.pointer('pointerup',13,14);
  assert.equal(m.paths.length,2);assert.match(m.summary.textContent,/20[.,]7 miles/);
  m.undo.click();assert.equal(m.paths.length,1);assert.match(m.summary.textContent,/15[.,]7 miles/);
  m.trace.click();assert.equal(m.map.dragging.enabled(),true);assert.equal(m.map.touchZoom.enabled(),true);assert.equal(m.map.boxZoom.enabled(),false);
  m.undo.click();assert.equal(m.paths.length,0);
});

test('cancelled or secondary-pointer strokes do not change the result, and disposal restores navigation',()=>{
  const m=setup();m.toggle.click();m.trace.click();
  m.pointer('pointerdown',5,5,{isPrimary:false});assert.equal(m.paths.length,0);
  m.pointer('pointerdown',5,5);m.pointer('pointermove',10,10);m.pointer('pointermove',20,20,{pointerId:2});
  assert.equal(m.paths[0].at(-1).lat,10);
  m.pointer('pointercancel',10,10);assert.equal(m.paths.length,0);assert.equal(m.canvas.capture,null);
  m.pointer('pointerdown',5,5);m.pointer('pointermove',10,10);m.viewChange();assert.equal(m.paths.length,0);
  m.pointer('pointerdown',5,5);m.pointer('pointermove',10,10);m.key('Escape');assert.equal(m.paths.length,0);assert.equal(m.map.dragging.enabled(),true);
  m.toggle.click();m.pointer('pointerdown',5,5);m.pointer('pointermove',10,10);m.dispose();
  assert.equal(m.map.dragging.enabled(),true);assert.deepEqual(m.canvas.listeners,{});
});

test('Clear exits tracing, releases unfinished strokes, restores panning and permits point measurement',()=>{
  const m=setup();m.toggle.click();m.trace.click();
  assert.equal(m.clear.hidden,false,'Clear also exits tracing before a route is drawn');
  m.pointer('pointerdown',5,5);m.pointer('pointermove',10,10);m.pointer('pointerup',10,10);
  m.pointer('pointerdown',20,20);m.pointer('pointermove',30,30);
  m.clear.click();
  assert.equal(m.paths.length,0);assert.equal(m.markers.length,0);assert.equal(m.canvas.capture,null);
  assert.equal(m.trace.attributes['aria-pressed'],'false');assert.equal(m.canvas.classes.has('map-tracing'),false);
  assert.equal(m.map.dragging.enabled(),true);assert.equal(m.map.touchZoom.enabled(),true);assert.equal(m.map.boxZoom.enabled(),false);
  assert.equal(m.toggle.attributes['aria-pressed'],'true');assert.equal(m.summary.textContent,'Choose a starting point.');
  assert.equal(m.clear.hidden,true);assert.equal(m.focus,m.canvas);
  m.pointer('pointerup',30,30);assert.equal(m.markers.length,0);
  m.click({lat:0,lng:0});m.click({lat:3,lng:4});assert.equal(m.summary.textContent,'Total: 2.5 miles');
  // Clearing a completed trace after Done also resets the mode for the next session.
  m.trace.click();m.toggle.click();m.clear.click();m.toggle.click();
  assert.equal(m.trace.attributes['aria-pressed'],'false');assert.equal(m.map.dragging.enabled(),true);
});

test('mixed point and stroke routes add no untraced bridge between strokes',()=>{
  const p=(lat,lng)=>({lat,lng});
  const routes=measurementRoutes([{kind:'point',points:[p(0,0)]},{kind:'point',points:[p(3,4)]},
    {kind:'stroke',points:[p(50,50),p(53,54)]},{kind:'point',points:[p(53,64)]}]);
  assert.equal(routes.reduce((sum,route)=>sum+routeDistance(route),0),20);
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
