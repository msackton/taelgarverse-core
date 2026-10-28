import {Document,parseDocument,isMap} from 'yaml';
import {MAP_GRID,pointToHex} from './map-core.mjs';
import {MAX_HEX_DEPTH,hexLevel,hierarchyGrid} from './map-hex-hierarchy.mjs';
import {axialToHexReference} from './map-locators.mjs';
import {DEFAULT_MAP_IMPORTANCE,MAP_IMPORTANCE,mapImportance} from './map-importance.mjs';
import {DEFAULT_MAP_SYMBOL,MAP_SYMBOLS,mapSymbol} from './map-symbols.mjs';

// Coordinates, not a snapped hex center or an export filename, are authoritative.
export function mapLocation(point,importance=DEFAULT_MAP_IMPORTANCE,symbol=DEFAULT_MAP_SYMBOL){
  mapImportance(importance);mapSymbol(symbol);
  if(!Array.isArray(point) || point.length!==2 || !point.every(v=>Number.isFinite(v) && v>=0 && v<=100000))
    throw new Error('Choose a finite position on the Photoshop canvas.');
  const [x,y]=point,level=hexLevel(MAX_HEX_DEPTH);
  const hex=axialToHexReference(pointToHex(hierarchyGrid(MAP_GRID,MAX_HEX_DEPTH),point,level.hexPixels),MAX_HEX_DEPTH);
  if(!hex)throw new Error('This point is outside the numbered Taelgar grid.');
  return {x,y,hex,importance,symbol};
}
export function storedMapLocation(value){
  const importance=MAP_IMPORTANCE.some(tier=>tier.value===value?.importance)?value.importance:DEFAULT_MAP_IMPORTANCE;
  const symbol=MAP_SYMBOLS.some(item=>item.value===value?.symbol)?value.symbol:DEFAULT_MAP_SYMBOL;
  try{return mapLocation([value?.x,value?.y],importance,symbol);}catch{return null;}
}

function locationField(text){
  const start=/^(?:\uFEFF)?---[ \t]*\r?\n/.exec(text);
  if(!start)return {from:text.startsWith('\uFEFF')?1:0,to:text.startsWith('\uFEFF')?1:0,raw:null,location:null,frontmatter:false};
  const tail=text.slice(start[0].length),end=/^---[ \t]*(?:\r?\n|$)/m.exec(tail);
  if(!end)throw new Error('The town note has unclosed frontmatter; fix it before saving a position.');
  const source=tail.slice(0,end.index),doc=parseDocument(source,{keepSourceTokens:true,uniqueKeys:true});
  if(doc.errors.length || (doc.contents && !isMap(doc.contents)))throw new Error('The town note has invalid frontmatter; fix it before saving a position.');
  if(doc.contents?.flow)throw new Error('Use block-style frontmatter before saving a town position.');
  const value=doc.toJS({maxAliasCount:0});
  const pair=doc.contents?.items.find(p=>p.key?.value==='mapLocation');
  const key=pair?.key??doc.contents?.items[0]?.key,pos=key?.range?.[0]??0,lineStart=source.lastIndexOf('\n',pos-1)+1;
  const indent=source.slice(lineStart,pos);
  if(!/^[ \t]*$/.test(indent))throw new Error('Use ordinary frontmatter keys before saving a town position.');
  if(!pair)return {from:start[0].length+source.length,to:start[0].length+source.length,raw:null,location:null,frontmatter:true,indent};
  const from=start[0].length+lineStart,to=start[0].length+(pair.value?.range?.[2]??pair.key.range[2]);
  return {from,to,raw:text.slice(from,to),location:storedMapLocation(value.mapLocation),frontmatter:true,indent};
}
export function captureMapLocation(text){const field=locationField(text);return {raw:field.raw,location:field.location};}
export function patchMapLocation(text,guard,point,{importance,symbol}={}){
  const field=locationField(text);
  if(field.raw!==guard.raw)throw new Error('This town’s saved position changed. Cancel and choose the town again before saving.');
  const location=mapLocation(point,importance??field.location?.importance??DEFAULT_MAP_IMPORTANCE,
    symbol??field.location?.symbol??DEFAULT_MAP_SYMBOL),newline=text.includes('\r\n')?'\r\n':'\n';
  let replacement=new Document({mapLocation:location}).toString({lineWidth:0}).trimEnd().split('\n').map(line=>(field.indent??'')+line).join(newline)+newline;
  if(!field.frontmatter)replacement='---'+newline+replacement+'---'+newline;
  const result=text.slice(0,field.from)+replacement+text.slice(field.to);
  return {text:result,from:field.from,to:field.to,replacement,location,guard:captureMapLocation(result)};
}
