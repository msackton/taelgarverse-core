import {parseDocument} from 'yaml';
import {createHeaderContext,HeaderDataError} from './header-core/index.mjs';
import {indexTableColumns,validateIndexTableOptions} from './index-columns.mjs';
import {createIndexRows,indexReference} from './index-rows.mjs';
import {filterWorldbuilding} from './relationship-graph.mjs';

const defaultTypes = ['person','object'];
const allowedTypes = [...defaultTypes,'group','place'];
const tableOptions = ['mode','types','columns','columnHeadings','sortBy'];

export function parseRelationshipBlock(source=''){
  if(!source.trim())return {mode:'diagram'};
  if(source.length>16384)throw new Error('Relationship block configuration is too large.');
  const document=parseDocument(source);
  if(document.errors.length)throw new Error('Invalid relationship block YAML: '+document.errors[0].message);
  const value=document.toJS({maxAliasCount:20});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Use a YAML mapping for a relationship block.');
  const mode=value.mode??'diagram';
  if(!['diagram','list','table'].includes(mode))throw new Error('mode must be diagram, list, or table.');
  const allowed=mode==='table'?tableOptions:['mode'];
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error('Unknown option for relationship '+mode+' mode: '+key);
  if(mode!=='table')return {mode};

  const types=value.types===undefined?[...defaultTypes]:value.types;
  if(!Array.isArray(types)||!types.length||types.some(type=>!allowedTypes.includes(type))||new Set(types).size!==types.length)
    throw new Error('types must be a nonempty list of distinct values drawn from person, object, group, and place.');
  validateIndexTableOptions({...value,mode,from:types});
  return {...value,mode,types};
}

export function queryRelationshipTable(snapshot, graph, {types,columns,columnHeadings,sortBy=['kind']}, {sourcePath,resolve,warnings=[]}) {
  const visible=filterWorldbuilding(graph,false);
  const nodes=new Map(visible.nodes.map(node=>[node.id,node]));
  const pages=new Map(snapshot.pages.map(page=>[page.path,page]));
  const paths=new Set();
  for(const {source,target} of visible.edges) {
    const other=source===sourcePath?target:target===sourcePath?source:undefined;
    if(types.includes(nodes.get(other)?.type))paths.add(other);
  }
  const context=createHeaderContext(snapshot,{date:graph.date});
  const at=context.dates.normalizeDate(graph.date);
  const fields=new Set([...indexTableColumns(types,columns),...sortBy]);
  const lookup=(value,source)=>{
    const ref=indexReference(value), file=ref && resolve(ref,source);
    return file && pages.get(file.path ?? file);
  };
  const rows=createIndexRows(context,at,{fields,lookup,kinds:types,
    whereabouts:(page,when)=>context.locations.getWhereabouts(page.metadata,when)});
  const messages=new Set([...graph.warnings,...warnings]);
  for(const path of paths)try {
    rows.add(pages.get(path));
  } catch(error) {
    if(!(error instanceof HeaderDataError))throw error;
    messages.add('Some pages were omitted because their relationship metadata contains a cycle.');
  }
  return {from:types,label:'Relationships',target:nodes.get(sourcePath)?.name,columns,columnHeadings,
    items:rows.sort(sortBy),warnings:[...messages]};
}
