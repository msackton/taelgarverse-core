import {FuzzySuggestModal} from 'obsidian';
import {coreToLatLng,latLngToCore,inCrop} from '../../../src/map-core.mjs';
import {mapLocation,storedMapLocation,captureMapLocation,patchMapLocation} from '../../../src/map-location.mjs';
import {readMapNote,writeMapNote} from './persistence.mjs';
import {DEFAULT_MAP_IMPORTANCE,MAP_IMPORTANCE,mapImportance,importanceVisible} from '../../../src/map-importance.mjs';
import symbols from '../../../src/map-symbols.json' with {type:'json'};
import {DEFAULT_MAP_SYMBOL,MAP_SYMBOLS,mapSymbol} from '../../../src/map-symbols.mjs';
import {hexLevel} from '../../../src/map-hex-hierarchy.mjs';

function chooseTown(app,onChoose){
  // Keep the host class lazy: loading other plugin features needs no picker.
  class TownPicker extends FuzzySuggestModal {
    constructor(){super(app);this.setPlaceholder('Choose a town note (name or path)…');}
    getItems(){return app.vault.getMarkdownFiles()
      .filter(file=>app.metadataCache.getFileCache(file)?.frontmatter?.typeOf==='settlement')
      .sort((a,b)=>a.path.localeCompare(b.path));}
    getItemText(file){return (file.basename??file.name)+' — '+file.path;}
    onChooseItem(file){void onChoose(file);}
  }
  const picker=new TownPicker();picker.open();return picker;
}

// Plugin-only annotation layer. Stored town points always use the original
// Photoshop frame; cropping is evaluated in this export's local frame.
export function mountTownPlacement({L,map,canvas,config,figure,manifest,app,sourcePath,onSaved,editable=false,selectNote=chooseTown}){
  const doc=canvas.ownerDocument,height=manifest.height,offset=manifest.sourceOffset;
  const local=position=>[position.x-offset[0],position.y-offset[1]];
  const visible=position=>inCrop(local(position),config.crop);
  const ll=position=>coreToLatLng(local(position),height);
  const controls=doc.createElement('div');controls.className='map-town-controls';
  const button=(label,fn)=>{const el=doc.createElement('button');el.type='button';el.textContent=label;el.addEventListener('click',fn);controls.append(el);return el;};
  const place=button('Place town',()=>{if(!session && !busy)picker=selectNote(app,begin);});
  const importanceLabel=doc.createElement('label');importanceLabel.textContent='Importance ';
  const importance=doc.createElement('select');importance.setAttribute('aria-label','Feature importance');
  for(const tier of MAP_IMPORTANCE){const option=doc.createElement('option');option.value=tier.value;option.textContent=tier.label+' · '+tier.detail;importance.append(option);}
  importance.value=DEFAULT_MAP_IMPORTANCE;importanceLabel.append(importance);controls.append(importanceLabel);
  const symbolLabel=doc.createElement('label');symbolLabel.className='map-town-symbol';symbolLabel.textContent='Symbol ';
  const symbol=doc.createElement('select');symbol.setAttribute('aria-label','Feature symbol');
  for(const item of MAP_SYMBOLS){const option=doc.createElement('option');option.value=item.value;option.textContent=item.label;symbol.append(option);}
  symbol.value=DEFAULT_MAP_SYMBOL;
  const symbolPreview=doc.createElement('img');symbolPreview.alt='';symbolPreview.setAttribute('aria-hidden','true');
  symbolLabel.append(symbol,symbolPreview);controls.append(symbolLabel);
  const text=doc.createElement('span');text.className='map-town-status';text.setAttribute('role','status');controls.append(text);
  const center=button('Place at map center',()=>pick(map.getCenter()));
  const save=button('Save town position',()=>void savePosition());
  const cancel=button('Cancel placement',()=>end());
  if(editable)figure.querySelector('figcaption').append(controls);
  const savedLayer=L.layerGroup().addTo(map),draftLayer=L.layerGroup().addTo(map);
  const notes=new Map(),refs=[];let session=null,point=null,busy=false,disposed=false,picker;
  const record=file=>{
    if(file.extension!=='md')return;
    const location=storedMapLocation(app.metadataCache.getFileCache(file)?.frontmatter?.mapLocation);
    if(location)notes.set(file.path,{file,location});else notes.delete(file.path);
  };
  const caption=(file,location)=>`${file.basename??file.name} · X ${location.x.toFixed(3)}, Y ${location.y.toFixed(3)} · ${location.hex} · ${mapImportance(location.importance).label} · ${mapSymbol(location.symbol).label}`;
  const marker=(layer,file,location,draft=false)=>{
    const scale=map.getZoomScale(map.getZoom(),0);
    if(!visible(location) || (!draft && !importanceVisible(location.importance,scale)))return;
    const label=doc.createElement('span');label.textContent=caption(file,location);
    // Keep overview ink small, growing to full size at the readable 9-mile
    // scale. The click target and active placement draft stay easy to use.
    const iconHeight=draft?18:Math.max(6,Math.min(18,18*Math.sqrt(hexLevel(1).hexPixels*scale/18)));
    const artwork=symbols[location.symbol];
    const icon=L.divIcon({className:'map-town-marker'+(draft?' map-town-marker-draft':''),
      html:`<img src="${artwork.image}" alt="" aria-hidden="true" draggable="false" style="--map-town-icon-height:${iconHeight}px" width="${iconHeight*artwork.width/artwork.height}" height="${iconHeight}">`,
      iconSize:[28,28],iconAnchor:[14,14],tooltipAnchor:[0,-12]});
    const dot=L.marker(ll(location),{icon,title:file.basename??file.name??file.path,
      keyboard:!session,bubblingMouseEvents:false,interactive:!session}).addTo(layer);
    dot.bindTooltip(label,{direction:'top'});
    if(!session)dot.on('click',()=>void app.workspace.openLinkText(file.path,sourcePath,false));
  };
  function draw(){
    savedLayer.clearLayers();draftLayer.clearLayers();
    for(const {file,location} of notes.values())if(file!==session?.file)marker(savedLayer,file,location);
    if(session && point)marker(draftLayer,session.file,point,true);
  }
  function state(){
    place.disabled=!!session || busy;center.hidden=save.hidden=cancel.hidden=importanceLabel.hidden=symbolLabel.hidden=!session;
    importance.disabled=symbol.disabled=busy;
    const artwork=symbols[symbol.value];symbolPreview.src=artwork.image;
    symbolPreview.width=18*artwork.width/artwork.height;symbolPreview.height=18;
    center.disabled=cancel.disabled=busy;save.disabled=busy || !point;
    canvas.classList.toggle('map-placing-town',!!session);
    canvas.classList.toggle('map-editing',!!session);
  }
  function end(message=''){
    if(busy)return;session=null;point=null;text.textContent=message;state();draw();
  }
  async function begin(file){
    if(!editable || disposed || busy || session)return;
    busy=true;place.disabled=true;text.textContent='Reading '+file.path+'…';
    try{
      const note=await readMapNote(app,file.path);if(disposed)return;
      session={file,guard:captureMapLocation(note)};point=session.guard.location;
      importance.value=point?.importance??DEFAULT_MAP_IMPORTANCE;
      symbol.value=point?.symbol??DEFAULT_MAP_SYMBOL;
      text.textContent=(point?caption(file,point)+'. '+(visible(point)?'Click to move.':'Current position is outside this visible map; click to move it here.'):
        file.path+' · Click the map to place this town.')+' Save writes only this note’s mapLocation.';
    }catch(error){if(!disposed)text.textContent=error.message;}
    finally{busy=false;if(!disposed){state();draw();}}
  }
  function pick(latlng){
    if(!session || busy || disposed)return;
    if(canvas.classList.contains('map-measuring')){text.textContent='Turn off distance measurement or sketching before placing a town.';return;}
    try{
      const localPoint=latLngToCore([latlng.lat,latlng.lng],height);
      if(!inCrop(localPoint,config.crop))throw new Error('Choose a visible point inside this map.');
      point=mapLocation(localPoint.map((v,i)=>v+offset[i]),importance.value,symbol.value);
      text.textContent=caption(session.file,point)+' · Unsaved';state();draw();
    }catch(error){text.textContent=error.message;}
  }
  async function savePosition(){
    if(!session || !point || busy || disposed)return;
    busy=true;state();text.textContent='Saving '+session.file.path+'…';
    const current=session,chosen=point;
    try{
      const result=await writeMapNote(app,current.file.path,note=>{
        if(disposed)throw new Error('The map closed before the position could be saved.');
        return patchMapLocation(note,current.guard,[chosen.x,chosen.y],{importance:chosen.importance,symbol:chosen.symbol});
      });
      if(disposed)return;
      notes.set(current.file.path,{file:current.file,location:result.location});
      onSaved?.(current.file,result.location);busy=false;
      const tier=mapImportance(result.location.importance),visibility=tier.depth===null?'all zooms':tier.detail+' and closer';
      end('Saved '+current.file.path+' · '+result.location.hex+' · '+mapSymbol(result.location.symbol).label+' · '+tier.label+' · '+visibility);
    }catch(error){if(!disposed)text.textContent=error.message;}
    finally{busy=false;if(!disposed)state();}
  }
  for(const file of app.vault.getMarkdownFiles())record(file);
  const changed=(file)=>{if(disposed)return;record(file);draw();};
  const listen=(owner,name,fn)=>{const ref=owner.on?.(name,fn);if(ref)refs.push([owner,ref]);};
  listen(app.metadataCache,'changed',changed);
  listen(app.vault,'delete',file=>{notes.delete(file.path);draw();});
  listen(app.vault,'rename',(file,oldPath)=>{notes.delete(oldPath);changed(file);});
  const click=event=>pick(event.latlng);
  const appearanceChanged=()=>{
    if(!session || busy || disposed)return;
    if(point){point={...point,importance:importance.value,symbol:symbol.value};text.textContent=caption(session.file,point)+' · Unsaved';draw();}
    state();
  };
  importance.addEventListener('change',appearanceChanged);symbol.addEventListener('change',appearanceChanged);
  if(editable)map.on('click',click);map.on('zoomend',draw);state();draw();
  const dispose=()=>{disposed=true;picker?.close?.();map.off('click',click);map.off('zoomend',draw);for(const [owner,ref] of refs)owner.offref?.(ref);
    canvas.classList.remove('map-placing-town','map-editing');controls.remove();savedLayer.remove();draftLayer.remove();};
  dispose.update=next=>{config=next;draw();};
  dispose.updateNote=(file,location)=>{if(disposed)return;notes.set(file.path,{file,location});draw();};
  return dispose;
}
