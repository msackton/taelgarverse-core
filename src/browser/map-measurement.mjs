import {routeDistance,formatDistance,isClosedRoute,routeArea,formatArea} from '../map-distance.mjs';
import {measurementRoutes,repairClosedRoute,shapeLabelPoint} from '../map-path.mjs';

export function addMeasurement(L,map,canvas,figure,options,imageBounds) {
  const caption=figure.querySelector('figcaption'),doc=canvas.ownerDocument;
  const controls=doc.createElement('span');controls.className='map-measure-controls';
  const button=(text,action)=>{
    const element=doc.createElement('button');element.type='button';element.textContent=text;
    element.addEventListener('click',action);controls.append(element);return element;
  };
  const drawings={measure:[],sketch:[]};
  let active=false,mode='measure',tracing=false,actions=drawings.measure,stroke=null,pointer=null,lastScreen=null,doubleClickZoom=false,panState;
  const toggle=button('Measure distance',()=>chooseMode('measure'));toggle.setAttribute('aria-pressed','false');toggle.hidden=!options;
  const sketch=button('Sketch',()=>chooseMode('sketch'));sketch.setAttribute('aria-pressed','false');
  const trace=button('Trace path',()=>setTracing(!tracing));trace.setAttribute('aria-pressed','false');
  const close=button('Close shape',()=>{
    const route=measurementRoutes(actions).at(-1);
    if(stroke || !route || route.length<3 || (isClosedRoute(route) && routeArea(route,options || {})!==null))return;
    actions.push({kind:'close',points:closeRoute(route,true)});setTracing(mode==='sketch');
  });
  const undo=button('Undo',()=>{if(stroke)finishStroke(false);else actions.pop();draw();});
  const clear=button('Clear',()=>{drawings.measure.length=0;drawings.sketch.length=0;setTracing(active && mode==='sketch');(active?canvas:options?toggle:sketch).focus({preventScroll:true});});
  const summary=doc.createElement('span');summary.className='map-measure-summary';summary.setAttribute('role','status');
  summary.setAttribute('aria-atomic','true');
  const help=doc.createElement('span');help.className='map-measure-help';
  controls.append(summary);caption.append(controls);
  figure.append(help);
  // Completed geometry stays intact while the live stroke updates once per
  // display frame. Keep all pointer samples for distance and final geometry.
  const layers=L.layerGroup().addTo(map),preview=L.layerGroup().addTo(map);
  let frame,disposed=false,strokeLine,strokeEnd,strokeLength=0,baseLength=0,areaText='';
  const cancelFrame=()=>{if(frame!==undefined){doc.defaultView.cancelAnimationFrame(frame);frame=undefined;}};
  const clearPreview=()=>{cancelFrame();preview.clearLayers();strokeLine=strokeEnd=null;};
  function drawStroke(){
    if(!stroke || disposed)return;
    const color=mode==='sketch'?'#b34e17':'#126c9a';
    if(!strokeLine){
      strokeLine=L.polyline(stroke,{className:'map-measure-line',color,weight:3,smoothFactor:0,interactive:false}).addTo(preview);
      const style={className:'map-measure-point',radius:5,color:'#fff',weight:2,fillColor:color,fillOpacity:1,interactive:false};
      L.circleMarker(stroke[0],style).addTo(preview);strokeEnd=L.circleMarker(stroke.at(-1),style).addTo(preview);
    }else{strokeLine.setLatLngs(stroke);strokeEnd.setLatLng(stroke.at(-1));}
    undo.disabled=false;close.hidden=true;clear.hidden=false;
    summary.textContent=mode==='sketch'?'Temporary sketch.':baseLength+strokeLength>0?'Total: '+formatDistance(baseLength+strokeLength,options.unit)+areaText:'Start point set. Add another point.';
  }
  function scheduleStroke(){
    if(!doc.defaultView?.requestAnimationFrame){drawStroke();return;}
    if(frame===undefined)frame=doc.defaultView.requestAnimationFrame(()=>{frame=undefined;drawStroke();});
  }
  function draw() {
    if(disposed)return;
    clearPreview();
    const routes=measurementRoutes(actions),count=routes.reduce((n,route)=>n+route.length,0);
    const closed=routes.filter(isClosedRoute),areas=closed.map(route=>routeArea(route,options || {}));
    layers.clearLayers();
    for(const kind of ['measure','sketch']){
      const visible=kind===mode?routes:measurementRoutes(drawings[kind]),color=kind==='sketch'?'#b34e17':'#126c9a';
      let number=0;
      for(const route of visible){
        if(isClosedRoute(route)){
          number++;
          if(routeArea(route,options || {})!==null){
            L.polygon(route,{className:'map-measure-area',stroke:false,fillColor:color,fillOpacity:0.15,smoothFactor:0,interactive:false}).addTo(layers);
            const icon=L.divIcon({className:'map-shape-label map-shape-label-'+kind,html:String(number),iconSize:[24,24],iconAnchor:[12,12]});
            L.marker(shapeLabelPoint(route),{icon,interactive:false,keyboard:false,title:'Shape '+number}).addTo(layers);
          }
        }
        if(route.length>1)L.polyline(route,{className:'map-measure-line',color,weight:3,smoothFactor:0,interactive:false}).addTo(layers);
      }
    }
    // Dense trace samples define the line, not thousands of visible handles.
    const visiblePoints=new Set(routes.flatMap(route=>route.map(point=>point.lat+','+point.lng)));
    const handles=actions.flatMap(action=>action.kind==='point'?action.points:action.kind==='close'?[]:[action.points[0],action.points.at(-1)])
      .filter(point=>visiblePoints.has(point.lat+','+point.lng));
    for(const point of handles)L.circleMarker(point,{className:'map-measure-point',radius:5,color:'#fff',weight:2,fillColor:mode==='sketch'?'#b34e17':'#126c9a',fillOpacity:1,interactive:false}).addTo(layers);
    trace.hidden=!active;undo.hidden=!active;undo.disabled=!count;
    const current=routes.at(-1);
    close.hidden=!active || Boolean(stroke) || !current || current.length<3 || (isClosedRoute(current) && routeArea(current,options || {})!==null);
    clear.hidden=!drawings.measure.length && !drawings.sketch.length && !(active && tracing);
    const length=baseLength=routes.reduce((n,route)=>n+routeDistance(route,options || {}),0);
    summary.textContent=mode==='sketch'?(count?'Temporary sketch.':active?(tracing?'Drag to sketch.':'Choose a starting point.'):''):
      routes.some(route=>route.length>1) ? 'Total: '+formatDistance(length,options.unit) :
      count ? 'Start point set.'+(active?' Add another point.':'') : active ? tracing?'Drag to trace a path.':'Choose a starting point.' : '';
    areaText=mode==='measure' && closed.length?' · '+areas.map((area,i)=>
      (areas.length===1?'Area':'Area '+(i+1))+': '+(area===null?'unavailable (outline must not cross or retrace itself)':formatArea(area,options.unit))).join(' · '):'';
    summary.textContent+=areaText;
    help.textContent=tracing?(mode==='sketch'?'Drag with a mouse, pen, or one finger to draw.':'Drag with a mouse, pen, or one finger to follow a road or river.')+' Undo removes the last stroke. Turn off Trace path to pan or add points.':
      'Click or tap to add points. Drag to pan. Keyboard: arrow keys pan, Enter adds the center, Escape finishes.';
    help.textContent+=mode==='sketch'?' Return to the start or choose Close shape to fill an outline. Clear removes all sketches and measurements; nothing is saved.':' Return to the start or choose Close shape to measure the enclosed area.';
    if(mode==='measure' && options?.hexMiles)help.textContent+=' Each hex is '+options.hexMiles+' miles across.';
    if(stroke)drawStroke();
  }
  function setTracing(value) {
    finishStroke(false);tracing=value;
    trace.setAttribute('aria-pressed',String(tracing));canvas.classList.toggle('map-tracing',active && tracing);
    if(active && tracing && !panState){
      panState=['dragging','touchZoom','boxZoom'].map(key=>[key,Boolean(map[key]?.enabled())]);
      for(const [key] of panState)map[key]?.disable();
    }else if((!active || !tracing) && panState){
      for(const [key,enabled] of panState)if(enabled)map[key]?.enable();
      panState=null;
    }
    if(active)canvas.focus({preventScroll:true});draw();
  }
  function setActive(value) {
    finishStroke(false);
    active=value;toggle.textContent=active && mode==='measure'?'Done measuring':'Measure distance';toggle.setAttribute('aria-pressed',String(active && mode==='measure'));
    sketch.textContent=active && mode==='sketch'?'Done sketching':'Sketch';sketch.setAttribute('aria-pressed',String(active && mode==='sketch'));
    canvas.classList.toggle('map-measuring',active);help.hidden=!active;
    if(active){doubleClickZoom=map.doubleClickZoom.enabled();map.doubleClickZoom.disable();canvas.focus({preventScroll:true});}
    else{if(doubleClickZoom)map.doubleClickZoom.enable();(mode==='sketch'?sketch:toggle).focus({preventScroll:true});}
    setTracing(tracing);
  }
  function chooseMode(value){
    if(canvas.classList.contains('map-editing')){summary.textContent='Save or cancel map editing before measuring or sketching.';return;}
    if(value===mode && active){setActive(false);return;}
    if(active)setActive(false);
    if(value==='sketch')tracing=true;
    else if(mode!==value)tracing=false;
    mode=value;actions=drawings[mode];setActive(true);
  }
  function closeRoute(route,forgiving=mode==='sketch'){
    return repairClosedRoute(isClosedRoute(route)?route:[...route,{...route[0]}],map.latLngToContainerPoint?point=>map.latLngToContainerPoint(point):null,{forgiving});
  }
  function add(point) {
    if(!active || tracing || !imageBounds.contains(point))return;
    const last=actions.at(-1)?.points.at(-1);
    if(last && last.lat===point.lat && last.lng===point.lng)return;
    const route=measurementRoutes(actions).at(-1);
    if(route?.length>=3 && !isClosedRoute(route) && nearStart(point,route)){
      actions.push({kind:'close',points:closeRoute(route)});draw();return;
    }
    actions.push({kind:'point',points:[{lat:point.lat,lng:point.lng}]});draw();
  }
  function nearStart(point,route){
    const start=route[0];
    if(point.lat===start.lat && point.lng===start.lng)return true;
    if(!map.latLngToContainerPoint)return false;
    const a=map.latLngToContainerPoint(point),b=map.latLngToContainerPoint(start);
    return Math.hypot(a.x-b.x,a.y-b.y)<=10 && route.some(sample=>{
      const p=map.latLngToContainerPoint(sample);return Math.hypot(p.x-b.x,p.y-b.y)>20;
    });
  }
  function startStroke(event){
    if(!active || !tracing || stroke || event.isPrimary===false || event.button!==0 || event.target.closest?.('.leaflet-control'))return;
    const point=map.mouseEventToLatLng(event);
    if(!imageBounds.contains(point))return;
    event.preventDefault();pointer=event.pointerId;lastScreen=[event.clientX,event.clientY];
    strokeLength=0;stroke=[{lat:point.lat,lng:point.lng}];canvas.setPointerCapture?.(pointer);drawStroke();
  }
  function sample(event,force=false){
    if(!stroke || event.pointerId!==pointer)return;
    const point=map.mouseEventToLatLng(event);
    if(!imageBounds.contains(point)){finishStroke(true);return;}
    // Ignore subpixel pointer jitter, without smoothing away real bends.
    if(!force && Math.hypot(event.clientX-lastScreen[0],event.clientY-lastScreen[1])<1)return;
    const last=stroke.at(-1);
    if(last.lat!==point.lat || last.lng!==point.lng){strokeLength+=routeDistance([last,point],options || {});stroke.push({lat:point.lat,lng:point.lng});}
    lastScreen=[event.clientX,event.clientY];
  }
  function moveStroke(event){
    if(!stroke || event.pointerId!==pointer)return;
    event.preventDefault();
    const samples=event.getCoalescedEvents?.();
    for(const item of samples?.length?samples:[event])sample(item);
    if(stroke)scheduleStroke();else draw();
  }
  function finishStroke(commit){
    clearPreview();
    if(!stroke)return;
    if(commit){
      if(stroke.length>=3 && !isClosedRoute(stroke) && nearStart(stroke.at(-1),stroke))stroke=closeRoute(stroke);
      else if(isClosedRoute(stroke))stroke=closeRoute(stroke);
      actions.push({kind:'stroke',points:stroke});
    }
    const oldPointer=pointer;stroke=null;pointer=null;lastScreen=null;
    if(canvas.hasPointerCapture?.(oldPointer))canvas.releasePointerCapture(oldPointer);
  }
  function endStroke(event){
    if(!stroke || event.pointerId!==pointer)return;
    sample(event,true);
    finishStroke(true);draw();
  }
  function cancelStroke(event){if(event.pointerId===pointer){finishStroke(false);draw();}}
  const viewChange=()=>{if(stroke){finishStroke(false);draw();}};
  const click=event=>add(event.latlng);
  const keydown=event=>{
    if(!active)return;
    if(event.key==='Escape'){event.preventDefault();setActive(false);return;}
    // Leave Leaflet's zoom-button and the measurement buttons' keyboard
    // behavior intact. Only the map itself accepts point/undo shortcuts.
    if(event.target!==canvas)return;
    if(event.key==='Enter' || event.key===' '){event.preventDefault();add(map.getCenter());}
    else if(event.key==='Backspace'){event.preventDefault();if(stroke)finishStroke(false);else actions.pop();draw();}
  };
  map.on('click',click);map.on('movestart zoomstart',viewChange);figure.addEventListener('keydown',keydown);
  const pointerEvents={pointerdown:startStroke,pointermove:moveStroke,pointerup:endStroke,pointercancel:cancelStroke,lostpointercapture:cancelStroke};
  for(const [name,handler] of Object.entries(pointerEvents))canvas.addEventListener(name,handler);
  help.hidden=true;draw();
  return ()=>{
    disposed=true;finishStroke(false);active=false;setTracing(false);
    if(doubleClickZoom)map.doubleClickZoom.enable();
    map.off('click',click);map.off('movestart zoomstart',viewChange);figure.removeEventListener('keydown',keydown);
    for(const [name,handler] of Object.entries(pointerEvents))canvas.removeEventListener(name,handler);
    layers.remove();preview.remove();controls.remove();help.remove();
  };
}
