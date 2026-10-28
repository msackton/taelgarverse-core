import {FuzzySuggestModal} from 'obsidian';
import {coreToLatLng,latLngToCore,inCrop} from '../../../src/map-core.mjs';
import {DEFAULT_MAP_IMPORTANCE,MAP_IMPORTANCE} from '../../../src/map-importance.mjs';
import {storedMapPath,validateMapPath,MAX_MAP_PATH_POINTS,MAP_PATH_STYLES} from '../../../src/map-feature-path.mjs';
import {addMapFeaturePaths} from '../../../src/browser/map-feature-paths.mjs';
import {captureMapPath,readMapPathDocument,saveMapPathNote} from './path-persistence.mjs';
import {readMapNote} from './persistence.mjs';

function chooseNote(app,onChoose){
  class PathPicker extends FuzzySuggestModal {
    constructor(){super(app);this.setPlaceholder('Choose the river or road note…');}
    getItems(){return app.vault.getMarkdownFiles().sort((a,b)=>a.path.localeCompare(b.path));}
    getItemText(file){return (file.basename??file.name)+' — '+file.path;}
    onChooseItem(file){void onChoose(file);}
  }
  const picker=new PathPicker();picker.open();return picker;
}

export function mountNotePaths({L,map,canvas,figure,config,manifest,app,sourcePath,editable=false,onSaved,selectNote=chooseNote}){
  const doc=canvas.ownerDocument,notes=new Map(),refs=[],offset=manifest.sourceOffset;
  let session=null,points=[],history=[],busy=false,disposed=false,picker,tracing=false,stroke=null,frame,panState,doubleZoom;
  const ll=point=>coreToLatLng(point.map((v,i)=>v-offset[i]),manifest.height);
  const localPoint=latlng=>latLngToCore([latlng.lat,latlng.lng],manifest.height);
  const extent={x:0,y:0,width:manifest.width,height:manifest.height};
  const definitions=new Map(),loads=new Map();let refreshFrame;
  const pathConfig=()=>({...config,sourceOffset:offset,mapPaths:[...notes.values()].filter(item=>item.id!==session?.path)});
  const saved=addMapFeaturePaths(L,map,canvas,pathConfig(),note=>app.workspace.openLinkText(note,sourcePath,false));
  const refresh=()=>{if(!disposed)saved.update(pathConfig());};
  const scheduleRefresh=()=>{
    if(refreshFrame!==undefined || disposed)return;
    refreshFrame=doc.defaultView.requestAnimationFrame(()=>{refreshFrame=undefined;refresh();});
  };
  const record=async file=>{
    if(disposed || file.extension!=='md')return;
    const id=file.path,token=Symbol(),definition=storedMapPath(app.metadataCache.getFileCache(file)?.frontmatter?.mapPath);
    loads.set(id,token);definitions.set(id,{file,definition});
    let value;
    try{value=(await readMapPathDocument(app,definition)).path;}catch{value=null;}
    if(disposed || loads.get(id)!==token)return;
    const old=notes.get(id);
    if(value)notes.set(id,{...value,id,name:file.basename??file.name??id});else notes.delete(id);
    if(JSON.stringify(old)!==JSON.stringify(notes.get(id)))scheduleRefresh();
  };
  const forget=id=>{loads.delete(id);definitions.delete(id);if(notes.delete(id))scheduleRefresh();};
  const sourceChanged=source=>{for(const {file,definition} of definitions.values())if(definition?.source===source)void record(file);};
  const listen=(owner,name,fn)=>{const ref=owner.on?.(name,fn);if(ref)refs.push([owner,ref]);};
  listen(app.metadataCache,'changed',file=>void record(file));
  listen(app.vault,'modify',file=>sourceChanged(file.path));
  listen(app.vault,'create',file=>sourceChanged(file.path));
  listen(app.vault,'delete',file=>{forget(file.path);sourceChanged(file.path);});
  listen(app.vault,'rename',(file,oldPath)=>{forget(oldPath);void record(file);sourceChanged(oldPath);sourceChanged(file.path);});
  for(const file of app.vault.getMarkdownFiles())void record(file);
  const controls=doc.createElement('fieldset');controls.className='map-path-editor';
  const legend=doc.createElement('legend');legend.textContent='Rivers and roads';controls.append(legend);
  const button=(name,fn)=>{const b=doc.createElement('button');b.type='button';b.textContent=name;b.addEventListener('click',fn);controls.append(b);return b;};
  const field=name=>{const label=doc.createElement('label');label.textContent=name+' ';const select=doc.createElement('select');select.setAttribute('aria-label',name);label.append(select);controls.append(label);return select;};
  const option=(select,value,text)=>{const el=doc.createElement('option');el.value=value;el.textContent=text;select.append(el);};
  const choose=button('Draw or edit river / road',()=>{if(!session && !busy)picker=selectNote(app,begin);});
  const kind=field('Path kind');option(kind,'river','River');option(kind,'road','Road');
  const importance=field('Path importance');for(const tier of MAP_IMPORTANCE)option(importance,tier.value,tier.label+' · '+tier.detail);
  const vertex=field('Path vertex');
  const center=button('Add path point at center',()=>pick(map.getCenter()));
  const remove=button('Remove path point',()=>{if(!canEdit() || vertex.value==='append')return;remember();points.splice(Number(vertex.value),1);redraw();});
  const undo=button('Undo path edit',()=>{if(!canEdit() || !history.length)return;points=history.pop();redraw();});
  const replace=button('Redraw path',()=>{if(!canEdit())return;remember();points=[];redraw();});
  const trace=button('Trace river / road',()=>{if(canEdit()){tracing=!tracing;navigation();state();}});
  const save=button('Save path',()=>void commit());
  const del=button('Delete saved path',()=>{if(canEdit()){deleting=true;status.textContent='Delete this note’s saved path? Choose Confirm path deletion or Cancel path.';state();}});
  const confirm=button('Confirm path deletion',()=>void commit(true));
  const cancel=button('Cancel path',()=>{if(!busy)end();});
  const status=doc.createElement('span');status.className='map-path-status';status.setAttribute('role','status');controls.append(status);
  if(editable)figure.querySelector('figcaption').append(controls);
  const drawing=L.layerGroup().addTo(map);let line,first,last,deleting=false;
  const canEdit=()=>!!session && !busy && !disposed && !stroke && !deleting;
  function state(){
    choose.disabled=!!session || busy;
    for(const input of [kind,importance,vertex]){input.parentElement.hidden=!session;input.disabled=busy || !!stroke || deleting;}
    vertex.disabled ||= tracing;
    for(const b of [center,remove,undo,replace,trace,save,del,cancel]){b.hidden=!session;b.disabled=busy || !!stroke || (deleting && b!==cancel);}
    remove.disabled ||= tracing || vertex.value==='append';center.disabled ||= tracing;undo.disabled ||= !history.length;
    save.disabled ||= points.length<2;del.hidden=!session || session.guard.raw===null;
    confirm.hidden=!deleting;confirm.disabled=busy;trace.setAttribute('aria-pressed',String(tracing));
    canvas.classList.toggle('map-editing-path',!!session || busy);
    canvas.classList.toggle('map-editing',!!session || busy || canvas.classList.contains('map-placing-town') || canvas.classList.contains('map-editing-region'));
  }
  function navigation(){
    canvas.classList.toggle('map-path-tracing',!!session && tracing);
    if(session && tracing && !panState){
      panState=['dragging','touchZoom','boxZoom'].map(key=>[key,Boolean(map[key]?.enabled())]);for(const [key] of panState)map[key]?.disable();
    }else if((!session || !tracing) && panState){for(const [key,enabled] of panState)if(enabled)map[key]?.enable();panState=null;}
  }
  function remember(){history.push(points.map(p=>[...p]));if(history.length>100)history.shift();}
  function drawLine(){
    if(!session || disposed)return;
    const style=MAP_PATH_STYLES[kind.value],coords=points.map(ll);
    if(!line)line=L.polyline(coords,{...style,smoothFactor:0,interactive:false}).addTo(drawing);
    else{line.setLatLngs(coords);line.setStyle(style);}
    if(coords.length){
      if(!first){first=L.circleMarker(coords[0],{radius:4,color:style.color,interactive:false}).addTo(drawing);last=L.circleMarker(coords.at(-1),{radius:4,color:style.color,interactive:false}).addTo(drawing);}
      else{first.setLatLng(coords[0]);last.setLatLng(coords.at(-1));}
    }
    status.textContent=session.path+' · '+points.length+' points · Unsaved. Click to add points or select a vertex to move it.';
  }
  function redraw(){
    if(frame!==undefined){doc.defaultView.cancelAnimationFrame(frame);frame=undefined;}
    drawing.clearLayers();line=first=last=null;vertex.replaceChildren();option(vertex,'append','Add point');
    points.forEach((p,i)=>option(vertex,String(i),'Point '+(i+1)+' · '+p.map(v=>v.toFixed(1)).join(', ')));vertex.value='append';drawLine();state();
  }
  function schedule(){if(frame===undefined)frame=doc.defaultView.requestAnimationFrame(()=>{frame=undefined;drawLine();});}
  async function begin(file){
    if(!editable || disposed || session || busy)return;
    if(canvas.classList.contains('map-editing') || canvas.classList.contains('map-measuring')){status.textContent='Finish the current map tool first.';return;}
    busy=true;state();
    try{
      const path=file.path,note=await readMapNote(app,path);if(disposed)return;
      const guard=captureMapPath(note),loaded=await readMapPathDocument(app,guard.path);if(disposed)return;
      session={file,path,guard,document:loaded.document};points=structuredClone(loaded.path?.points??[]);history=[];
      const metadata=app.metadataCache.getFileCache(file)?.frontmatter;
      kind.value=guard.path?.kind??(/river|waterway/i.test(String(metadata?.typeOf)+' '+String(metadata?.typeOfAlias))?'river':'road');
      importance.value=guard.path?.importance??DEFAULT_MAP_IMPORTANCE;
      doubleZoom=map.doubleClickZoom?.enabled();map.doubleClickZoom?.disable();refresh();redraw();
    }catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;if(!disposed)state();}
  }
  function pick(latlng){
    if(!canEdit() || tracing)return;
    const point=localPoint(latlng);if(!inCrop(point,extent)){status.textContent='Choose a point inside this export.';return;}
    const selected=vertex.value;
    if(selected==='append' && points.length>=MAX_MAP_PATH_POINTS){status.textContent='A path can have at most 10,000 points.';return;}
    remember();const p=point.map((v,i)=>v+offset[i]);if(selected==='append')points.push(p);else points[Number(selected)]=p;redraw();
  }
  function finishStroke(commit){
    if(!stroke)return;
    const {before,id}=stroke;stroke=null;
    if(commit){history.push(before);if(history.length>100)history.shift();}else points=before;
    if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);redraw();
  }
  function sample(event,force=false){
    if(!stroke || event.pointerId!==stroke.id)return;
    const local=localPoint(map.mouseEventToLatLng(event));
    if(!inCrop(local,extent) || points.length>=MAX_MAP_PATH_POINTS){finishStroke(true);return;}
    if(!force && Math.hypot(event.clientX-stroke.x,event.clientY-stroke.y)<1)return;
    const point=local.map((v,i)=>v+offset[i]),last=points.at(-1);
    if(!last || last.some((v,i)=>v!==point[i]))points.push(point);
    stroke.x=event.clientX;stroke.y=event.clientY;
  }
  const down=event=>{
    if(!canEdit() || !tracing || event.isPrimary===false || event.button!==0 || event.target.closest?.('.leaflet-control'))return;
    if(!inCrop(localPoint(map.mouseEventToLatLng(event)),extent))return;
    event.preventDefault();stroke={before:points.map(p=>[...p]),id:event.pointerId,x:event.clientX,y:event.clientY};
    canvas.setPointerCapture?.(event.pointerId);sample(event,true);drawLine();state();
  };
  const move=event=>{if(!stroke || event.pointerId!==stroke.id)return;event.preventDefault();const events=event.getCoalescedEvents?.();for(const e of events?.length?events:[event])sample(e);if(stroke)schedule();};
  const up=event=>{if(stroke?.id!==event.pointerId)return;sample(event,true);finishStroke(true);};
  const abort=event=>{if(stroke?.id===event.pointerId)finishStroke(false);};
  const viewChange=()=>finishStroke(false);
  function end(message=''){
    finishStroke(false);session=null;points=[];history=[];deleting=false;tracing=false;
    navigation();if(doubleZoom)map.doubleClickZoom?.enable();doubleZoom=false;redraw();refresh();status.textContent=message;
  }
  async function commit(removePath=false){
    if(!session || busy || disposed || stroke || (deleting && !removePath))return;
    try{
      const value=removePath?null:validateMapPath({kind:kind.value,importance:importance.value,points});busy=true;state();
      const current=session;
      const result=await saveMapPathNote(app,current,value,{isOpen:()=>!disposed});
      if(disposed)return;
      loads.delete(current.path);definitions.set(current.path,{file:current.file,definition:result.guard.path});
      if(result.path)notes.set(current.path,{...result.path,id:current.path,name:current.file.basename??current.file.name??current.path});else notes.delete(current.path);
      onSaved?.(current.file,result.path);busy=false;end('Saved '+current.path);
    }catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;if(!disposed)state();}
  }
  const click=event=>pick(event.latlng),keys=event=>{if(session && event.key==='Escape' && !busy){event.preventDefault();end();}};
  kind.addEventListener('change',()=>{if(canEdit())redraw();});vertex.addEventListener('change',state);
  const pointerEvents={pointerdown:down,pointermove:move,pointerup:up,pointercancel:abort,lostpointercapture:abort};
  if(editable){map.on('click',click);map.on('movestart zoomstart',viewChange);figure.addEventListener('keydown',keys);for(const [name,fn] of Object.entries(pointerEvents))canvas.addEventListener(name,fn);}
  if(editable)state();
  const dispose=()=>{
    disposed=true;picker?.close?.();finishStroke(false);session=null;tracing=false;navigation();if(doubleZoom)map.doubleClickZoom?.enable();
    if(frame!==undefined)doc.defaultView.cancelAnimationFrame(frame);
    if(refreshFrame!==undefined)doc.defaultView.cancelAnimationFrame(refreshFrame);loads.clear();
    map.off('click',click);map.off('movestart zoomstart',viewChange);figure.removeEventListener('keydown',keys);
    for(const [name,fn] of Object.entries(pointerEvents))canvas.removeEventListener(name,fn);
    for(const [owner,ref] of refs)owner.offref?.(ref);saved();drawing.remove();controls.remove();
    if(editable){canvas.classList.remove('map-editing-path');if(!canvas.classList.contains('map-placing-town') && !canvas.classList.contains('map-editing-region'))canvas.classList.remove('map-editing');}
  };
  dispose.update=next=>{config=next;refresh();};
  dispose.updateNote=(file,path)=>{if(disposed)return;loads.delete(file.path);if(path)notes.set(file.path,{...path,id:file.path,name:file.basename??file.name??file.path});else notes.delete(file.path);refresh();};
  return dispose;
}
