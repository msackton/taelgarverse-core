import {cropBounds,latLngToCore} from '../map-core.mjs';
import {detailRectangle,rectanglesIntersect,detailOpacity} from '../map-details.mjs';
import {cropInset} from './map-baseline.mjs';
let sequence=0;

// Separate raster pane below every vector overlay. Images load only near their
// reveal zoom and viewport, and are released when no longer needed.
export function addMapDetails(L,map,canvas,figure,initial){
  const doc=canvas.ownerDocument,paneName='taelgar-detail-'+sequence++,pane=map.createPane(paneName);
  pane.style.zIndex='250';pane.style.pointerEvents='none';
  const controls=doc.createElement('span');controls.className='map-detail-controls';
  const label=doc.createElement('label');label.textContent='Regional artwork ';
  const select=doc.createElement('select');select.setAttribute('aria-label','Zoom to regional artwork');label.append(select);
  const status=doc.createElement('span');status.setAttribute('role','status');controls.append(label,status);
  figure.querySelector('figcaption').append(controls);
  let config,items=[],disposed=false,frame;
  function report(){status.textContent=items.filter(i=>i.failed).map(i=>'Could not load '+i.detail.name+'; showing world artwork.').join(' ');}
  function release(item){item.layer?.off();item.layer?.remove();item.layer=null;item.loaded=false;}
  function redraw(){
    const zoom=map.getZoom(),bounds=map.getBounds(),height=config.bounds[1][0];
    const nw=latLngToCore([bounds.getNorth(),bounds.getWest()],height),se=latLngToCore([bounds.getSouth(),bounds.getEast()],height);
    const view={x:nw[0],y:nw[1],width:se[0]-nw[0],height:se[1]-nw[1]};
    for(const item of items){
      const needed=zoom>=item.detail.fadeZoom[0]-.75 && rectanglesIntersect(view,item.rect) && rectanglesIntersect(config.crop,item.rect);
      if(!needed){release(item);continue;}
      if(!item.layer && !item.failed){
        const layer=L.imageOverlay(item.detail.image,cropBounds(item.rect,height),{
          pane:paneName,interactive:false,opacity:0,zIndex:item.index,className:'map-detail-image',
        });
        item.layer=layer;
        layer.on('load',()=>{if(disposed || item.layer!==layer)return;item.loaded=true;layer.setOpacity(detailOpacity(map.getZoom(),item.detail.fadeZoom));});
        layer.on('error',()=>{if(disposed || item.layer!==layer)return;item.failed=true;release(item);report();});
        layer.addTo(map);
        layer.getElement().style.clipPath=cropInset(config.crop,item.rect);
      }
      if(item.loaded)item.layer.setOpacity(detailOpacity(zoom,item.detail.fadeZoom));
    }
  }
  const schedule=()=>{if(frame!==undefined)return;frame=doc.defaultView.requestAnimationFrame(()=>{frame=undefined;if(!disposed)redraw();});};
  function update(next){
    for(const item of items)release(item);
    config=next;items=(config.detailLayers??[]).map((detail,index)=>({detail,index,rect:detailRectangle(detail,config.sourceOffset)}));
    select.replaceChildren();const prompt=doc.createElement('option');prompt.value='';prompt.textContent='Zoom to region…';select.append(prompt);
    for(const [index,item] of items.entries()){
      if(!rectanglesIntersect(config.crop,item.rect))continue;
      const option=doc.createElement('option');option.value=String(index);option.textContent=item.detail.name;select.append(option);
    }
    controls.hidden=select.children.length<2;report();redraw();
  }
  select.addEventListener('change',()=>{
    if(select.value==='')return;
    const r=items[Number(select.value)].rect,c=config.crop;
    const x=Math.max(r.x,c.x),y=Math.max(r.y,c.y),right=Math.min(r.x+r.width,c.x+c.width),bottom=Math.min(r.y+r.height,c.y+c.height);
    map.fitBounds(cropBounds({x,y,width:right-x,height:bottom-y},config.bounds[1][0]));select.value='';
  });
  map.on('zoom moveend resize',schedule);update(initial);
  const dispose=()=>{disposed=true;if(frame!==undefined)doc.defaultView.cancelAnimationFrame(frame);map.off('zoom moveend resize',schedule);for(const item of items)release(item);controls.remove();pane.remove();};
  dispose.update=update;return dispose;
}
