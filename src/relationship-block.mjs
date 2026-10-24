import {parseDocument} from 'yaml';

export function parseRelationshipBlock(source=''){
  if(!source.trim())return {mode:'diagram'};
  if(source.length>16384)throw new Error('Relationship block configuration is too large.');
  const document=parseDocument(source);
  if(document.errors.length)throw new Error('Invalid relationship block YAML: '+document.errors[0].message);
  const value=document.toJS({maxAliasCount:20});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Use mode: diagram or mode: list.');
  if(Object.keys(value).some(key=>key!=='mode'))throw new Error('Only mode is supported; the current note and depth 1 are automatic.');
  const mode=value.mode??'diagram';
  if(!['diagram','list'].includes(mode))throw new Error('Use mode: diagram or mode: list.');
  return {mode};
}
