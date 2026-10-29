// Regional artwork has its own pixel resolution but shares the world XY frame.
const record=value=>value && typeof value==='object' && !Array.isArray(value);
const require=(ok,message)=>{if(!ok)throw new Error(message);};
export const detailPath=value=>typeof value==='string' && value.length<=1024 &&
  !/[:?#\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(p=>p && p!=='.' && p!=='..' && !p.startsWith('.'));
export function detailSources(value=[]){
  require(Array.isArray(value) && value.length<=32 && value.every(p=>detailPath(p) && p.endsWith('.map-detail.json')) && new Set(value).size===value.length,
    'details must be unique vault-root-relative .map-detail.json paths (at most 32)');
  return value;
}
export function validateDetailManifest(value){
  require(record(value) && value.version===1,'Expected a version 1 regional artwork manifest');
  require(Object.keys(value).every(k=>['version','name','image','worldBounds','pixelSize','fadeZoom'].includes(k)),'Unknown regional artwork manifest field');
  require(typeof value.name==='string' && value.name.trim() && value.name.length<=120,'Regional artwork needs a name (up to 120 characters)');
  require(detailPath(value.image) && /\.png$/i.test(value.image),'Regional image must be an exact relative PNG path');
  const r=value.worldBounds;
  require(record(r) && Object.keys(r).length===4 && ['x','y','width','height'].every(k=>Number.isFinite(r[k])) &&
    r.x>=0 && r.y>=0 && r.width>0 && r.height>0 && r.x+r.width<=100000 && r.y+r.height<=100000,'Invalid regional worldBounds rectangle');
  const size=value.pixelSize;
  require(Array.isArray(size) && size.length===2 && size.every(n=>Number.isSafeInteger(n) && n>0 && n<=16384) && size[0]*size[1]<=64_000_000,
    'Regional artwork is limited to 16384 pixels per side and 64 million pixels');
  require(Math.abs(size[0]/r.width-size[1]/r.height)<=1e-6*Math.max(size[0]/r.width,size[1]/r.height),'Regional pixelSize must preserve the world footprint aspect ratio');
  const zoom=value.fadeZoom??[0,2];
  require(Array.isArray(zoom) && zoom.length===2 && zoom.every(z=>Number.isFinite(z) && z>=-10 && z<=10) && zoom[1]>zoom[0],
    'fadeZoom must contain two increasing zoom levels between -10 and 10');
  return {...value,fadeZoom:zoom};
}
export function resolveDetailManifest(value,size,image){
  const detail=validateDetailManifest(value);
  require(size?.width===detail.pixelSize[0] && size?.height===detail.pixelSize[1],
    'Regional PNG dimensions do not match pixelSize; preserve the full template canvas without trimming or resizing');
  return {...detail,image};
}
export function detailRectangle(detail,offset=[0,0]){
  return {...detail.worldBounds,x:detail.worldBounds.x-offset[0],y:detail.worldBounds.y-offset[1]};
}
export const rectanglesIntersect=(a,b)=>a.x<b.x+b.width && a.y<b.y+b.height && a.x+a.width>b.x && a.y+a.height>b.y;
export const detailOpacity=(zoom,[start,end])=>Math.max(0,Math.min(1,(zoom-start)/(end-start)));
export function regionalTemplate({name,image,worldBounds,scale=8,fadeZoom=[0,2]}){
  require(Number.isInteger(scale) && scale>=1 && scale<=32,'Template resolution must be an integer from 1 to 32');
  return validateDetailManifest({version:1,name,image,worldBounds,pixelSize:[worldBounds.width*scale,worldBounds.height*scale],fadeZoom});
}
