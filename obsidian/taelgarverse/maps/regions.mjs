import path from 'node:path';
import {coreToLatLng,latLngToCore,inCrop,validateManifest} from '../../../src/map-core.mjs';
import {validateMapLayers,resolvedMapLayers} from '../../../src/map-layers.mjs';
import {saveMapLayerDocument} from './region-persistence.mjs';

// Regions are deliberately authored separately from transient sketches. Changes
// live in a draft until an explicit Save; existing polygons support vertex edits.
export function mountRegionEditor({L,map,canvas,figure,manifest,manifestPath,layerDocuments=[],app,onSaved}){
  const doc=canvas.ownerDocument,controls=doc.createElement('fieldset');controls.className='map-region-editor';
  const legend=doc.createElement('legend');legend.textContent='Region borders';controls.append(legend);
  const field=(name,type='text')=>{const label=doc.createElement('label');label.textContent=name+' ';const input=doc.createElement(type==='select'?'select':'input');
    if(type!=='select')input.type=type;input.setAttribute('aria-label',name);label.append(input);controls.append(label);return input;};
  const target=field('Layer','select'),existing=field('Region','select');
  const button=(label,fn)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);controls.append(b);return b;};
  const create=button('Draw region',()=>begin(false)),edit=button('Edit region',()=>begin(true));
  const reload=button('Reload region layers',()=>void reloadLayers());
  const layerName=field('Layer name'),regionName=field('Region name'),note=field('Region note (optional)'),color=field('Border color','color'),width=field('Border width','number'),fill=field('Fill opacity','number'),dashed=field('Dashed border','checkbox');
  width.min='1';width.max='8';fill.min='0';fill.max='0.5';fill.step='0.05';
  const vertex=field('Vertex','select');
  const center=button('Add vertex at map center',()=>pick(map.getCenter()));
  const remove=button('Remove vertex',()=>{if(draft && vertex.value!=='append'){draft.points.splice(Number(vertex.value),1);redraw();}});
  const undo=button('Undo vertex',()=>{if(draft){draft.points.pop();redraw();}});
  const save=button('Save region',()=>void commit(false));
  const del=button('Delete region',()=>{if(draft && draft.original){deleting=true;status.textContent='Delete '+draft.original.name+'? Choose Confirm deletion or Cancel region.';state();}});
  const confirm=button('Confirm deletion',()=>void commit(true));
  const cancel=button('Cancel region',()=>end());
  const status=doc.createElement('span');status.setAttribute('role','status');status.className='map-region-status';controls.append(status);
  figure.querySelector('figcaption').append(controls);
  const drawing=L.layerGroup().addTo(map);let documents=layerDocuments,draft=null,busy=false,disposed=false,deleting=false;
  const option=(select,value,label)=>{const el=doc.createElement('option');el.value=value;el.textContent=label;select.append(el);};
  const choices=()=>documents.flatMap((document,di)=>document.data.layers.map((layer,li)=>({document,layer,di,li})));
  const choice=()=>choices()[Number(target.value)];
  const ll=p=>coreToLatLng(p.map((v,i)=>v-manifest.sourceOffset[i]),manifest.height);
  async function reloadLayers(){
    if(draft || busy || disposed)return;busy=true;state();
    try{
      const file=app.vault.getAbstractFileByPath(manifestPath);if(!file)throw new Error('Map manifest is missing.');
      const metadata=validateManifest(JSON.parse(await app.vault.read(file)));
      if(metadata.image!==manifest.image || JSON.stringify(metadata.sourceOffset)!==JSON.stringify(manifest.sourceOffset))throw new Error('Map image changed; close this editor tab and reopen it.');
      const next=[];
      for(const relative of metadata.layers??[]){
        const layerPath=path.posix.join(path.posix.dirname(manifestPath),relative),file=app.vault.getAbstractFileByPath(layerPath);
        if(!file)throw new Error('Layer file missing: '+layerPath);
        const text=await app.vault.read(file);next.push({path:layerPath,text,data:validateMapLayers(JSON.parse(text))});
      }
      if(disposed)return;documents=next;manifest.layers=metadata.layers;onSaved?.(resolvedMapLayers(documents));refresh();status.textContent='Region layers reloaded.';
    }catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;if(!disposed)state();}
  }
  function refresh(){
    const selected=target.value;target.replaceChildren();
    choices().forEach((item,i)=>option(target,String(i),item.layer.name+' · '+item.document.path));option(target,'new','New layer');
    target.value=[...target.options].some(o=>o.value===selected)?selected:(choices().length?'0':'new');refreshRegions();
  }
  function refreshRegions(){existing.replaceChildren();for(const r of choice()?.layer.regions??[])option(existing,r.id,r.name);state();}
  function state(){
    reload.disabled=target.disabled=existing.disabled=create.disabled=!!draft || busy;edit.disabled=!!draft || busy || !existing.value;
    for(const input of [layerName,regionName,note,color,width,fill,dashed,vertex]){input.parentElement.hidden=!draft;input.disabled=busy || deleting;}
    for(const b of [center,remove,undo,save,del,cancel]){b.hidden=!draft;b.disabled=busy || (deleting && b!==cancel);}
    del.hidden=!draft?.original;confirm.hidden=!deleting;confirm.disabled=busy;
    canvas.classList.toggle('map-editing-region',!!draft);canvas.classList.toggle('map-editing',!!draft || canvas.classList.contains('map-placing-town') || canvas.classList.contains('map-editing-path'));
  }
  function begin(editing){
    if(draft || busy || disposed)return;
    if(canvas.classList.contains('map-editing') || canvas.classList.contains('map-measuring')){status.textContent='Finish the current map tool first.';return;}
    const item=choice(),original=editing?item?.layer.regions.find(r=>r.id===existing.value):null;
    if(editing && !original)return;
    draft={item,original,points:structuredClone(original?.points??[])};
    layerName.value=item?.layer.name??'Regions';regionName.value=original?.name??'';note.value=original?.note??'';color.value=original?.color??'#795548';
    width.value=String(original?.width??2);fill.value=String(original?.fillOpacity??0);dashed.checked=original?.dashed??false;
    status.textContent='Click to add vertices. Select a vertex to move it with a click, or choose Add vertex. Save closes and validates the outline.';state();redraw();
  }
  function redraw(){
    drawing.clearLayers();vertex.replaceChildren();option(vertex,'append','Add vertex');
    if(!draft)return;
    draft.points.forEach((p,i)=>option(vertex,String(i),'Vertex '+(i+1)+' · '+p.map(v=>v.toFixed(1)).join(', ')));
    vertex.value='append';
    if(draft.points.length>1)L.polyline([...draft.points,...(draft.points.length>=3?[draft.points[0]]:[])].map(ll),{color:'#126c9a',weight:3,dashArray:'5 4',interactive:false}).addTo(drawing);
    for(const p of draft.points)L.circleMarker(ll(p),{radius:4,color:'#126c9a',fillOpacity:1,interactive:false}).addTo(drawing);
    status.textContent=draft.points.length+' vertices · Unsaved. Select a vertex to move it; Save closes the outline.';
  }
  function pick(latlng){
    if(!draft || busy || disposed || deleting)return;
    const point=latLngToCore([latlng.lat,latlng.lng],manifest.height);
    if(!inCrop(point,{x:0,y:0,width:manifest.width,height:manifest.height})){status.textContent='Choose a point inside this export.';return;}
    const saved=point.map((v,i)=>v+manifest.sourceOffset[i]);
    if(vertex.value==='append')draft.points.push(saved);else draft.points[Number(vertex.value)]=saved;
    redraw();
  }
  function end(message=''){if(busy)return;draft=null;deleting=false;drawing.clearLayers();status.textContent=message;state();}
  async function commit(removeRegion){
    if(!draft || busy || disposed)return;
    try{
      const document=draft.item?.document??documents[0];
      const data=document?structuredClone(document.data):{version:1,layers:[]};
      let layer=draft.item?data.layers[draft.item.li]:null;
      if(!layer){layer={id:'layer-'+crypto.randomUUID(),name:layerName.value.trim(),regions:[]};data.layers.push(layer);}
      layer.name=layerName.value.trim();
      if(removeRegion)layer.regions=layer.regions.filter(r=>r.id!==draft.original.id);
      else{
        const region={...(draft.original??{}),id:draft.original?.id??'region-'+crypto.randomUUID(),name:regionName.value.trim(),points:draft.points,
          color:color.value,width:Number(width.value),fillOpacity:Number(fill.value),dashed:dashed.checked};
        if(note.value.trim())region.note=note.value.trim();else delete region.note;
        const index=layer.regions.findIndex(r=>r.id===region.id);if(index<0)layer.regions.push(region);else layer.regions[index]=region;
      }
      validateMapLayers(data);busy=true;state();
      const saved=await saveMapLayerDocument(app,{manifestPath,manifest,document,data,isOpen:()=>!disposed});
      documents=document?documents.map(d=>d===document?saved:d):[...documents,saved];
      if(disposed)return;
      onSaved?.(resolvedMapLayers(documents));busy=false;end('Saved '+saved.path);refresh();target.value=String(choices().findIndex(item=>item.document.path===saved.path && item.layer.id===layer.id));refreshRegions();
    }catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;if(!disposed)state();}
  }
  target.addEventListener('change',refreshRegions);const click=e=>pick(e.latlng);map.on('click',click);refresh();
  return ()=>{disposed=true;map.off('click',click);drawing.remove();controls.remove();if(draft)canvas.classList.remove('map-editing','map-editing-region');};
}
