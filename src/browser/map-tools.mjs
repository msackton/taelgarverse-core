import {addMeasurement} from './map-measurement.mjs';
import {repairClosedRoute,shapeLabelPoint} from '../map-path.mjs';
import {drawingPaths,hitDrawing,drawingsInBox,eraserRadius,eraseDrawings,applySketchCommand,sketchChanges,sketchHistoryCommand,canPatchDrawings} from '../map-sketch.mjs';
const icons={pan:'M8 12V5a1.5 1.5 0 013 0v6-7a1.5 1.5 0 013 0v7-5a1.5 1.5 0 013 0v6-3a1.5 1.5 0 013 0v5c0 5-3 7-6 7h-1c-2 0-3-1-4-3l-4-5a1.5 1.5 0 012-2l2 2',sketch:'M4 17l-1 4 4-1L20 7l-3-3zM14 7l3 3',select:'M4 3l14 9-7 1-3 7z',erase:'M3 15l8-11a2 2 0 013 0l7 6-9 11H8zM7 10l9 8M12 21h9',measure:'M3 16L16 3l5 5L8 21zM6 13l3 3m0-6l2 2m1-5l3 3',fit:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',undo:'M9 5L3 11l6 6M3 11h10a7 7 0 017 7',redo:'M15 5l6 6-6 6M21 11H11a7 7 0 00-7 7',clear:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',source:'M14 3h7v7M21 3L10 14M10 3H4v17h17v-6',fullscreen:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8l-5-5m13 5l5-5M8 16l-5 5m13-5l5 5'};
export function addMapTools(L,map,canvas,figure,config,bounds,options={}){
  const doc=canvas.ownerDocument,win=doc.defaultView,scope=options.scope??'local';
  let editable=options.editable!==false,base=options.drawings??[],pending=[],tool='pan',tracing=true,color='#b34e17',width=3,selection=[],draft=[],gesture=null,pointer=null,zooming=false,disposed=false,nextOperation=0,measurementReady=false,historyBusy=false;
  const past=[],future=[];
  const saved=L.layerGroup().addTo(map),preview=L.layerGroup().addTo(map),brush=L.layerGroup().addTo(map);
  const convert=p=>L.latLng(config.bounds[1][0]-p.y,config.bounds[0][1]+p.x);
  const source=p=>({x:p.lng-config.bounds[0][1],y:config.bounds[1][0]-p.lat});
  const extent={x:bounds.getWest()-config.bounds[0][1],y:config.bounds[1][0]-bounds.getNorth(),width:bounds.getEast()-bounds.getWest(),height:bounds.getNorth()-bounds.getSouth()};
  const onMap=p=>p.x>=extent.x&&p.y>=extent.y&&p.x<=extent.x+extent.width&&p.y<=extent.y+extent.height;
  const point=(event,clamp=true)=>{const p=source(map.mouseEventToLatLng(event));return clamp?{x:Math.max(extent.x,Math.min(extent.x+extent.width,p.x)),y:Math.max(extent.y,Math.min(extent.y+extent.height,p.y))}:p;};
  const project=p=>map.latLngToContainerPoint(convert(p));
  const units=()=>Math.abs(map.containerPointToLatLng([1,0]).lng-map.containerPointToLatLng([0,0]).lng);
  const view=()=>pending.reduce((drawings,operation)=>applySketchCommand(drawings,operation.command),base);
  const root=doc.createElement('div');root.className='map-tools';root.setAttribute('role','toolbar');root.setAttribute('aria-label','Map tools');
  let header;
  if(options.mount)options.mount.append(root);
  else{header=doc.createElement('div');header.className='map-widget-header';const title=doc.createElement('span');title.className='map-widget-title';title.textContent=figure.dataset.mapTitle||canvas.getAttribute('aria-label')?.replace(/^Map:\s*/,'')||'Map';header.append(title,root);figure.prepend(header);}
  figure.classList.add('map-with-tools');
  const svg=name=>{const icon=doc.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');const path=doc.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',icons[name]);icon.append(path);return icon;};
  const button=(label,action,{icon,container=root,small=false}={})=>{
    const node=doc.createElement('button');node.type='button';node.className='map-tool-button'+(small?' map-tool-icon':'');node.title=label;node.setAttribute('aria-label',label);
    if(icon)node.append(svg(icon));const text=doc.createElement('span');text.textContent=label;node.append(text);let activated=false;
    node.addEventListener('pointerdown',()=>{activated=false;});node.addEventListener('keydown',()=>{activated=false;});
    node.addEventListener('pointerup',event=>{const rect=node.getBoundingClientRect();if(node.disabled||event.pointerType!=='touch'||!event.isPrimary||event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)return;activated=true;action();});
    node.addEventListener('click',event=>{if(activated&&event.detail!==0){activated=false;return;}activated=false;if(!node.disabled)action();});container.append(node);return node;
  };
  const modeButtons=new Map();for(const [name,label] of [['pan','Pan'],['sketch','Sketch'],['select','Select'],['erase','Eraser'],['measure','Measure']])modeButtons.set(name,button(label,()=>choose(name),{icon:name}));
  const context=doc.createElement('span');context.className='map-tool-context';root.append(context);
  const selectedCount=doc.createElement('span');selectedCount.className='map-tool-selection';selectedCount.setAttribute('aria-live','polite');context.append(selectedCount);
  const remove=button('Delete selected',()=>emit({type:'removeDrawings',ids:selection}),{container:context});

  const menu=(label)=>{const details=doc.createElement('details');details.className='map-tools-menu';const summary=doc.createElement('summary');summary.textContent=label;summary.setAttribute('aria-label',label);const panel=doc.createElement('div');panel.className='map-tool-popover';details.append(summary,panel);root.append(details);return {details,panel,summary};};
  const settings=menu('Options'),sketchPanel=doc.createElement('div');settings.panel.append(sketchPanel);
  const field=(label,input,parent=sketchPanel)=>{const node=doc.createElement('label');node.textContent=label;node.append(input);parent.append(node);return node;};
  const trace=doc.createElement('input');trace.type='checkbox';trace.checked=true;trace.setAttribute('aria-label','Trace path');field('Trace path',trace);trace.addEventListener('change',()=>{finishDraft();tracing=trace.checked;cancel();syncMode();});
  const picker=doc.createElement('input');picker.type='color';picker.value=color;picker.setAttribute('aria-label','Drawing color');field('Color',picker);picker.addEventListener('input',()=>{color=picker.value;});
  const weight=doc.createElement('select');weight.setAttribute('aria-label','Stroke width');for(const value of [1,2,3,5,8]){const o=doc.createElement('option');o.value=String(value);o.textContent=value+' px';o.selected=value===width;weight.append(o);}field('Stroke',weight);weight.addEventListener('change',()=>{width=+weight.value;});
  const close=button('Close shape',()=>finishDraft(true),{container:sketchPanel});
  const help=doc.createElement('p');help.className='map-tool-help';sketchPanel.append(help);

  modeButtons.get('measure').title='Drag to trace; release near the start to close a shape';
  const measurement=addMeasurement(L,map,canvas,figure,config.measurement,bounds,{allowSketch:false,history:true,traceOnly:true,autoClose:true,onHistoryChange:()=>{if(measurementReady)controls();},onActiveChange:active=>{if(!active&&tool==='measure'){tool='pan';syncMode();}}});
  const measured=measurement.elements;measured.toggle.hidden=true;measured.clear.textContent='Clear measurements';measured.summary.classList.add('map-tool-readout');canvas.append(measured.summary);measured.controls.remove();measured.help.remove();
  const viewport=doc.createElement('span');viewport.className='map-tool-viewport';root.append(viewport);
  button('Zoom out',()=>map.zoomOut(),{container:viewport}).textContent='−';button('Zoom in',()=>map.zoomIn(),{container:viewport}).textContent='+';
  button('Fit map',()=>map.fitBounds(bounds),{icon:'fit',container:viewport,small:true});
  const layers=menu('Layers'),movedLayers=[...figure.querySelectorAll('.map-grid-controls,.map-region-controls,.map-detail-controls')];for(const controls of movedLayers)layers.panel.append(controls);layers.details.hidden=!movedLayers.length;
  const caption=figure.querySelector('figcaption'),sourceImage=caption.querySelector('a');
  let restoreSourceImage=()=>{};
  if(sourceImage){
    const attributes=Object.fromEntries(['class','title','aria-label'].map(name=>[name,sourceImage.getAttribute(name)])),children=[...sourceImage.childNodes];
    sourceImage.classList.add('map-tool-button','map-tool-icon');sourceImage.title='Open source image';sourceImage.setAttribute('aria-label','Open source image');
    const text=doc.createElement('span');text.textContent='Open source image';sourceImage.replaceChildren(svg('source'),text);root.append(sourceImage);
    restoreSourceImage=()=>{for(const [name,value] of Object.entries(attributes))if(value===null)sourceImage.removeAttribute(name);else sourceImage.setAttribute(name,value);sourceImage.replaceChildren(...children);caption.append(sourceImage);};
  }
  const undo=button('Undo',()=>historyAction(true),{icon:'undo',small:true}),redo=button('Redo',()=>historyAction(false),{icon:'redo',small:true});
  const clear=button('Clear annotations',()=>{if(tool==='measure')measured.clear.click();else if(['sketch','select','erase'].includes(tool))clearSketches();},{icon:'clear',small:true});
  const fullscreenTarget=options.fullscreenTarget??figure;let fullscreenView=null,fullscreenActive=false,fullscreenFrame;
  const afterFullscreenLayout=action=>{if(fullscreenFrame!==undefined)win.cancelAnimationFrame(fullscreenFrame);fullscreenFrame=win.requestAnimationFrame(()=>{fullscreenFrame=win.requestAnimationFrame(()=>{fullscreenFrame=undefined;if(disposed)return;map.invalidateSize({pan:false});action();});});};
  const camera=()=>({center:map.getCenter(),zoom:map.getZoom(),snap:map.options.zoomSnap});
  const fullscreenChanged=()=>{
    if(doc.fullscreenElement===fullscreenTarget){
      fullscreenView??=camera();fullscreenActive=true;map.options.zoomSnap=0;afterFullscreenLayout(()=>map.fitBounds(bounds,{animate:false}));
    }else if(fullscreenActive){
      const prior=fullscreenView;fullscreenActive=false;fullscreenView=null;map.options.zoomSnap=prior.snap;afterFullscreenLayout(()=>map.setView(prior.center,prior.zoom,{animate:false}));
    }
  };
  button('Fullscreen',()=>{
    if(!doc.fullscreenElement)fullscreenView=camera();
    const operation=doc.fullscreenElement?doc.exitFullscreen():fullscreenTarget.requestFullscreen?.();
    operation?.catch(error=>{fullscreenView=null;options.onError?.(error.message);});
  },{icon:'fullscreen',small:true});
  doc.addEventListener('fullscreenchange',fullscreenChanged);fullscreenChanged();
  const label=doc.createElement('span');label.className='map-tool-scope';label.textContent=scope==='shared'?'Shared':'Temporary';label.title=scope==='shared'?'Drawings save and are shared with this room':'Sketches are private and temporary';root.append(label);
  map.zoomControl?.remove();
  function controls(){
    const clearingSketches=['sketch','select','erase'].includes(tool),clearLabel=tool==='measure'?'Clear measurements':clearingSketches?scope==='shared'?'Clear shared drawings':'Clear sketches':'Clear annotations';
    clear.disabled=tool!=='measure'&&!clearingSketches;clear.title=clear.disabled?'Choose Sketch or Measure to clear its annotations':clearLabel;clear.setAttribute('aria-label',clearLabel);clear.querySelector('span').textContent=clearLabel;
    const drawings=view();selection=selection.filter(id=>drawings.some(d=>d.id===id));
    for(const [name,node] of modeButtons){node.setAttribute('aria-pressed',String(tool===name));node.hidden=!editable&&['sketch','select','erase'].includes(name);node.disabled=name==='measure'&&!config.measurement;}
    selectedCount.hidden=tool!=='select';selectedCount.textContent=selection.length+' selected';remove.hidden=tool!=='select'||!selection.length;remove.disabled=!editable;
    const drawingMode=['sketch','select','erase'].includes(tool);
    undo.disabled=tool==='measure'?!measurement.canUndo():!drawingMode||!editable||historyBusy||pending.length>0||!historyAvailable(true);redo.disabled=tool==='measure'?!measurement.canRedo():!drawingMode||!editable||historyBusy||pending.length>0||!historyAvailable(false);
    undo.title='Undo '+(tool==='measure'?'measurement':'sketch change');redo.title='Redo '+(tool==='measure'?'measurement':'sketch change');
    settings.details.hidden=tool!=='sketch';measured.summary.hidden=tool!=='measure';
    close.hidden=tool!=='sketch'||draft.length<3;trace.closest('label').hidden=tool!=='sketch';picker.closest('label').hidden=tool!=='sketch';weight.closest('label').hidden=tool!=='sketch';
    help.textContent=tool==='erase'?'Drag to erase parts of strokes. Move faster for a larger brush. Filled shapes erase as a whole.':tracing?'Drag to sketch. Return to the start to close a shape.':'Click or tap to add points; drag to pan. Close shape fills the outline. Choose Pan or press Escape to finish.';
    if(settings.details.hidden)settings.details.open=false;
  }
  const sameDraft=(a,b)=>a.length===b.length&&a.every((p,i)=>p.x===b[i].x&&p.y===b[i].y);
  function record(entry){
    if(!entry.changes.length&&sameDraft(entry.beforeDraft,entry.afterDraft))return null;
    past.push(entry);future.length=0;
    const weight=item=>item.changes.reduce((n,change)=>n+[change.before,change.after].filter(Boolean).reduce((sum,d)=>sum+drawingPaths(d).reduce((count,path)=>count+path.length,0),0),0);
    let total=past.reduce((n,item)=>n+weight(item),0);while(past.length>50||past.length>1&&total>120000)total-=weight(past.shift());return entry;
  }
  function historyAvailable(back){const entry=(back?past:future).at(-1);return !!entry&&sameDraft(draft,back?entry.afterDraft:entry.beforeDraft)&&canPatchDrawings(view(),sketchHistoryCommand(entry.changes,back).patches);}
  async function historyAction(back){
    if(tool==='measure'){(back?measurement.undo:measurement.redo)();canvas.focus({preventScroll:true});return;}
    if(gesture){cancel();return;}
    if(!editable||!['sketch','select','erase'].includes(tool)||historyBusy||pending.length||!historyAvailable(back))return;
    historyBusy=true;
    const from=back?past:future,to=back?future:past,entry=from.at(-1);
    cancel();const nextDraft=back?entry.beforeDraft:entry.afterDraft;
    try{if(!entry.changes.length||await emit(sketchHistoryCommand(entry.changes,back),{remember:false})){
      if(disposed)return;from.pop();to.push(entry);draft=nextDraft;selection=[];redraw();canvas.focus({preventScroll:true});
    }}finally{historyBusy=false;redraw();}
  }
  function clearSketches(){
    if(scope==='shared'&&!win.confirm('Clear all shared drawings on this map?'))return;
    const beforeDraft=draft;draft=[];selection=[];cancel();
    if(view().length)emit({type:'clearDrawings'},{beforeDraft});else record({changes:[],beforeDraft,afterDraft:draft});
    settings.details.open=false;redraw();canvas.focus({preventScroll:true});
  }
  function emit(command,{remember=true,beforeDraft=draft}={}){
    if(disposed||!editable)return Promise.resolve(false);
    const before=view(),after=applySketchCommand(before,command),entry=remember?record({changes:sketchChanges(before,after),beforeDraft,afterDraft:draft}):null;
    if(!options.onCommand){base=after;redraw();return Promise.resolve(true);}
    const operation={id:++nextOperation,command};pending.push(operation);redraw();
    const forget=()=>{if(entry){const index=past.indexOf(entry);if(index>=0)past.splice(index,1);}};
    return Promise.resolve().then(()=>options.onCommand(command)).then(receipt=>{if(entry&&Array.isArray(receipt?.changes)){entry.changes=receipt.changes;if(!entry.changes.length||receipt.undoable===false)forget();}return true;}).catch(error=>{forget();options.onError?.(error instanceof Error?error.message:'The drawing could not be saved.');return false;}).finally(()=>{if(disposed)return;pending=pending.filter(p=>p!==operation);redraw();});
  }
  function commit(points,closed=false){
    if(points.length<(closed?3:2))return;
    const stride=Math.max(1,Math.ceil(points.length/1999));points=points.filter((_,i)=>i%stride===0||i===points.length-1);
    if(closed){const route=points.map(convert);if(route[0].lat!==route.at(-1).lat||route[0].lng!==route.at(-1).lng)route.push(route[0]);points=repairClosedRoute(route,p=>map.latLngToContainerPoint(p),{forgiving:true}).slice(0,-1).map(source);if(points.length<3)return;}
    return emit({type:'addDrawing',drawing:{id:win.crypto.randomUUID(),color,width,closed,points}});
  }
  function finishDraft(closed=false){const points=draft;while(past.at(-1)?.changes.length===0)past.pop();for(let i=future.length-1;i>=0;i--)if(!future[i].changes.length)future.splice(i,1);draft=[];if(points.length>=2)commit(points,closed);redraw();}
  function syncMode(){
    const editing=editable&&['sketch','select','erase'].includes(tool),drawing=editing&&(tool!=='sketch'||tracing);
    canvas.classList.toggle('map-editing',editing);canvas.classList.toggle('map-tool-drawing',drawing);
    for(const name of ['dragging','touchZoom','doubleClickZoom'])map[name]?.[drawing?'disable':'enable']();
    canvas.style.cursor=editing&&tool!=='select'?'crosshair':'';controls();
  }
  function choose(next){
    if(next===tool&&['sketch','measure'].includes(tool))next='pan';
    if(!editable&&['sketch','select','erase'].includes(next))return;
    if(tool==='sketch'&&next!=='sketch')finishDraft();measurement.stop();cancel();tool=next;syncMode();if(tool==='measure')measurement.activate();
  }
  function redraw(){
    if(disposed)return;saved.clearLayers();let drawings=view();if(gesture?.kind==='erase')drawings=gesture.preview;
    let shapeNumber=0;
    for(const d of drawings){const opts={color:selection.includes(d.id)?'#d39c22':d.color,weight:d.width+(selection.includes(d.id)?3:0),fillOpacity:.15,interactive:false,className:'map-sketch-path'+(selection.includes(d.id)?' is-selected':'')};
      const layer=d.closed?L.polygon(d.points.map(convert),opts):L.polyline(drawingPaths(d).map(path=>path.map(convert)),opts);layer.addTo(saved);layer.getElement()?.setAttribute('data-drawing-id',d.id);
      if(d.closed){shapeNumber++;const route=d.points.map(convert);route.push(route[0]);const icon=L.divIcon({className:'map-shape-label map-shape-label-sketch',html:String(shapeNumber),iconSize:[24,24],iconAnchor:[12,12]});L.marker(shapeLabelPoint(route),{icon,interactive:false,keyboard:false,title:'Shape '+shapeNumber}).addTo(saved);}}
    preview.clearLayers();
    if(draft.length){L.polyline(draft.map(convert),{color,weight:width,interactive:false}).addTo(preview);for(const p of draft)L.circleMarker(convert(p),{className:'map-sketch-point',radius:4,color:'#fff',weight:2,fillColor:color,fillOpacity:1,interactive:false}).addTo(preview);}
    if(gesture?.kind==='sketch')L.polyline(gesture.points.map(convert),{color,weight:width,interactive:false}).addTo(preview);
    if(gesture?.kind==='select'&&gesture.moved)L.rectangle([convert(gesture.start),convert(gesture.end)],{color:'#287c79',weight:1,dashArray:'5 4',fillOpacity:.1,interactive:false}).addTo(preview);
    controls();
  }
  function cancel(){const old=pointer;gesture=null;pointer=null;brush.clearLayers();if(old!==null&&canvas.hasPointerCapture(old))canvas.releasePointerCapture(old);redraw();}
  const brushAt=(p,r)=>{brush.clearLayers();L.circleMarker(convert(p),{radius:r,color:'#284c3c',weight:1.5,fillColor:'#fff',fillOpacity:.45,interactive:false,className:'map-sketch-eraser'}).addTo(brush);};
  function down(event){
    if(!editable||!['sketch','select','erase'].includes(tool)||tool==='sketch'&&!tracing||zooming||event.button!==0||event.isPrimary===false||event.target.closest?.('.leaflet-control'))return;
    const p=point(event,false);if(tool!=='select'&&!onMap(p))return;
    event.preventDefault();event.stopPropagation();canvas.focus({preventScroll:true});pointer=event.pointerId;canvas.setPointerCapture(pointer);const screen={x:event.clientX,y:event.clientY};
    if(tool==='select')gesture={kind:'select',start:p,end:p,screen,additive:event.shiftKey,moved:false};
    else if(tool==='erase'){gesture={kind:'erase',trail:[{...p,radius:Math.min(100000,10*units())}],last:screen,time:event.timeStamp,radius:10};gesture.preview=eraseDrawings(view(),gesture.trail);brushAt(p,10);}
    else gesture={kind:'sketch',points:[p],last:screen};redraw();
  }
  function move(event){
    if(tool==='erase'&&editable&&!gesture)brushAt(point(event,false),10);
    if(!gesture||pointer!==event.pointerId)return;event.preventDefault();
    if(gesture.kind==='select'){gesture.end=point(event,false);gesture.moved ||= Math.hypot(event.clientX-gesture.screen.x,event.clientY-gesture.screen.y)>=5;redraw();return;}
    const samples=event.getCoalescedEvents?.();
    for(const e of samples?.length?samples:[event]){const distance=Math.hypot(e.clientX-gesture.last.x,e.clientY-gesture.last.y);if(distance<(gesture.kind==='erase'?3:1))continue;const p=point(e);
      if(gesture.kind==='sketch')gesture.points.push(p);else{gesture.radius=eraserRadius(distance/Math.max(1,e.timeStamp-gesture.time),gesture.radius);gesture.time=e.timeStamp;const previous=gesture.trail.at(-1),next={...p,radius:Math.min(100000,gesture.radius*units())};gesture.trail.push(next);gesture.preview=eraseDrawings(gesture.preview,[previous,next]);brushAt(p,gesture.radius);}gesture.last={x:e.clientX,y:e.clientY};}
    redraw();
  }
  function up(event){
    if(!gesture||pointer!==event.pointerId)return;move(event);const finished=gesture;
    if(finished.kind==='sketch'){const points=finished.points,first=project(points[0]),last=project(points.at(-1));commit(points,points.length>=3&&Math.hypot(first.x-last.x,first.y-last.y)<=10);}
    else if(finished.kind==='select'){
      if(finished.moved){const a=finished.start,b=finished.end,ids=drawingsInBox(view(),{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});selection=finished.additive?[...new Set([...selection,...ids])]:ids;}
      else{const projected=view().map(d=>({...d,points:d.points.map(project),...(d.segments?{segments:d.segments.map(path=>path.map(project))}:{})})),id=hitDrawing(projected,map.mouseEventToContainerPoint(event),8);selection=id?finished.additive?selection.includes(id)?selection.filter(v=>v!==id):[...selection,id]:[id]:finished.additive?selection:[];}
    }else emit({type:'eraseDrawings',trail:finished.trail});cancel();
  }
  const click=event=>{if(tool!=='sketch'||tracing||!editable)return;const p=source(event.latlng);if(!onMap(p))return;if(draft.length>=3&&Math.hypot(project(p).x-project(draft[0]).x,project(p).y-project(draft[0]).y)<=10){finishDraft(true);return;}const beforeDraft=draft;draft=[...draft,p];record({changes:[],beforeDraft,afterDraft:draft});redraw();};
  const stopClick=event=>{if(editable&&(['select','erase'].includes(tool)||tool==='sketch'&&tracing)){event.preventDefault();event.stopImmediatePropagation();}};
  const lost=()=>{if(gesture)cancel();};
  const zoomStart=()=>{zooming=true;cancel();},zoomEnd=()=>{zooming=false;};
  const keydown=event=>{if(event.target!==canvas||!editable||tool==='measure')return;if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();void historyAction(!(event.shiftKey||event.key.toLowerCase()==='y'));return;}if(event.key==='Escape'){event.preventDefault();if(tool==='select'){selection=[];redraw();}else choose('pan');}else if(tool==='select'&&['Delete','Backspace'].includes(event.key)){event.preventDefault();if(selection.length)emit({type:'removeDrawings',ids:selection});}else if(tool==='select'&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();selection=view().map(d=>d.id);redraw();}else if(tool==='sketch'&&event.key==='Backspace'){event.preventDefault();undo.click();}else if(tool==='sketch'&&!tracing&&['Enter',' '].includes(event.key)){event.preventDefault();click({latlng:map.getCenter()});}};
  const outside=event=>{if(!root.contains(event.target))for(const item of [settings,layers])item.details.open=false;};
  const menuKey=event=>{if(event.key==='Escape')for(const item of [settings,layers])if(item.details.open){event.preventDefault();event.stopPropagation();item.details.open=false;item.summary.focus();}};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',lost);canvas.addEventListener('lostpointercapture',lost);canvas.addEventListener('click',stopClick,true);canvas.addEventListener('keydown',keydown);root.addEventListener('keydown',menuKey);doc.addEventListener('pointerdown',outside,true);
  map.on('click',click);map.on('movestart',lost);map.on('zoomstart',zoomStart);map.on('zoomend',zoomEnd);measurementReady=true;syncMode();redraw();
  const dispose=()=>{disposed=true;doc.removeEventListener('fullscreenchange',fullscreenChanged);if(fullscreenFrame!==undefined)win.cancelAnimationFrame(fullscreenFrame);if(fullscreenActive)map.options.zoomSnap=fullscreenView.snap;cancel();measurement();measured.summary.remove();saved.remove();preview.remove();brush.remove();restoreSourceImage();for(const controls of movedLayers)if(controls.isConnected)figure.querySelector('figcaption').append(controls);root.remove();header?.remove();figure.classList.remove('map-with-tools');canvas.classList.remove('map-editing','map-tool-drawing');canvas.style.cursor='';for(const [name,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',lost],['lostpointercapture',lost],['click',stopClick],['keydown',keydown]])canvas.removeEventListener(name,fn,name==='click');root.removeEventListener('keydown',menuKey);doc.removeEventListener('pointerdown',outside,true);map.off('click',click);map.off('movestart',lost);map.off('zoomstart',zoomStart);map.off('zoomend',zoomEnd);};
  dispose.getState=()=>({drawings:view(),editable});
  dispose.update=value=>{if(value.drawings){base=value.drawings;if(gesture?.kind==='erase')gesture.preview=eraseDrawings(view(),gesture.trail);}if(value.editable!==undefined&&editable!==value.editable){editable=value.editable;if(!editable){draft=[];choose('pan');}}redraw();};
  dispose.stop=()=>choose('pan');return dispose;
}
