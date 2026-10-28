// Shared, host-independent coordinates and validation for manifest-based maps.
// Saved geometry uses Photoshop canvas pixels. Only view configs use PNG-local pixels.
import {LOCATOR_SCHEME,hexRangeBounds} from './map-locators.mjs';
import geometry from './map-geometry.json' with {type:'json'};
import {axialPoint} from './map-hex-hierarchy.mjs';

export const MAP_SCALE=Object.freeze({hexPixels:geometry.hexPixels,hexMiles:geometry.hexMiles,milesPerPixel:geometry.hexMiles/geometry.hexPixels});
export const MAP_GRID=Object.freeze({orientation:'flat',origin:geometry.origin,axialOrigin:geometry.axialOrigin,blockOrigin:geometry.blockOrigin,
  addressing:{status:'verified',scheme:LOCATOR_SCHEME}});
const side=MAP_SCALE.hexPixels/Math.sqrt(3),columnStep=1.5*side;
const finite=Number.isFinite;
const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const pair=value=>Array.isArray(value) && value.length===2 && value.every(finite);
const id=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
function require(value,message){if(!value)throw new Error(message);}
const localPath=value=>typeof value==='string' && value.length<=1024 && value.length>0 &&
  !/^[\\/]|[:?#\x00-\x1f\x7f\\]/.test(value) && !value.split('/').includes('..');

export const coreToLatLng=([x,y],height)=>[height-y,x];
export const latLngToCore=([lat,lng],height)=>[lng,height-lat];
export const cropBounds=({x,y,width,height},imageHeight)=>[[imageHeight-y-height,x],[imageHeight-y,x+width]];
export const fullCrop=({width,height})=>({x:0,y:0,width,height});
export const sourceExtent=({sourceOffset:[x,y],width,height})=>({x,y,width,height});
export const inCrop=([x,y],crop)=>x>=crop.x && y>=crop.y && x<=crop.x+crop.width && y<=crop.y+crop.height;

export function hexCenter(grid,[q,r],pixels=MAP_SCALE.hexPixels) {
  q-=grid.axialOrigin[0];r-=grid.axialOrigin[1];
  return axialPoint([q,r],pixels,grid.rotation).map((v,i)=>v+grid.origin[i]);
}

export function hexVertices(grid,axial,pixels=MAP_SCALE.hexPixels) {
  const [x,y]=hexCenter(grid,axial,pixels),radius=side*pixels/MAP_SCALE.hexPixels;
  return Array.from({length:6},(_,i)=>[x+radius*Math.cos(i*Math.PI/3+(grid.rotation??0)),y+radius*Math.sin(i*Math.PI/3+(grid.rotation??0))]);
}

export function pointToHex(grid,[x,y],pixels=MAP_SCALE.hexPixels) {
  const dx=x-grid.origin[0],dy=y-grid.origin[1],c=Math.cos(grid.rotation??0),sin=Math.sin(grid.rotation??0);
  const q=(dx*c+dy*sin)/(columnStep*pixels/MAP_SCALE.hexPixels),r=(-dx*sin+dy*c)/pixels-q/2,s=-q-r;
  let iq=Math.round(q),ir=Math.round(r);const is=Math.round(s);
  const dq=Math.abs(iq-q),dr=Math.abs(ir-r),ds=Math.abs(is-s);
  if(dq>dr && dq>ds)iq=-ir-is;else if(dr>ds)ir=-iq-is;
  // Cube rounding finds a nearest cell. Compare its six neighbors as well,
  // using lexicographic axial order for shared-edge/vertex ties on every host.
  const candidates=[[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]].map(([a,b])=>
    [iq+a+grid.axialOrigin[0],ir+b+grid.axialOrigin[1]]).sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  let best,distance=Infinity;
  for(const axial of candidates){
    const [cx,cy]=hexCenter(grid,axial,pixels),d=(cx-x)**2+(cy-y)**2;
    if(d<distance-1e-7){best=axial;distance=d;}
  }
  return best;
}

// Viewport culling uses core pixels, independent of zoom, DPR and crop origin.
export function* visibleHexes(grid,rect,pixels=MAP_SCALE.hexPixels) {
  const radius=side*pixels/MAP_SCALE.hexPixels,step=columnStep*pixels/MAP_SCALE.hexPixels;
  // Inverse-rotate the viewport, conservatively enclosing it in grid space.
  // Enumerating here stays proportional to visible cells at every depth.
  if(grid.rotation){
    const c=Math.cos(grid.rotation),s=Math.sin(grid.rotation);
    const points=[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]]
      .map(([x,y])=>[x-grid.origin[0],y-grid.origin[1]]).map(([x,y])=>[x*c+y*s,-x*s+y*c]);
    const x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1]));
    yield* visibleHexes({...grid,origin:[0,0],rotation:0},{x,y,width:Math.max(...points.map(p=>p[0]))-x,height:Math.max(...points.map(p=>p[1]))-y},pixels);
    return;
  }
  const qMin=Math.floor((rect.x-radius-grid.origin[0])/step)+grid.axialOrigin[0];
  const qMax=Math.ceil((rect.x+rect.width+radius-grid.origin[0])/step)+grid.axialOrigin[0];
  for(let q=qMin;q<=qMax;q++){
    const shift=(q-grid.axialOrigin[0])/2;
    const rMin=Math.floor((rect.y-pixels/2-grid.origin[1])/pixels-shift)+grid.axialOrigin[1];
    const rMax=Math.ceil((rect.y+rect.height+pixels/2-grid.origin[1])/pixels-shift)+grid.axialOrigin[1];
    for(let r=rMin;r<=rMax;r++)yield [q,r];
  }
}

export function validateManifest(value) {
  require(record(value) && value.version===2,'Expected a version 2 map manifest; re-export older drafts');
  require(localPath(value.image) && /\.png$/i.test(value.image),'Manifest image must be a local relative PNG path');
  require(pair(value.sourceOffset) && value.sourceOffset.every(v=>Number.isSafeInteger(v) && v>=0 && v<=100000),
    'sourceOffset must contain two nonnegative integer Photoshop pixel coordinates');
  return value;
}

// Dimensions are decoded by the host, never configured in map.json.
export function resolveMapSource(manifest,{width,height}={}) {
  validateManifest(manifest);
  require([width,height].every(v=>Number.isInteger(v) && v>0 && v<=50000) && width*height<=250_000_000,
    'Invalid or missing decoded PNG dimensions');
  require(manifest.sourceOffset[0]+width<=100000 && manifest.sourceOffset[1]+height<=100000,'Image exceeds supported Photoshop coordinates');
  return {...manifest,width,height};
}

export function validateCrop(value,image={width:100000,height:100000}) {
  require(record(value) && ['x','y','width','height'].every(key=>typeof value[key]==='number' && finite(value[key])) &&
    value.x>=0 && value.y>=0 && value.width>0 && value.height>0 &&
    value.x+value.width<=image.width && value.y+value.height<=image.height,'Crop must be a positive rectangle inside the coordinate bounds');
  return {x:value.x,y:value.y,width:value.width,height:value.height};
}

// Hex endpoints are inclusive; abbreviated addresses use the first hex of the
// block/section, exactly as in the exporter. Intersect with the PNG afterwards.
export function resolveCrop(value) {
  if(record(value) && ('topLeft' in value || 'bottomRight' in value)){
    require(Object.keys(value).every(key=>['topLeft','bottomRight'].includes(key)),
      'Crop must use either topLeft/bottomRight hex references or x/y/width/height pixels');
    return hexRangeBounds(value.topLeft,value.bottomRight);
  }
  return validateCrop(value);
}

export function validateMapDefinition(data,manifest) {
  resolveMapSource(manifest,manifest);
  require(record(data) && data.version===2,'Expected a version 2 map block');
  require(typeof data.source==='string' && data.source.length<=1024 && data.source.trim().length>0 && !/[\x00-\x1f\x7f]/.test(data.source),
    'A local manifest source is required');
  require(data.coordinateFrame===undefined,'Old coordinateFrame uses export-local pixels: add the old export offset to crop coordinates and remove coordinateFrame');
  require(data.id===undefined || id(data.id),'Invalid map block ID');
  for(const key of ['image','bounds','calibration','scale','unit','lat','long','defaultZoom'])require(data[key]===undefined,'Version 2 maps inherit '+key+' from the manifest or crop');
  require(data.grid===undefined || record(data.grid),'grid must be an object');
  for(const key of ['visible','showCoordinates'])require(data.grid?.[key]===undefined || typeof data.grid[key]==='boolean','grid.'+key+' must be boolean');
  const extent=sourceExtent(manifest),requested=data.crop===undefined?extent:resolveCrop(data.crop);
  const left=Math.max(requested.x,extent.x),top=Math.max(requested.y,extent.y);
  const right=Math.min(requested.x+requested.width,extent.x+extent.width),bottom=Math.min(requested.y+requested.height,extent.y+extent.height);
  require(right>left && bottom>top,'Crop does not intersect the exported image');
  const local=point=>point.map((v,i)=>v-manifest.sourceOffset[i]);
  return {crop:{x:left-extent.x,y:top-extent.y,width:right-left,height:bottom-top},
    grid:{...structuredClone(MAP_GRID),origin:local(MAP_GRID.origin),blockOrigin:local(MAP_GRID.blockOrigin),
      visible:data.grid?.visible??false,showCoordinates:data.grid?.showCoordinates??true},
    bounds:[[0,0],[manifest.height,manifest.width]],
    measurement:{unit:'miles',hexMiles:MAP_SCALE.hexMiles,xScale:MAP_SCALE.milesPerPixel,yScale:MAP_SCALE.milesPerPixel}};
}
