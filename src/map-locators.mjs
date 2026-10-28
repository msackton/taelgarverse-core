import geometry from './map-geometry.json' with {type:'json'};
import {hexLevel,refineAxial,hexAncestry,hierarchyGrid,axialPoint} from './map-hex-hierarchy.mjs';
// Global Photoshop-style addresses. Naming is independent of the export crop.
// A/D/G are the first row of sections; B/E/H and C/F/I follow below them.
export const LOCATOR_SCHEME='taelgar-block-ai24-v1';
export const BLOCK_WIDTH=18*geometry.hexPixels/2*Math.sqrt(3),BLOCK_HEIGHT=12*geometry.hexPixels;
export const SUBHEX_DIVISIONS=geometry.subhexDivisions,SUBHEX_PIXELS=geometry.hexPixels/SUBHEX_DIVISIONS,SUBHEX_MILES=geometry.hexMiles/SUBHEX_DIVISIONS;
// Fine-cell centers assigned to one coarse cell, with boundary ties going to
// the lexicographically first coarse axial coordinate. Number down columns.
export const SUBHEX_OFFSETS=Object.freeze(geometry.subhexOffsets.map(Object.freeze));
const pad=value=>String(value).padStart(2,'0');
const integer=value=>Number.isSafeInteger(value) && value>=0;
const block=(origin,row,column)=>({row:row+1,column:column+1,address:`${pad(row+1)}.${pad(column+1)}`,
  x:origin[0]+column*BLOCK_WIDTH,y:origin[1]+row*BLOCK_HEIGHT,width:BLOCK_WIDTH,height:BLOCK_HEIGHT});
export function pointToBlock(origin,[x,y]) {
  const column=Math.floor((x-origin[0])/BLOCK_WIDTH),row=Math.floor((y-origin[1])/BLOCK_HEIGHT);
  return row>=0 && column>=0?block(origin,row,column):null;
}
export function* visibleBlocks(origin,rect) {
  const column0=Math.max(0,Math.floor((rect.x-origin[0])/BLOCK_WIDTH)),column1=Math.ceil((rect.x+rect.width-origin[0])/BLOCK_WIDTH);
  const row0=Math.max(0,Math.floor((rect.y-origin[1])/BLOCK_HEIGHT)),row1=Math.ceil((rect.y+rect.height-origin[1])/BLOCK_HEIGHT);
  if(rect.width<=0 || rect.height<=0)return;
  for(let row=row0;row<row1;row++)for(let column=column0;column<column1;column++)yield block(origin,row,column);
}
export function blockGridLines(origin,rect) {
  const x0=Math.max(rect.x,origin[0]),y0=Math.max(rect.y,origin[1]),x1=rect.x+rect.width,y1=rect.y+rect.height,lines=[];
  if(x1<=x0 || y1<=y0)return lines;
  for(let column=Math.ceil((x0-origin[0])/BLOCK_WIDTH);column<=Math.floor((x1-origin[0])/BLOCK_WIDTH);column++){
    const x=origin[0]+column*BLOCK_WIDTH;lines.push([[x,y0],[x,y1]]);
  }
  for(let row=Math.ceil((y0-origin[1])/BLOCK_HEIGHT);row<=Math.floor((y1-origin[1])/BLOCK_HEIGHT);row++){
    const y=origin[1]+row*BLOCK_HEIGHT;lines.push([[x0,y],[x1,y]]);
  }
  return lines;
}
export function parseBlockLocator(value) {
  const match=typeof value==='string' && /^(\d{1,6})\.(\d{1,6})$/.exec(value.trim());
  if(!match || +match[1]<1 || +match[2]<1)throw new Error('Block must be row.column, starting at 01.01');
  return {row:+match[1],column:+match[2]};
}
export function parseHexLocator(value) {
  const match=typeof value==='string' && /^(\d{1,6})\.(\d{1,6})(?:\.([A-I])(?:\.?(\d{1,2}))?)?$/i.exec(value.trim());
  if(!match)throw new Error('Hex must be row.column[.letter[.number]], for example 16.11.A.01');
  const block=parseBlockLocator(match[1]+'.'+match[2]),number=match[4]===undefined?1:+match[4];
  if(number<1 || number>24)throw new Error('Hex number must be 01–24');
  return {...block,letter:(match[3]??'A').toUpperCase(),number};
}
export function canonicalHexLocator(value) {
  const {row,column,letter,number}=parseHexLocator(value);
  return `${pad(row)}.${pad(column)}.${letter}.${pad(number)}`;
}
export function locatorToAxial(value) {
  const {row,column,letter,number}=parseHexLocator(value),section=letter.charCodeAt(0)-65;
  const q=(column-1)*18+Math.floor(section/3)*6+Math.floor((number-1)/4);
  const offsetRow=(row-1)*12+(section%3)*4+(number-1)%4;
  // The source's odd columns start half a hex ABOVE the even columns.
  return [q,offsetRow-Math.ceil(q/2)];
}
export function axialToLocator([q,r]) {
  const offsetRow=r+Math.ceil(q/2);
  if(!integer(q) || !Number.isSafeInteger(r) || !integer(offsetRow))return null;
  const column=Math.floor(q/18)+1,row=Math.floor(offsetRow/12)+1;
  if(row>999999 || column>999999)return null;
  const section=Math.floor((q%18)/6)*3+Math.floor((offsetRow%12)/4);
  const number=(q%6)*4+offsetRow%4+1;
  return `${pad(row)}.${pad(column)}.${String.fromCharCode(65+section)}.${pad(number)}`;
}
export function subhexParent([q,r]) {
  if(!Number.isSafeInteger(q) || !Number.isSafeInteger(r))throw new Error('Invalid small-hex coordinate');
  let best,distance=Infinity;
  const q0=Math.floor(q/4),r0=Math.floor(r/4);
  // Integer squared distances in the axial basis avoid floating-point edge ties.
  for(let cq=q0-1;cq<=q0+2;cq++)for(let cr=r0-1;cr<=r0+2;cr++){
    const a=q-4*cq,b=r-4*cr,d=a*a+a*b+b*b;
    if(d<distance){best=[cq,cr];distance=d;}
  }
  return best;
}
export function subhexNumber(axial) {
  const parent=subhexParent(axial),offset=axial.map((value,i)=>value-4*parent[i]);
  return SUBHEX_OFFSETS.findIndex(([q,r])=>q===offset[0] && r===offset[1])+1;
}
export function axialToSubhexLocator(axial) {
  const parent=axialToLocator(subhexParent(axial));
  return parent?`${parent}.${pad(subhexNumber(axial))}`:null;
}
export function parseSubhexLocator(value) {
  const match=typeof value==='string' && /^(\d{1,6}\.\d{1,6}\.[A-I]\.?\d{1,2})\.(\d{1,2})$/i.exec(value.trim());
  if(!match || +match[2]<1 || +match[2]>16)throw new Error('Small hex must be a full 24-mile reference followed by .01–.16, for example 16.10.C.07.12');
  return {parent:canonicalHexLocator(match[1]),number:+match[2]};
}
export function subhexToAxial(value) {
  const {parent,number}=parseSubhexLocator(value),offset=SUBHEX_OFFSETS[number-1];
  return locatorToAxial(parent).map((v,i)=>v*4+offset[i]);
}
export function parseHexReference(value) {
  if(typeof value==='string' && value.includes('/')){
    const parts=value.trim().split('/');
    if(parts.length!==2 || !parts[1])throw new Error('Hex reference needs one slash followed by digits 0–6');
    const canonical=canonicalHexLocator(parts[0]),path=parts[1],axial=refineAxial(locatorToAxial(canonical),path);
    return {axial,...hexLevel(path.length),canonical:canonical+'/'+path};
  }
  // Old 6-mile references remain valid for existing export commands only.
  if(typeof value==='string' && /\.[A-Za-z]\.?\d+\.\d+$/.test(value.trim())){
    const {parent,number}=parseSubhexLocator(value);
    return {axial:subhexToAxial(value),hexPixels:SUBHEX_PIXELS,hexMiles:SUBHEX_MILES,canonical:`${parent}.${pad(number)}`};
  }
  return {axial:locatorToAxial(value),...hexLevel(0),canonical:canonicalHexLocator(value)};
}
export function axialToHexReference(axial,depth=0){
  const ancestor=hexAncestry(axial,depth),base=axialToLocator(ancestor.axial);
  return base && (ancestor.path?base+'/'+ancestor.path:base);
}
export function hexRangeBounds(topLeft,bottomRight,{origin=geometry.origin,axialOrigin=geometry.axialOrigin}={}) {
  const first=parseHexReference(topLeft),last=parseHexReference(bottomRight);
  if(first.depth>0 || last.depth>0){
    if(first.depth!==last.depth)throw new Error('Use two hex references at the same subdivision depth for an export');
    const grid=hierarchyGrid({origin,axialOrigin},first.depth);
    const center=cell=>axialPoint(cell.axial.map((v,i)=>v-grid.axialOrigin[i]),cell.hexPixels,cell.rotation).map((v,i)=>v+origin[i]);
    const a=center(first),b=center(last);
    if(b[0]<a[0]-1e-8 || b[1]<a[1]-1e-8)throw new Error('Bottom-right hex center must be below and right of the top-left hex center');
    // A screen-aligned rectangle between the selected centers, expanded by
    // one cell envelope. This includes both complete rotated endpoint cells.
    const radius=first.hexPixels/Math.sqrt(3),angles=Array.from({length:6},(_,i)=>i*Math.PI/3+first.rotation);
    const dx=radius*Math.max(...angles.map(a=>Math.cos(a))),dy=radius*Math.max(...angles.map(a=>Math.sin(a)));
    return {x:a[0]-dx,y:a[1]-dy,width:Math.max(0,b[0]-a[0])+2*dx,height:Math.max(0,b[1]-a[1])+2*dy};
  }
  if(first.hexMiles!==last.hexMiles)throw new Error('Use two 24-mile references or two 6-mile references for an export');
  const [q0,r0]=first.axial,[q1,r1]=last.axial,pixels=first.hexPixels,factor=40/pixels;
  const m0=r0+Math.ceil(q0/2),m1=r1+Math.ceil(q1/2);
  if(q1<q0 || m1<m0)throw new Error('Bottom-right hex must be below and right of the top-left hex in numbered rows/columns');
  if(!Array.isArray(origin) || origin.length!==2 || !origin.every(Number.isFinite) ||
    !Array.isArray(axialOrigin) || axialOrigin.length!==2 || !axialOrigin.every(Number.isSafeInteger))throw new Error('Invalid hex grid origin');
  const step=pixels/2*Math.sqrt(3),radius=pixels/Math.sqrt(3),baseY=origin[1]-40*(axialOrigin[1]+axialOrigin[0]/2);
  const hasOdd=q0%2!==0 || q1>q0,hasEven=q0%2===0 || q1>q0;
  // Enclose every selected cell, including staggered columns between the corners.
  const x=origin[0]+(q0-factor*axialOrigin[0])*step-radius,y=baseY+pixels*m0-(hasOdd?pixels/2:0)-pixels/2;
  const right=origin[0]+(q1-factor*axialOrigin[0])*step+radius,bottom=baseY+pixels*m1-(hasEven?0:pixels/2)+pixels/2;
  return {x,y,width:right-x,height:bottom-y};
}
export function outwardPixelBounds(rect) {
  const edges=[rect.x,rect.y,rect.x+rect.width,rect.y+rect.height];
  if(!edges.every(Number.isFinite) || rect.width<=0 || rect.height<=0)throw new Error('Invalid export rectangle');
  // Do not round individual blocks: round only the final global image edges.
  return [Math.floor(edges[0]),Math.floor(edges[1]),Math.ceil(edges[2]),Math.ceil(edges[3])];
}
