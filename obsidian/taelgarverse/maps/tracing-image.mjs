import {cropBounds} from '../../../src/map-core.mjs';
import {cropInset} from '../../../src/browser/map-baseline.mjs';

export function tracingRectangle(image,{x,y,scale},manifest){
  const width=image.width*scale,height=image.height*scale;
  if(![x,y,scale].every(Number.isFinite) || x<0 || y<0 || scale<=0 ||
    !Number.isFinite(width) || !Number.isFinite(height) || x+width>100000 || y+height>100000)
    throw new Error('Use nonnegative Photoshop X/Y and a positive scale within the 100000-pixel canvas.');
  return {x:x-manifest.sourceOffset[0],y:y-manifest.sourceOffset[1],width,height};
}

// Keep the reference outside the vault and published map definitions. Verify
// dimensions before asking the browser to decode potentially large artwork.
export async function loadTracingImage(file,doc){
  if(file.size>256*1024*1024)throw new Error('Tracing PNG must be at most 256 MiB.');
  const bytes=await file.slice(0,33).arrayBuffer(),header=new DataView(bytes);
  if(bytes.byteLength<33 || header.getUint32(0)!==0x89504e47 || header.getUint32(4)!==0x0d0a1a0a ||
    header.getUint32(8)!==13 || header.getUint32(12)!==0x49484452)throw new Error('Choose a valid PNG image.');
  const width=header.getUint32(16),height=header.getUint32(20);
  if(!width || !height || width>50000 || height>50000 || width*height>250_000_000)
    throw new Error('Tracing PNG exceeds the supported image dimensions (50000 per side, 250 million pixels).');
  const host=doc.defaultView,url=host.URL.createObjectURL(file);
  try{
    const image=new host.Image();image.src=url;await image.decode();
    if(image.naturalWidth!==width || image.naturalHeight!==height)throw new Error('PNG dimensions changed during decoding.');
    let released=false;
    return {url,width,height,name:file.name,release(){if(!released){released=true;host.URL.revokeObjectURL(url);}}};
  }catch(error){host.URL.revokeObjectURL(url);throw new Error('Tracing PNG could not be decoded: '+error.message);}
}

let paneSequence=0;
export function mountTracingImage({L,map,canvas,figure,manifest,loadImage=loadTracingImage}){
  const doc=canvas.ownerDocument,controls=doc.createElement('fieldset');controls.className='map-tracing-controls';
  const legend=doc.createElement('legend');legend.textContent='Tracing image';controls.append(legend);
  const field=(name,type)=>{const label=doc.createElement('label');label.textContent=name+' ';const input=doc.createElement('input');
    input.type=type;input.setAttribute('aria-label',name);label.append(input);controls.append(label);return input;};
  const file=field('Load tracing PNG','file');file.accept='.png,image/png';
  const visible=field('Show tracing image','checkbox');visible.checked=true;
  const opacity=field('Tracing opacity','range');opacity.min='0';opacity.max='1';opacity.step='0.05';opacity.value='0.65';
  const opacityValue=doc.createElement('span');opacityValue.textContent='65%';opacity.parentElement.append(opacityValue);
  const x=field('Tracing X','number'),y=field('Tracing Y','number'),scale=field('Tracing scale','number');
  for(const input of [x,y]){input.min='0';input.max='100000';input.step='any';}scale.min='0.000001';scale.step='any';scale.value='1';
  const button=(label,fn)=>{const el=doc.createElement('button');el.type='button';el.textContent=label;el.addEventListener('click',fn);controls.append(el);return el;};
  const align=button('Align to basemap export',()=>{x.value=String(manifest.sourceOffset[0]);y.value=String(manifest.sourceOffset[1]);scale.value='1';position();});
  const origin=button('Align to canvas origin',()=>{x.value='0';y.value='0';scale.value='1';position();});
  const remove=button('Remove tracing image',()=>clear());
  const status=doc.createElement('span');status.className='map-tracing-status';status.setAttribute('role','status');controls.append(status);
  const help=doc.createElement('small');help.textContent='Temporary reference only. X/Y locate the PNG’s top-left on the Photoshop canvas; scale is canvas pixels per PNG pixel. Draw region borders over it, then save the regions.';controls.append(help);
  figure.querySelector('figcaption').append(controls);
  // The editor's basemap uses tilePane (200); reference (350) stays below
  // borders/drafts/grid in overlayPane (400) and never intercepts pointer input.
  const paneName='taelgar-tracing-'+paneSequence++,pane=map.createPane(paneName);
  pane.style.zIndex='350';pane.style.pointerEvents='none';
  let current=null,overlay=null,sequence=0,disposed=false,loading=false;
  function state(){
    for(const input of [visible,opacity,x,y,scale])input.parentElement.hidden=!current;
    align.hidden=origin.hidden=!current;remove.hidden=!current && !loading;
  }
  function position(){
    if(!current || disposed)return;
    try{
      if([x,y,scale].some(input=>input.value.trim()===''))throw new Error('Enter X, Y and scale.');
      const rect=tracingRectangle(current,{x:Number(x.value),y:Number(y.value),scale:Number(scale.value)},manifest);
      const bounds=cropBounds(rect,manifest.height);
      overlay.setBounds(bounds);
      const image=overlay.getElement();
      image.style.clipPath=cropInset({x:0,y:0,width:manifest.width,height:manifest.height},rect);
      image.style.pointerEvents='none';
      const intersects=rect.x<manifest.width && rect.y<manifest.height && rect.x+rect.width>0 && rect.y+rect.height>0;
      status.textContent=current.name+' · '+current.width+' × '+current.height+' pixels'+(intersects?'':' · Outside this export; adjust X/Y.');
    }catch(error){status.textContent=error.message+' The last valid alignment is retained.';}
  }
  function appearance(){
    opacityValue.textContent=Math.round(Number(opacity.value)*100)+'%';
    if(overlay){overlay.setOpacity(Number(opacity.value));overlay.getElement().style.display=visible.checked?'':'none';}
  }
  function clear(){
    sequence++;loading=false;overlay?.remove();overlay=null;current?.release();current=null;file.value='';
    status.textContent='';state();
  }
  async function choose(){
    const selected=file.files?.[0];if(!selected || disposed)return;
    const request=++sequence;loading=true;status.textContent='Loading '+selected.name+'…';state();
    try{
      const image=await loadImage(selected,doc);
      if(disposed || request!==sequence){image.release();return;}
      overlay?.remove();current?.release();current=image;
      const sameExtent=image.width===manifest.width && image.height===manifest.height;
      x.value=String(sameExtent?manifest.sourceOffset[0]:0);y.value=String(sameExtent?manifest.sourceOffset[1]:0);scale.value='1';visible.checked=true;
      overlay=L.imageOverlay(image.url,[[0,0],[1,1]],{pane:paneName,interactive:false,opacity:Number(opacity.value),className:'map-tracing-image'}).addTo(map);
      position();appearance();
      status.textContent+=sameExtent?' · Aligned to basemap export.':' · Assumed full canvas at X 0, Y 0; set X/Y for a trimmed export.';
    }catch(error){if(!disposed && request===sequence)status.textContent=error.message;}
    finally{if(!disposed && request===sequence){loading=false;file.value='';state();}}
  }
  file.addEventListener('change',choose);for(const input of [x,y,scale])input.addEventListener('change',position);
  visible.addEventListener('change',appearance);opacity.addEventListener('input',appearance);state();
  return ()=>{disposed=true;clear();pane.remove();controls.remove();};
}
