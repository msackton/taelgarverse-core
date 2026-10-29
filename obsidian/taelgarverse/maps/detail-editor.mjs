import path from 'node:path';
import {cropBounds,latLngToCore,sourceExtent} from '../../../src/map-core.mjs';
import {regionalTemplate,rectanglesIntersect} from '../../../src/map-details.mjs';
import {loadObsidianDetail} from './manifest.mjs';
import {saveMapSession} from './persistence.mjs';

export async function renderRegionalGuide(app,manifestPath,manifest,template,doc){
  const file=app.vault.getAbstractFileByPath(path.posix.join(path.posix.dirname(manifestPath),manifest.image));
  if(!file)throw new Error('World image is missing');
  const bytes=await app.vault.readBinary(file),host=doc.defaultView;
  const url=host.URL.createObjectURL(new host.Blob([bytes],{type:'image/png'}));
  let canvas;
  try{
    const image=new host.Image();image.src=url;await image.decode();
    canvas=doc.createElement('canvas');[canvas.width,canvas.height]=template.pixelSize;
    const r=template.worldBounds,ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Canvas export is unavailable');
    ctx.drawImage(image,r.x-manifest.sourceOffset[0],r.y-manifest.sourceOffset[1],r.width,r.height,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG export failed')),'image/png'));
  }finally{host.URL.revokeObjectURL(url);if(canvas){canvas.width=canvas.height=0;}}
}

export function mountDetailEditor({L,map,canvas,figure,manifest,manifestPath,app,block,session,onSaved,onPreview,exportGuide=renderRegionalGuide}){
  const doc=canvas.ownerDocument,host=doc.defaultView,controls=doc.createElement('fieldset');controls.className='map-detail-editor';
  const legend=doc.createElement('legend');legend.textContent='Regional artwork';controls.append(legend);
  const field=(name,type,value)=>{const label=doc.createElement('label');label.textContent=name+' ';const input=doc.createElement('input');input.type=type;input.value=String(value??'');input.setAttribute('aria-label',name);label.append(input);controls.append(label);return input;};
  const name=field('Artwork name','text','New region'),filename=field('Artwork filename','text','new-region.png');
  const extent=sourceExtent(manifest);
  const fields=Object.fromEntries(['x','y','width','height'].map(k=>[k,field('Region '+k,'number',k==='x'?extent.x:k==='y'?extent.y:Math.min(100,extent[k]))]));
  const scale=field('Artwork pixels per world pixel','number',8);scale.min='1';scale.max='32';scale.step='1';
  const start=field('Start reveal at zoom','number',0),end=field('Fully visible at zoom','number',2);start.step=end.step='.25';
  const button=(text,fn)=>{const b=doc.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',fn);controls.append(b);return b;};
  let selecting=false,first=null,outline=null,disposed=false,busy=false,currentBlock=block,currentSession=session;
  const downloads=new Map();
  const status=doc.createElement('span');status.setAttribute('role','status');
  const selected=()=>Object.fromEntries(Object.entries(fields).map(([k,input])=>{if(!input.value.trim())throw new Error('Enter all footprint coordinates');return [k,Number(input.value)];}));
  function template(){
    if([scale,start,end].some(input=>!input.value.trim()))throw new Error('Enter resolution and both reveal zoom levels');
    const result=regionalTemplate({name:name.value.trim(),image:filename.value.trim(),worldBounds:selected(),scale:Number(scale.value),fadeZoom:[Number(start.value),Number(end.value)]});
    const r=result.worldBounds;
    if(r.x<extent.x || r.y<extent.y || r.x+r.width>extent.x+extent.width || r.y+r.height>extent.y+extent.height)
      throw new Error('Select a rectangle entirely inside this world export');
    if(result.image.includes('/'))throw new Error('Use a PNG filename without folders for the template');
    return result;
  }
  function draw(){
    outline?.remove();outline=null;
    try{const r=template().worldBounds;outline=L.rectangle(cropBounds({...r,x:r.x-extent.x,y:r.y-extent.y},manifest.height),{color:'#126c9a',weight:2,dashArray:'6 4',fill:false,interactive:false}).addTo(map);}catch{/* Invalid fields report on export. */}
  }
  function stop(){
    selecting=false;first=null;canvas.classList.remove('map-editing-detail');
    if(!['map-placing-town','map-editing-path','map-editing-region'].some(c=>canvas.classList.contains(c)))canvas.classList.remove('map-editing');
    select.textContent='Select two corners';
  }
  const select=button('Select two corners',()=>{
    if(busy)return;if(selecting){stop();return;}
    if(canvas.classList.contains('map-editing') || canvas.classList.contains('map-measuring')){status.textContent='Finish the current map tool first.';return;}
    selecting=true;first=null;canvas.classList.add('map-editing','map-editing-detail');select.textContent='Cancel corner selection';status.textContent='Click two opposite corners of the region.';
  });
  function click(event){
    if(!selecting)return;
    const local=latLngToCore([event.latlng.lat,event.latlng.lng],manifest.height);
    const point=[Math.max(extent.x,Math.min(extent.x+extent.width,Math.round(local[0]+extent.x))),Math.max(extent.y,Math.min(extent.y+extent.height,Math.round(local[1]+extent.y)))];
    if(!first){first=point;status.textContent='Click the opposite corner.';return;}
    const rect={x:Math.min(first[0],point[0]),y:Math.min(first[1],point[1]),width:Math.abs(first[0]-point[0]),height:Math.abs(first[1]-point[1])};
    if(!rect.width || !rect.height){status.textContent='Choose a corner with positive width and height.';return;}
    for(const [k,value] of Object.entries(rect))fields[k].value=String(value);
    stop();draw();status.textContent='Footprint selected. Choose a resolution and export both files.';
  }
  const keys=event=>{if(selecting && event.key==='Escape'){stop();status.textContent='Selection cancelled.';}};
  const download=(blob,name)=>{
    const url=host.URL.createObjectURL(blob),link=doc.createElement('a');link.href=url;link.download=name;doc.body.append(link);link.click();link.remove();
    const timer=host.setTimeout(()=>{host.URL.revokeObjectURL(url);downloads.delete(url);},1000);downloads.set(url,timer);
  };
  const guide=button('Export tracing guide PNG',async()=>{
    if(busy || disposed)return;
    try{const value=template();busy=true;guide.disabled=true;status.textContent='Preparing tracing guide…';
      const blob=await exportGuide(app,manifestPath,manifest,value,doc);if(disposed)return;
      download(blob,value.image.replace(/\.png$/i,'-guide.png'));status.textContent='Guide exported. Open it in Photoshop, add your artwork above it, then export the full canvas under the artwork filename.';
    }catch(error){if(!disposed)status.textContent=error.message;}finally{busy=false;if(!disposed)guide.disabled=false;}
  });
  button('Export regional manifest',()=>{if(busy || disposed)return;try{const value=template();download(new host.Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),value.image.replace(/\.png$/i,'.map-detail.json'));status.textContent='Manifest exported. Keep it beside the finished PNG in the vault.';}catch(error){status.textContent=error.message;}});
  const source=field('Regional manifest path','text','');source.placeholder='assets/maps/new-region.map-detail.json';
  const attached=doc.createElement('select');attached.setAttribute('aria-label','Attached regional artwork');controls.append(attached);
  function refresh(){attached.replaceChildren();for(const value of currentBlock.details??[]){const option=doc.createElement('option');option.value=value;option.textContent=value;attached.append(option);}remove.disabled=!currentSession || !attached.children.length;add.disabled=!currentSession;}
  async function save(removePath){
    if(busy || disposed || !currentSession)return;
    try{
      const target=removePath??source.value.trim();let details=currentBlock.details??[];
      if(removePath)details=details.filter(p=>p!==target);
      else{if(details.includes(target))throw new Error('This artwork is already attached');details=[...details,target];}
      busy=true;add.disabled=remove.disabled=true;
      const layers=[];for(const value of details)layers.push(await loadObsidianDetail(app,value));
      for(const layer of layers)if(!rectanglesIntersect(extent,layer.worldBounds))throw new Error('Regional artwork does not intersect this world export: '+layer.name);
      if(disposed)return;
      const previous=currentSession.guard,result=await saveMapSession(app,currentSession,{...currentBlock,details},manifest);
      currentSession=result.session;currentBlock=result.block;
      onSaved?.(result,previous);if(disposed)return;
      onPreview?.(layers);status.textContent=removePath?'Artwork removed from this map; files retained.':'Artwork added to this map. Zoom in to see the detail.';
    }catch(error){if(!disposed)status.textContent=error.message;}finally{busy=false;if(!disposed)refresh();}
  }
  const add=button('Add artwork to this map',()=>save()),remove=button('Remove artwork from this map',()=>save(attached.value));
  const help=doc.createElement('small');help.textContent='Export the guide and manifest with the same settings. Keep the canvas size and geographic anchors fixed. Save finished artwork as the named PNG beside its manifest, then attach its vault path here. Later entries draw above earlier entries. No files are deleted by removing an attachment.';
  if(!session)help.textContent+=' Reopen from a note map block to attach artwork.';
  controls.append(help,status);figure.querySelector('figcaption').append(controls);
  for(const input of Object.values(fields))input.addEventListener('change',draw);
  map.on('click',click);doc.addEventListener('keydown',keys);refresh();
  return ()=>{disposed=true;stop();map.off('click',click);doc.removeEventListener('keydown',keys);outline?.remove();controls.remove();for(const [url,timer] of downloads){host.clearTimeout(timer);host.URL.revokeObjectURL(url);}downloads.clear();};
}
