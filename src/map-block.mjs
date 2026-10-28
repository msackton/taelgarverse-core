import {parseDocument,isMap,isSeq} from 'yaml';
import {scanFencedCodeBlocks,prefixMarkdownLines} from './markdown-fences.mjs';
import {validateMapDefinition} from './map-core.mjs';

export function mapDocument(source) {
  const document=parseDocument(source,{keepSourceTokens:true,uniqueKeys:true});
  if(document.errors.length)throw new Error('Map YAML: '+document.errors[0].message);
  if(!isMap(document.contents))throw new Error('Expected a map definition');
  document.toJS({maxAliasCount:0});
  return document;
}
export const parseMapBlock=source=>mapDocument(source).toJS({maxAliasCount:0});
export const mapBlockId=()=> 'map-'+crypto.randomUUID();
const normalized=source=>source.replace(/\r\n/g,'\n').replace(/\n+$/,'');
export function mapFences(text) {
  return scanFencedCodeBlocks(text).filter(b=>b.language==='taelgar-map' && b.closed).map(block=>{
    let data;try{data=parseMapBlock(block.body);}catch{/* Malformed other maps are never edited. */}
    return {...block,data,raw:text.slice(block.start,block.end)};
  });
}
export function captureMapBlock(text,{source,lineHint,id}={}) {
  let matches=mapFences(text).filter(b=>id?b.data?.id===id:source!==undefined?normalized(b.body)===normalized(source):b.startLine-1<=lineHint && b.endLine-1>=lineHint);
  if(matches.length>1 && lineHint!==undefined)matches=matches.filter(b=>b.startLine-1<=lineHint && b.endLine-1>=lineHint);
  if(matches.length!==1)throw new Error('Cannot identify one map block. Refresh the note or give each map a unique id.');
  const block=matches[0];if(block.data?.version!==2)throw new Error('The map editor requires a version 2 map.');
  if(block.data.id && mapFences(text).filter(b=>b.data?.id===block.data.id).length!==1)throw new Error('Duplicate map block id; assign unique ids before editing.');
  return {id:block.data.id,raw:block.raw,start:block.start,lineHint:block.startLine-1,body:block.body,note:text};
}
export function resolveMapBlock(text,guard) {
  let matches=mapFences(text).filter(b=>guard.id?b.data?.id===guard.id:b.raw===guard.raw);
  if(!guard.id && matches.length>1 && text===guard.note)matches=matches.filter(b=>b.start===guard.start);
  if(matches.length!==1 || matches[0].raw!==guard.raw)throw new Error('The selected map block changed or is ambiguous. Your draft is retained; reload the note before saving.');
  return matches[0];
}

// Retain comments and scalar presentation on existing nodes. IDs associate sequence
// nodes with their comments when an author changes their order.
function updateNode(doc,node,value) {
  if(isMap(node) && value && typeof value==='object' && !Array.isArray(value)){
    for(const pair of [...node.items])if(!Object.hasOwn(value,String(pair.key.value)))node.delete(pair.key.value);
    for(const [key,item] of Object.entries(value))node.set(key,updateNode(doc,node.get(key,true),item));
    return node;
  }
  if(isSeq(node) && Array.isArray(value)){
    const previous=[...node.items];
    node.items=value.map((item,i)=>updateNode(doc,item?.id?previous.find(n=>isMap(n) && n.get('id')===item.id):previous[i],item));return node;
  }
  if(node && !isMap(node) && !isSeq(node) && node.value===value)return node;
  const replacement=doc.createNode(value);
  for(const key of ['comment','commentBefore','spaceBefore'])if(node?.[key]!==undefined)replacement[key]=node[key];
  return replacement;
}
export function patchMapBlock(text,guard,draft,manifest,{newId=mapBlockId}={}) {
  const block=resolveMapBlock(text,guard),doc=mapDocument(block.body),original=doc.toJS({maxAliasCount:0});
  if(draft.source!==original.source)throw new Error('Source cannot be changed by the map editor.');
  const id=original.id || newId();
  if(mapFences(text).some(b=>b.start!==block.start && b.data?.id===id))throw new Error('Map block id is already used in this note.');
  const updated={...original,id};
  for(const key of ['crop','grid']){if(draft[key]===undefined)delete updated[key];else updated[key]=draft[key];}
  validateMapDefinition(updated,manifest);
  for(const key of ['id','crop','grid']){
    if(updated[key]===undefined)doc.delete(key);else doc.set(key,updateNode(doc,doc.get(key,true),updated[key]));
  }
  const newline=block.raw.includes('\r\n')?'\r\n':'\n';
  const firstEnd=block.raw.indexOf('\n')+1,lastStart=block.raw.lastIndexOf('\n',block.raw.replace(/\r?\n$/,'').length-1)+1;
  const body=prefixMarkdownLines(doc.toString({lineWidth:0}),block.quotePrefix).replace(/\r?\n/g,newline);
  const replacement=block.raw.slice(0,firstEnd)+body+block.raw.slice(lastStart);
  const result=text.slice(0,block.start)+replacement+text.slice(block.end);
  return {text:result,from:block.start,to:block.end,replacement,block:updated,guard:captureMapBlock(result,{id})};
}

export function baselineViewConfig(block,manifest,image) {
  const validated=validateMapDefinition(block,manifest);
  const size=(value,fallback)=>{const match=/^(\d+(?:\.\d+)?)(px|%)?$/.exec(String(value??fallback));if(!match || +match[1]<=0 || +match[1]>2000)throw new Error('Invalid map size');return match[1]+(match[2]||'px');};
  const minZoom=block.minZoom??-4,maxZoom=block.maxZoom??6;
  if(![minZoom,maxZoom].every(Number.isFinite) || minZoom < -10 || maxZoom>10 || minZoom>maxZoom)throw new Error('Invalid map zoom limits');
  if(block.fitBounds!==undefined && typeof block.fitBounds!=='boolean')throw new Error('fitBounds must be boolean');
  return {version:2,...validated,image,minZoom,maxZoom,defaultZoom:minZoom,fitBounds:block.fitBounds??true,height:size(block.height,'650px'),width:size(block.width,'100%')};
}
