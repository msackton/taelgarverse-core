import {routeArea} from './map-distance.mjs';

const record=v=>v && typeof v==='object' && !Array.isArray(v);
const require=(ok,message)=>{if(!ok)throw new Error('Map layers: '+message);};
const id=v=>typeof v==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(v);
const name=v=>typeof v==='string' && v.trim().length>0 && v.length<=200;
export const mapLayerPath=v=>typeof v==='string' && v.length<=1024 && !/^[\/]|[:?#\x00-\x1f\x7f\\]/.test(v) && !v.split('/').includes('..') && v.endsWith('.map-layers.json');

// Deliberately simple polygons: no inferred topology, holes or automatic repair.
// Saved coordinates always refer to the original Photoshop canvas.
export function validateMapLayers(value){
  require(record(value) && value.version===1 && Array.isArray(value.layers),'expected version 1 and a layers array');
  require(value.layers.length<=100,'at most 100 layers per file');
  const ids=new Set();let count=0;
  for(const layer of value.layers){
    require(record(layer) && id(layer.id) && !ids.has(layer.id),'layer IDs must be valid and unique');ids.add(layer.id);
    require(name(layer.name),'each layer needs a name');
    require(layer.visible===undefined || typeof layer.visible==='boolean','visible must be boolean');
    require(Array.isArray(layer.regions) && layer.regions.length<=1000,'expected at most 1000 regions per layer');
    const regionIds=new Set();
    for(const region of layer.regions){
      require(record(region) && id(region.id) && !regionIds.has(region.id),'region IDs must be valid and unique within a layer');regionIds.add(region.id);
      require(name(region.name),'each region needs a name');
      require(region.note===undefined || (typeof region.note==='string' && region.note.length>0 && region.note.length<=1024 && !/^[\/]|[:?#\x00-\x1f\x7f\\]/.test(region.note) && !region.note.split('/').includes('..')),'note must be a local vault path');
      const points=region.points;
      require(Array.isArray(points) && points.length>=3 && points.length<=1000,'a region needs 3–1000 vertices');
      count+=points.length;require(count<=20000,'at most 20000 vertices per file');
      require(points.every(p=>Array.isArray(p) && p.length===2 && p.every(v=>Number.isFinite(v) && v>=0 && v<=100000)),'invalid Photoshop coordinates');
      require(new Set(points.map(p=>p.join(','))).size===points.length,'vertices must be distinct; do not repeat the first vertex');
      const route=[...points,points[0]].map(([lng,lat])=>({lat,lng}));
      require(routeArea(route)>0,'region outlines must enclose an area without crossing, touching or retracing');
      require(region.color===undefined || /^#[0-9a-f]{6}$/i.test(region.color),'color must be #RRGGBB');
      require(region.width===undefined || (Number.isFinite(region.width) && region.width>=1 && region.width<=8),'width must be 1–8');
      require(region.fillOpacity===undefined || (Number.isFinite(region.fillOpacity) && region.fillOpacity>=0 && region.fillOpacity<=0.5),'fillOpacity must be 0–0.5');
      require(region.dashed===undefined || typeof region.dashed==='boolean','dashed must be boolean');
    }
  }
  return value;
}

export function resolvedMapLayers(documents){
  return documents.flatMap(({path,data})=>validateMapLayers(data).layers.map(layer=>({...layer,key:path+'#'+layer.id})));
}
