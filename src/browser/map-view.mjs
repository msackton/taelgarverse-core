import L from 'leaflet';
import {addMeasurement} from './map-measurement.mjs';
import {addMapBaseline,cropInset} from './map-baseline.mjs';
import {cropBounds} from '../map-core.mjs';

const blank = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export function mountMap(figure,{decorate}={}) {
  const canvas = figure.querySelector('.map-canvas'), status = figure.querySelector('.map-status');
  let map,observer,disposeMeasurement,disposeBaseline,disposeDecoration,fit;
  try {
    let config = JSON.parse(figure.dataset.map);
    const bounds = L.latLngBounds(config.bounds);
    const cameraBounds=value=>value.version===2?L.latLngBounds(cropBounds(value.crop,value.bounds[1][0])):bounds;
    let viewBounds=cameraBounds(config);
    canvas.hidden = false;
    map = L.map(canvas,{crs:L.CRS.Simple,attributionControl:false,minZoom:config.minZoom,maxZoom:config.maxZoom,
      zoomSnap:config.version===2?.25:1,zoomDelta:config.version===2?.5:1,
      scrollWheelZoom:false,maxBounds:config.version===2?viewBounds:viewBounds.pad(0.1),maxBoundsViscosity:config.version===2?1:0.8});
    const sizeMap = () => {
      map.invalidateSize({pan:false});
      // Baselines stay focused on the crop; legacy maps continue to
      // allow their authored minimum zoom, widening it for small viewports.
      const step=config.version===2?.25:1;
      const fitZoom = Math.floor(Math.log2(Math.min(canvas.clientWidth / (viewBounds.getEast()-viewBounds.getWest()),
        canvas.clientHeight / (viewBounds.getNorth()-viewBounds.getSouth())))/step)*step;
      if (Number.isFinite(fitZoom)) map.setMinZoom(Math.min(config.maxZoom,Math.max(-10,
        config.version===2?fitZoom:Math.min(config.minZoom,fitZoom))));
    };
    sizeMap();
    const fail = () => {status.textContent = 'Map imagery could not load. ';};
    let imageLayer,tileLayer;
    if (config.tile) {
      const tile = config.tile;
      const Layer = L.TileLayer.extend({createTile(coords,done){
        const element=L.TileLayer.prototype.createTile.call(this,coords,done);
        if(config.version===2){
          const edge=tile.tileSize/2**coords.z;
          element.style.clipPath=cropInset(config.crop,{x:coords.x*edge,y:tile.height+coords.y*edge,width:edge,height:edge});
        }
        return element;
      },getTileUrl(coords) {
        const scale = 2 ** coords.z, rows = Math.ceil(Math.round(tile.height * scale) / tile.tileSize);
        const cols = Math.ceil(Math.round(tile.width * scale) / tile.tileSize), row = coords.y + rows;
        return coords.x < 0 || coords.x >= cols || row < 0 || row >= rows ? blank :
          tile.baseUrl + '/' + coords.z + '/' + coords.x + '/' + row + '.webp';
      }});
      tileLayer=new Layer('',{tileSize:tile.tileSize,minZoom:-10,maxZoom:config.maxZoom,
        minNativeZoom:tile.minNativeZoom,maxNativeZoom:tile.maxNativeZoom,noWrap:true,bounds})
        .on('tileerror',fail).addTo(map);
    } else {
      imageLayer=L.imageOverlay(config.image,bounds).on('error',fail).addTo(map);
    }
    const reset = () => config.fitBounds && canvas.clientWidth && canvas.clientHeight ? map.fitBounds(viewBounds) :
      map.setView(config.center || viewBounds.getCenter(),config.defaultZoom);
    reset();
    if(config.version===2 && imageLayer)imageLayer.getElement().style.clipPath=cropInset(config.crop,{x:0,y:0,width:config.bounds[1][1],height:config.bounds[1][0]});
    fit = canvas.ownerDocument.createElement('button');
    fit.type = 'button';fit.textContent = 'Fit map';fit.addEventListener('click',() => map.fitBounds(viewBounds));
    figure.querySelector('figcaption').prepend(fit);
    if(config.version===2)disposeBaseline=addMapBaseline(L,map,canvas,figure,config);
    disposeMeasurement=addMeasurement(L,map,canvas,figure,config.measurement,viewBounds);
    // Host-only authoring controls stay outside serialized map definitions and
    // website bundles. Their lifetime follows the mounted map.
    disposeDecoration=decorate?.({L,map,canvas,config});
    status.textContent = 'Drag to pan; use +/− or pinch to zoom. ';
    if(config.measurement===null)status.textContent+='Distance measurement unavailable for this map. ';
    // Host controls can change the height of a flex-based editor canvas. Fit
    // after they mount so the initial view includes the complete rectangle.
    sizeMap();reset();
    // Maps inside closed callouts or note previews need their first visible size.
    let visible = canvas.clientWidth > 0 && canvas.clientHeight > 0;
    observer = new ResizeObserver(() => {
      if (!canvas.clientWidth || !canvas.clientHeight) return;
      sizeMap();
      if (!visible) {reset();visible=true;}
    });
    observer.observe(canvas);
    figure.dataset.mapReady = 'true';
    let disposed=false;
    const dispose=()=>{disposed=true;observer.disconnect();disposeDecoration?.();disposeMeasurement?.();disposeBaseline?.();map.remove();fit.remove();delete figure.dataset.mapReady;};
    // Editor changes keep the image and Leaflet map alive. Only committed
    // crop/grid changes need new controls.
    dispose.update=next=>{
      if(disposed)return;
      if(next.version!==2 || config.version!==2 || next.image!==config.image ||
        JSON.stringify(next.bounds)!==JSON.stringify(config.bounds) || JSON.stringify(next.tile)!==JSON.stringify(config.tile))
        throw new Error('An in-place map update must keep the same source.');
      const oldCrop=JSON.stringify(config.crop);
      disposeBaseline?.();disposeMeasurement?.();config=next;viewBounds=cameraBounds(config);
      figure.dataset.map=JSON.stringify(config);map.setMaxBounds(viewBounds);sizeMap();
      if(imageLayer)imageLayer.getElement().style.clipPath=cropInset(config.crop,{x:0,y:0,width:config.bounds[1][1],height:config.bounds[1][0]});
      tileLayer?.redraw();
      disposeBaseline=addMapBaseline(L,map,canvas,figure,config);
      disposeMeasurement=addMeasurement(L,map,canvas,figure,config.measurement,viewBounds);
      disposeDecoration?.update?.(config);
      if(oldCrop!==JSON.stringify(config.crop))map.fitBounds(viewBounds);
    };
    return dispose;
  } catch (error) {
    observer?.disconnect();disposeDecoration?.();disposeMeasurement?.();disposeBaseline?.();map?.remove();fit?.remove();canvas.hidden = true;
    status.textContent = 'Interactive map could not load. ';
    console.error('Unable to initialize map',error);
    return ()=>{};
  }
}
