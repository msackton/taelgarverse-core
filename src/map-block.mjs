import {parseDocument,isMap} from 'yaml';
import {validateMapDefinition} from './map-core.mjs';

export function mapDocument(source) {
  const document=parseDocument(source,{keepSourceTokens:true,uniqueKeys:true});
  if(document.errors.length)throw new Error('Map YAML: '+document.errors[0].message);
  if(!isMap(document.contents))throw new Error('Expected a map definition');
  document.toJS({maxAliasCount:0});
  return document;
}
export const parseMapBlock=source=>mapDocument(source).toJS({maxAliasCount:0});

export function baselineViewConfig(block,manifest,image) {
  const validated=validateMapDefinition(block,manifest);
  const size=(value,fallback)=>{const match=/^(\d+(?:\.\d+)?)(px|%)?$/.exec(String(value??fallback));if(!match || +match[1]<=0 || +match[1]>2000)throw new Error('Invalid map size');return match[1]+(match[2]||'px');};
  const minZoom=block.minZoom??-4,maxZoom=block.maxZoom??6;
  if(![minZoom,maxZoom].every(Number.isFinite) || minZoom < -10 || maxZoom>10 || minZoom>maxZoom)throw new Error('Invalid map zoom limits');
  if(block.fitBounds!==undefined && typeof block.fitBounds!=='boolean')throw new Error('fitBounds must be boolean');
  return {version:2,...validated,image,minZoom,maxZoom,defaultZoom:minZoom,fitBounds:block.fitBounds??true,height:size(block.height,'650px'),width:size(block.width,'100%')};
}
