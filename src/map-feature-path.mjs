import {DEFAULT_MAP_IMPORTANCE,mapImportance} from './map-importance.mjs';

export const MAX_MAP_PATH_POINTS=10000;
export const MAP_PATH_STYLES=Object.freeze({river:{color:'#287ca1',weight:3},road:{color:'#926138',weight:2.5}});

// Persistent open polylines use original Photoshop coordinates. Crossings and
// loops are valid; unlike region outlines they never acquire an implicit closure.
export function validatePathPoints(value){
  if(!Array.isArray(value) || value.length<2 || value.length>MAX_MAP_PATH_POINTS)
    throw new Error('A path needs 2–10,000 points.');
  const points=value.map(point=>{
    if(!Array.isArray(point) || point.length!==2 || !point.every(v=>Number.isFinite(v) && v>=0 && v<=100000))
      throw new Error('Path points must be finite Photoshop coordinates between 0 and 100,000.');
    return [...point];
  });
  if(points.some((p,i)=>i && p.every((v,j)=>v===points[i-1][j])))throw new Error('Consecutive path points must be different.');
  return points;
}
export function mapPathSource(source){
  if(typeof source!=='string' || source.length>1024 || !source.endsWith('.map-path.json') ||
    /[:?#\\\x00-\x1f\x7f]/.test(source) || source.split('/').some(part=>!part || part==='.' || part==='..' || part.startsWith('.') || part!==part.trim()))
    throw new Error('Path source must be an exact vault-root-relative .map-path.json filename.');
  return source;
}
export function validateMapPath(value){
  if(!value || !['river','road'].includes(value.kind))throw new Error('Path kind must be river or road.');
  const importance=value.importance??DEFAULT_MAP_IMPORTANCE;mapImportance(importance);
  if(value.source!==undefined){
    if(value.points!==undefined)throw new Error('Use a path source or inline points, not both.');
    return {kind:value.kind,importance,source:mapPathSource(value.source)};
  }
  return {kind:value.kind,importance,points:validatePathPoints(value.points)};
}
export function validateMapPathGeometry(value){
  if(!value || value.version!==1)throw new Error('Path geometry must use version 1.');
  return {version:1,points:validatePathPoints(value.points)};
}
export function resolveMapPath(value,geometry){
  const path=validateMapPath(value);
  return path.source?{kind:path.kind,importance:path.importance,points:validateMapPathGeometry(geometry).points}:path;
}
export function storedMapPath(value){try{return validateMapPath(value);}catch{return null;}}
export const pathGeometryText=value=>{
  const {points}=validateMapPathGeometry(value);
  return '{\n  "version": 1,\n  "points": [\n'+points.map(p=>'    '+JSON.stringify(p)).join(',\n')+'\n  ]\n}\n';
};
export function pathIntersectsCrop(points,crop,offset){
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const [x,y] of points){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  return right>=crop.x+offset[0] && left<=crop.x+offset[0]+crop.width && bottom>=crop.y+offset[1] && top<=crop.y+offset[1]+crop.height;
}
