import {routeDistance,formatDistance} from '../map-distance.mjs';

export function addMeasurement(L,map,canvas,figure,options,imageBounds) {
  if(!options)return;
  const caption=figure.querySelector('figcaption'),doc=canvas.ownerDocument;
  const controls=doc.createElement('span');controls.className='map-measure-controls';
  const button=(text,action)=>{
    const element=doc.createElement('button');element.type='button';element.textContent=text;
    element.addEventListener('click',action);controls.append(element);return element;
  };
  let active=false,points=[],doubleClickZoom=false;
  const toggle=button('Measure distance',()=>setActive(!active));toggle.setAttribute('aria-pressed','false');
  const undo=button('Undo',()=>{points.pop();draw();});
  const clear=button('Clear',()=>{points=[];draw();(active?canvas:toggle).focus({preventScroll:true});});
  const summary=doc.createElement('span');summary.className='map-measure-summary';summary.setAttribute('role','status');
  summary.setAttribute('aria-atomic','true');
  const help=doc.createElement('span');help.className='map-measure-help';
  help.textContent='Click or tap to add points. Drag to pan. Keyboard: arrow keys pan, Enter adds the center, Escape finishes.';
  if(options.hexMiles)help.textContent+=' Each hex is '+options.hexMiles+' miles across.';
  controls.append(summary);caption.append(controls);
  figure.append(help);
  const layers=L.layerGroup().addTo(map);
  function draw() {
    layers.clearLayers();
    if(points.length>1)L.polyline(points,{className:'map-measure-line',color:'#126c9a',weight:3,interactive:false}).addTo(layers);
    for(const point of points)L.circleMarker(point,{className:'map-measure-point',radius:5,color:'#fff',weight:2,fillColor:'#126c9a',fillOpacity:1,interactive:false}).addTo(layers);
    undo.hidden=!active;undo.disabled=!points.length;
    clear.hidden=!points.length;
    summary.textContent=points.length>1 ? 'Total: '+formatDistance(routeDistance(points,options),options.unit) :
      points.length ? 'Start point set.'+(active?' Add another point.':'') : active ? 'Choose a starting point.' : '';
  }
  function setActive(value) {
    active=value;toggle.textContent=active?'Done measuring':'Measure distance';toggle.setAttribute('aria-pressed',String(active));
    canvas.classList.toggle('map-measuring',active);help.hidden=!active;
    if(active){doubleClickZoom=map.doubleClickZoom.enabled();map.doubleClickZoom.disable();canvas.focus({preventScroll:true});}
    else{if(doubleClickZoom)map.doubleClickZoom.enable();toggle.focus({preventScroll:true});}
    draw();
  }
  function add(point) {
    if(!active || !imageBounds.contains(point))return;
    const last=points.at(-1);
    if(last && last.lat===point.lat && last.lng===point.lng)return;
    points.push({lat:point.lat,lng:point.lng});draw();
  }
  map.on('click',event=>add(event.latlng));
  figure.addEventListener('keydown',event=>{
    if(!active)return;
    if(event.key==='Escape'){event.preventDefault();setActive(false);return;}
    // Leave Leaflet's zoom-button and the measurement buttons' keyboard
    // behavior intact. Only the map itself accepts point/undo shortcuts.
    if(event.target!==canvas)return;
    if(event.key==='Enter' || event.key===' '){event.preventDefault();add(map.getCenter());}
    else if(event.key==='Backspace'){event.preventDefault();points.pop();draw();}
  });
  help.hidden=true;draw();
}
