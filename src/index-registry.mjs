import {parse} from 'yaml';
import {indexObject,indexConditions,validateIndexCondition} from './index-fields.mjs';
import {indexColumns,indexCards,parseIndexSort} from './index-columns.mjs';

export const EMPTY_INDEX_REGISTRY=Object.freeze({version:1,indexes:Object.freeze({}),headerRules:Object.freeze({})});
const idPattern=/^[a-z][a-z0-9-]{0,63}$/;
const indexKeys=['label','enabled','extends','where','target','mode','show','heading','columns','cards','sort','header'];
const invocationKeys=['index','label','target','mode','show','heading','columns','cards','sort'];
const clone=value=>structuredClone(value);
const keys=(value,allowed,name)=>{if(!indexObject(value))throw new Error(name+' must be an object.');for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error('Unknown '+name+' option: '+key);};
const id=value=>{if(typeof value!=='string' || !idPattern.test(value))throw new Error('Invalid index/rule ID: '+value);};
function options(value,{invocation=false}={}) {
  keys(value,invocation?invocationKeys:indexKeys,invocation?'index invocation':'index');
  if(invocation)id(value.index);
  if(value.label!==undefined && (typeof value.label!=='string' || !value.label.trim()))throw new Error('label must be non-empty text.');
  for(const key of ['enabled','heading'])if(value[key]!==undefined && typeof value[key]!=='boolean')throw new Error(key+' must be a boolean.');
  if(value.extends!==undefined)id(value.extends);
  if(value.target!==undefined && (typeof value.target!=='string' || !value.target.trim() || value.target.startsWith('$') && value.target!=='$source'))throw new Error('target must be a note reference.');
  if(value.mode!==undefined && !['table','grid'].includes(value.mode))throw new Error('mode must be table or grid.');
  if(value.show!==undefined && !['both','website','obsidian'].includes(value.show))throw new Error('show must be both, website, or obsidian.');
  if(value.where!==undefined)validateIndexCondition(value.where);
  if(value.columns!==undefined)indexColumns(value.columns);
  if(value.cards!==undefined)indexCards(value.cards);
  if(value.sort!==undefined)parseIndexSort(value.sort);
  if(value.header!==undefined) {
    keys(value.header,['mode','hideWhenEmpty'],'header');
    if(value.header.mode!==undefined && !['table','grid'].includes(value.header.mode))throw new Error('header.mode must be table or grid.');
    if(value.header.hideWhenEmpty!==undefined && typeof value.header.hideWhenEmpty!=='boolean')throw new Error('header.hideWhenEmpty must be a boolean.');
  }
}
function validatePatch(patch,name) {
  keys(patch,['indexes','headerRules'],name);
  for(const kind of ['indexes','headerRules'])if(patch[kind]!==undefined) {
    if(!indexObject(patch[kind]) || Object.keys(patch[kind]).length>512)throw new Error(kind+' must be a map with at most 512 entries.');
    for(const [key,value] of Object.entries(patch[kind])) {
      id(key);
      try {
        if(kind==='indexes')options(value);
        else {
          keys(value,['enabled','when','indexes'],'header rule');
          if(value.enabled!==undefined && typeof value.enabled!=='boolean')throw new Error('Rule enabled must be a boolean.');
          if(value.when!==undefined)validateIndexCondition(value.when,{relationship:false});
          if(value.indexes!==undefined) {
            if(!Array.isArray(value.indexes) || value.indexes.length>128)throw new Error('Rule indexes must be a list of IDs.');
            value.indexes.forEach(id);
          }
        }
      }catch(error){throw new Error(kind+'.'+key+': '+error.message,{cause:error});}
    }
  }
}
function document(value,{overlay=false}={}) {
  keys(value,['version','indexes','headerRules','hosts'],'registry');
  if(value.version!==1 && !(overlay && value.version===undefined))throw new Error('Registry version must be 1.');
  validatePatch({indexes:value.indexes,headerRules:value.headerRules},'registry');
  if(value.hosts!==undefined) {
    keys(value.hosts,['website','obsidian'],'hosts');
    for(const [host,patch] of Object.entries(value.hosts))validatePatch(patch,'hosts.'+host);
  }
  return value;
}
export function parseIndexRegistry(source,{overlay=false,filename='index registry'}={}) {
  try{return document(parse(source,{maxAliasCount:20}),{overlay});}
  catch(error){throw new Error(filename+': '+error.message,{cause:error});}
}
function patchEntries(target,patch={}) {
  for(const kind of ['indexes','headerRules'])for(const [key,value] of Object.entries(patch[kind]||{})) {
    const before=target[kind][key]||{},next={...before,...clone(value)};
    if(value.cards!==undefined)next.cards={...before.cards,...clone(value.cards)};
    if(value.header!==undefined)next.header={...before.header,...value.header};
    target[kind][key]=next;
  }
}
function freeze(value) {if(value && typeof value==='object' && !Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

export function compileIndexRegistry(base,override,{host='website'}={}) {
  if(!['website','obsidian'].includes(host))throw new Error('Unknown index registry host.');
  document(base);if(override!==undefined)document(override,{overlay:true});
  const merged={version:1,indexes:{},headerRules:{}};
  for(const input of [base,override].filter(Boolean)) {
    patchEntries(merged,input);
    if(input.hosts?.[host])patchEntries(merged,input.hosts[host]);
  }
  const resolved={};
  const resolve=(key,trail=[])=>{
    if(Object.hasOwn(resolved,key))return resolved[key];
    if(!Object.hasOwn(merged.indexes,key))throw new Error('Unknown parent index: '+key);
    if(trail.includes(key) || trail.length>64)throw new Error('Index inheritance cycle: '+[...trail,key].join(' → '));
    const current=merged.indexes[key],parent=current.extends?resolve(current.extends,[...trail,key]):undefined;
    const conditions=[...indexConditions(parent?.where),...indexConditions(current.where)];
    const result={...current};delete result.extends;
    if(conditions.length)result.where=conditions.length===1?conditions[0]:{all:conditions};
    if(current.columns===undefined && parent?.columns!==undefined)result.columns=clone(parent.columns);
    if(result.enabled!==false) {
      if(!result.label || !result.where)throw new Error('Index '+key+' requires label and where.');
      validateIndexCondition(result.where);
      const membership=conditions.some(condition=>condition.relation==='affiliation');
      indexColumns(result.columns,{membership});indexCards(result.cards,{membership});parseIndexSort(result.sort,{membership});
    }
    return resolved[key]=result;
  };
  for(const key of Object.keys(merged.indexes))resolve(key);
  for(const [key,rule] of Object.entries(merged.headerRules)) {
    if(rule.enabled!==false && (!rule.when || !Array.isArray(rule.indexes)))throw new Error('Header rule '+key+' requires when and indexes.');
    for(const index of rule.indexes||[])if(!Object.hasOwn(resolved,index))throw new Error('Header rule '+key+' references unknown index: '+index);
  }
  return freeze({version:1,indexes:resolved,headerRules:merged.headerRules});
}

export function parseIndex(source,registry,context={}) {
  const value=parse(source,{maxAliasCount:20});
  options(value,{invocation:true});
  return registry?resolveIndex(registry,value,context):value;
}
export function resolveIndex(registry=EMPTY_INDEX_REGISTRY,invocation,{host='website',header=false}={}) {
  if(invocation?._resolved)return invocation;
  options(invocation,{invocation:true});
  if(!Object.hasOwn(registry.indexes || {},invocation.index))throw new Error('Unknown named index: '+invocation.index);
  const definition=registry.indexes[invocation.index];
  const value={...definition,...invocation,cards:{...definition.cards,...invocation.cards}};
  const membership=indexConditions(value.where).some(condition=>condition.relation==='affiliation');
  if(value.enabled===false)return {...value,_resolved:true,enabled:false,label:value.label || invocation.index,columns:[],cards:indexCards(),sort:[],header:{hideWhenEmpty:true,mode:'grid'}};
  return {...value,_resolved:true,label:value.label||invocation.index,
    enabled:value.enabled!==false && (value.show===undefined || value.show==='both' || value.show===host),
    mode:invocation.mode??(header?definition.header?.mode:definition.mode)??'grid',
    heading:value.heading??true,show:value.show??'both',
    header:{mode:definition.header?.mode??'grid',hideWhenEmpty:definition.header?.hideWhenEmpty??true},
    columns:indexColumns(value.columns,{membership}),cards:indexCards(value.cards,{membership}),sort:parseIndexSort(value.sort,{membership})};
}

export function validateHeaderIndexIds(value,registry=EMPTY_INDEX_REGISTRY) {
  if(!Array.isArray(value))throw new Error('indexes must be an array of named index IDs.');
  for(const key of value) {id(key);if(!Object.hasOwn(registry.indexes,key))throw new Error('Unknown header index: '+key);}
  return [...new Set(value)];
}
