import geometry from './map-geometry.json' with {type:'json'};

// Flat aperture-7 grids. Odd levels rotate -19.1066 degrees in Photoshop's
// y-down frame; even levels return to the original orientation. These integer
// matrices are inverses up to a factor of 7, so ownership never uses rounding.
export const MAX_HEX_DEPTH=4;
const matrices=[[[3,1],[-1,2]],[[2,-1],[1,3]]];
const offsets=[[0,0],[0,-1],[1,-1],[1,0],[0,1],[-1,1],[-1,0]];
const multiply=(m,[q,r])=>[m[0][0]*q+m[0][1]*r,m[1][0]*q+m[1][1]*r];
function checkDepth(depth){
  if(!Number.isInteger(depth) || depth<0 || depth>MAX_HEX_DEPTH)throw new Error(`Hex depth must be 0–${MAX_HEX_DEPTH}`);
}
function checkAxial(axial){
  if(!Array.isArray(axial) || axial.length!==2 || !axial.every(Number.isSafeInteger))throw new Error('Invalid hex coordinate');
}
export function hexLevel(depth){
  checkDepth(depth);
  return {depth,hexPixels:geometry.hexPixels/7**(depth/2),hexMiles:geometry.hexMiles/7**(depth/2),
    rotation:depth%2?-Math.atan(Math.sqrt(3)/5):0};
}
export function axialPoint([q,r],pixels,rotation=0){
  const x=Math.sqrt(3)*pixels*q/2,y=pixels*(r+q/2),c=Math.cos(rotation),s=Math.sin(rotation);
  return [x*c-y*s,x*s+y*c];
}
export function childHex(axial,digit,depth){
  checkDepth(depth);checkAxial(axial);
  if(depth===0 || !Number.isInteger(digit) || digit<0 || digit>6)throw new Error('A child needs a depth and digit 0–6');
  return multiply(matrices[depth%2],axial).map((v,i)=>v+offsets[digit][i]);
}
export function parentHex(axial,depth){
  checkDepth(depth);checkAxial(axial);
  if(depth===0)throw new Error('The 24-mile hex has no hex parent');
  for(let digit=0;digit<7;digit++){
    const numerators=multiply(matrices[(depth+1)%2],axial.map((v,i)=>v-offsets[digit][i]));
    if(numerators.every(v=>v%7===0))return {axial:numerators.map(v=>v/7 || 0),digit};
  }
  throw new Error('Invalid hex ownership');
}
export function refineAxial(axial,path){
  if(typeof path!=='string' || !/^[0-6]*$/.test(path))throw new Error('Hex path must contain digits 0–6');
  checkDepth(path.length);checkAxial(axial);
  for(let i=0;i<path.length;i++)axial=childHex(axial,Number(path[i]),i+1);
  return axial;
}
export function hexAncestry(axial,depth){
  checkDepth(depth);checkAxial(axial);let path='';
  for(let level=depth;level>0;level--){const parent=parentHex(axial,level);axial=parent.axial;path=parent.digit+path;}
  return {axial,path};
}
export function hierarchyGrid(grid,depth){
  const level=hexLevel(depth);
  return {...grid,rotation:level.rotation,axialOrigin:refineAxial(grid.axialOrigin,'0'.repeat(depth))};
}
