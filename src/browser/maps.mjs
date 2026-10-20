import L from 'leaflet';
import {addMeasurement} from './map-measurement.mjs';

const blank = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

for (const figure of document.querySelectorAll('.leaflet-map[data-map]')) {
  const canvas = figure.querySelector('.map-canvas'), status = figure.querySelector('.map-status');
  let map;
  try {
    const config = JSON.parse(figure.dataset.map), bounds = L.latLngBounds(config.bounds);
    canvas.hidden = false;
    map = L.map(canvas,{crs:L.CRS.Simple,minZoom:config.minZoom,maxZoom:config.maxZoom,
      scrollWheelZoom:false,maxBounds:bounds.pad(0.1),maxBoundsViscosity:0.8});
    const sizeMap = () => {
      map.invalidateSize({pan:false});
      // Authored minimum zooms assume a desktop-sized map. Permit enough
      // zooming out to fit the complete image in the current viewport.
      const fitZoom = Math.floor(Math.log2(Math.min(canvas.clientWidth / (bounds.getEast()-bounds.getWest()),
        canvas.clientHeight / (bounds.getNorth()-bounds.getSouth()))));
      if (Number.isFinite(fitZoom)) map.setMinZoom(Math.max(-10,Math.min(config.minZoom,fitZoom)));
    };
    sizeMap();
    const fail = () => {status.textContent = 'Map imagery could not load. ';};
    if (config.tile) {
      const tile = config.tile;
      const Layer = L.TileLayer.extend({getTileUrl(coords) {
        const scale = 2 ** coords.z, rows = Math.ceil(Math.round(tile.height * scale) / tile.tileSize);
        const cols = Math.ceil(Math.round(tile.width * scale) / tile.tileSize), row = coords.y + rows;
        return coords.x < 0 || coords.x >= cols || row < 0 || row >= rows ? blank :
          tile.baseUrl + '/' + coords.z + '/' + coords.x + '/' + row + '.webp';
      }});
      new Layer('',{tileSize:tile.tileSize,minZoom:-10,maxZoom:config.maxZoom,
        minNativeZoom:tile.minNativeZoom,maxNativeZoom:tile.maxNativeZoom,noWrap:true,bounds})
        .on('tileerror',fail).addTo(map);
    } else L.imageOverlay(config.image,bounds).on('error',fail).addTo(map);
    const reset = () => config.fitBounds ? map.fitBounds(bounds) : map.setView(config.center,config.defaultZoom);
    reset();
    const fit = document.createElement('button');
    fit.type = 'button';fit.textContent = 'Fit map';fit.addEventListener('click',() => map.fitBounds(bounds));
    figure.querySelector('figcaption').prepend(fit);
    addMeasurement(L,map,canvas,figure,config.measurement,bounds);
    status.textContent = 'Drag to pan; use +/− or pinch to zoom. ';
    if(config.measurement===null)status.textContent+='Distance measurement unavailable for this map. ';
    // Maps inside closed callouts or note previews need their first visible size.
    let visible = canvas.clientWidth > 0 && canvas.clientHeight > 0;
    const observer = new ResizeObserver(() => {
      if (!canvas.clientWidth || !canvas.clientHeight) return;
      sizeMap();
      if (!visible) {reset();visible=true;}
    });
    observer.observe(canvas);
    figure.dataset.mapReady = 'true';
  } catch (error) {
    map?.remove();canvas.hidden = true;
    status.textContent = 'Interactive map could not load. ';
    console.error('Unable to initialize map',error);
  }
}
