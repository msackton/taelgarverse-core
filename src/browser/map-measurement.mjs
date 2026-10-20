import {routeDistance,formatDistance,isClosedRoute,routeArea,formatArea} from '../map-distance.mjs';
import {measurementRoutes} from '../map-path.mjs';

export function addMeasurement(L,map,canvas,figure,options,imageBounds) {
  if(!options)return;
  const caption=figure.querySelector('figcaption'),doc=canvas.ownerDocument;
  const controls=doc.createElement('span');controls.className='map-measure-controls';
  const button=(text,action)=>{
    const element=doc.createElement('button');element.type='button';element.textContent=text;
    element.addEventListener('click',action);controls.append(element);return element;
  };
  let active=false,tracing=false,actions=[],stroke=null,pointer=null,lastScreen=null,doubleClickZoom=false,panState;
  const toggle=button('Measure distance',()=>setActive(!active));toggle.setAttribute('aria-pressed','false');
  const trace=button('Trace path',()=>setTracing(!tracing));trace.setAttribute('aria-pressed','false');
  const close=button('Close shape',()=>{
    const route=measurementRoutes(actions).at(-1);
    if(stroke || !route || route.length<3 || isClosedRoute(route))return;
    actions.push({kind:'point',points:[{...route[0]}]});setTracing(false);
  });
  const undo=button('Undo',()=>{if(stroke)finishStroke(false);else actions.pop();draw();});
  const clear=button('Clear',()=>{actions=[];setTracing(false);(active?canvas:toggle).focus({preventScroll:true});});
  const summary=doc.createElement('span');summary.className='map-measure-summary';summary.setAttribute('role','status');
  summary.setAttribute('aria-atomic','true');
  const help=doc.createElement('span');help.className='map-measure-help';
  controls.append(summary);caption.append(controls);
  figure.append(help);
  const layers=L.layerGroup().addTo(map);
  function draw() {
    const routes=measurementRoutes(actions,stroke),count=routes.reduce((n,route)=>n+route.length,0);
    const closed=routes.filter(isClosedRoute),areas=closed.map(route=>routeArea(route,options));
    layers.clearLayers();
    for(let i=0;i<closed.length;i++)if(areas[i]!==null)L.polygon(closed[i],{className:'map-measure-area',stroke:false,fillColor:'#126c9a',fillOpacity:0.15,smoothFactor:0,interactive:false}).addTo(layers);
    for(const route of routes)if(route.length>1)L.polyline(route,{className:'map-measure-line',color:'#126c9a',weight:3,smoothFactor:0,interactive:false}).addTo(layers);
    // Dense trace samples define the line, not thousands of visible handles.
    const handles=actions.flatMap(action=>action.kind==='point'?action.points:[action.points[0],action.points.at(-1)]);
    if(stroke)handles.push(stroke[0],stroke.at(-1));
    for(const point of handles)L.circleMarker(point,{className:'map-measure-point',radius:5,color:'#fff',weight:2,fillColor:'#126c9a',fillOpacity:1,interactive:false}).addTo(layers);
    trace.hidden=!active;undo.hidden=!active;undo.disabled=!count;
    const current=routes.at(-1);
    close.hidden=!active || Boolean(stroke) || !current || current.length<3 || isClosedRoute(current);
    clear.hidden=!count && !(active && tracing);
    const length=routes.reduce((n,route)=>n+routeDistance(route,options),0);
    summary.textContent=routes.some(route=>route.length>1) ? 'Total: '+formatDistance(length,options.unit) :
      count ? 'Start point set.'+(active?' Add another point.':'') : active ? tracing?'Drag to trace a path.':'Choose a starting point.' : '';
    if(closed.length)summary.textContent+=' · '+areas.map((area,i)=>
      (areas.length===1?'Area':'Area '+(i+1))+': '+(area===null?'unavailable (outline must not cross or retrace itself)':formatArea(area,options.unit))).join(' · ');
    help.textContent=tracing?'Drag with a mouse, pen, or one finger to follow a road or river. Undo removes the last stroke. Turn off Trace path to pan or add points.':
      'Click or tap to add points. Drag to pan. Keyboard: arrow keys pan, Enter adds the center, Escape finishes.';
    help.textContent+=' Return to the start or choose Close shape to measure the enclosed area.';
    if(options.hexMiles)help.textContent+=' Each hex is '+options.hexMiles+' miles across.';
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
    active=value;toggle.textContent=active?'Done measuring':'Measure distance';toggle.setAttribute('aria-pressed',String(active));
    canvas.classList.toggle('map-measuring',active);help.hidden=!active;
    if(active){doubleClickZoom=map.doubleClickZoom.enabled();map.doubleClickZoom.disable();canvas.focus({preventScroll:true});}
    else{if(doubleClickZoom)map.doubleClickZoom.enable();toggle.focus({preventScroll:true});}
    setTracing(tracing);
  }
  function add(point) {
    if(!active || tracing || !imageBounds.contains(point))return;
    const last=actions.at(-1)?.points.at(-1);
    if(last && last.lat===point.lat && last.lng===point.lng)return;
    const route=measurementRoutes(actions).at(-1);
    if(route?.length>=3 && !isClosedRoute(route) && nearStart(point,route))point=route[0];
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
    stroke=[{lat:point.lat,lng:point.lng}];canvas.setPointerCapture?.(pointer);draw();
  }
  function sample(event,force=false){
    if(!stroke || event.pointerId!==pointer)return;
    const point=map.mouseEventToLatLng(event);
    if(!imageBounds.contains(point)){finishStroke(true);return;}
    // Ignore subpixel pointer jitter, without smoothing away real bends.
    if(!force && Math.hypot(event.clientX-lastScreen[0],event.clientY-lastScreen[1])<1)return;
    const last=stroke.at(-1);
    if(last.lat!==point.lat || last.lng!==point.lng)stroke.push({lat:point.lat,lng:point.lng});
    lastScreen=[event.clientX,event.clientY];
  }
  function moveStroke(event){
    if(!stroke || event.pointerId!==pointer)return;
    event.preventDefault();
    const samples=event.getCoalescedEvents?.();
    for(const item of samples?.length?samples:[event])sample(item);
    draw();
  }
  function finishStroke(commit){
    if(!stroke)return;
    if(commit)actions.push({kind:'stroke',points:stroke});
    const oldPointer=pointer;stroke=null;pointer=null;lastScreen=null;
    if(canvas.hasPointerCapture?.(oldPointer))canvas.releasePointerCapture(oldPointer);
  }
  function endStroke(event){
    if(!stroke || event.pointerId!==pointer)return;
    sample(event,true);
    if(stroke?.length>=3 && !isClosedRoute(stroke) && nearStart(stroke.at(-1),stroke))stroke.push({...stroke[0]});
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
    finishStroke(false);active=false;setTracing(false);
    if(doubleClickZoom)map.doubleClickZoom.enable();
    map.off('click',click);map.off('movestart zoomstart',viewChange);figure.removeEventListener('keydown',keydown);
    for(const [name,handler] of Object.entries(pointerEvents))canvas.removeEventListener(name,handler);
    controls.remove();help.remove();
  };
}
