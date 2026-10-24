import {createHeaderContext,HeaderDataError} from './header-core/index.mjs';
import {getPageType} from './header-core/metadata.mjs';
import {parseDRDate,drDateString} from './campaign-calendar.mjs';
import {resolveIndex,EMPTY_INDEX_REGISTRY,validateHeaderIndexIds} from './index-registry.mjs';
import {indexConditions,metadataValues,matchIndexField} from './index-fields.mjs';
import {evaluateIndexColumn,compareIndexValues,cardPositions} from './index-columns.mjs';
export {parseIndex} from './index-registry.mjs';

const reference=value=>typeof value==='string'?value.trim().replace(/^\[\[|\]\]$/g,'').split('|')[0].split('#')[0]:'';
const compareNames=new Intl.Collator('en',{sensitivity:'base',numeric:true}).compare;
const comparePaths=new Intl.Collator('en').compare;
const snapshots=new WeakMap();
function pagesFor(snapshot) {
  let pages=snapshots.get(snapshot);
  if(!pages){pages=new Map(snapshot.pages.map(page=>[page.path,page]));snapshots.set(snapshot,pages);}
  return pages;
}

function evaluation(snapshot,{date,sourcePath,resolve,visible=()=>true}={}) {
  const {dates,names,locations,templates}=createHeaderContext(snapshot,{date});
  // Index intervals use the full recorded period, independent of YAML quoting.
  const normalize=dates.normalizeDate.bind(dates);
  dates.normalizeDate=(value,end=false)=>{
    const result=normalize(value,end);
    if(!result || value?.isNormalizedDate || typeof value!=='string' && typeof value!=='number')return result;
    let period;try{period=parseDRDate(value);}catch{return result;}
    const first=normalize(drDateString(period.start)),boundary=normalize(drDateString(end?period.endExclusive-1:period.start));
    return {...result,sort:boundary.sort,days:boundary.days,indexSort:first.sort};
  };
  const at=dates.normalizeDate(date) || dates.getTargetDateForPage();
  const pages=pagesFor(snapshot),resolved=new Map(),whereabouts=new WeakMap(),lifetimes=new WeakMap();
  const lookup=(value,source=sourcePath)=>{
    const target=reference(value);if(!target)return;
    const key=JSON.stringify([source,target]);
    if(!resolved.has(key)) {
      const file=resolve?resolve(target,source):names.getFileForTarget(target);
      resolved.set(key,file && (pages.get(file.path)||file));
    }
    return resolved.get(key);
  };
  const homeFor=page=>{
    if(!whereabouts.has(page))whereabouts.set(page,locations.getWhereabouts(page.metadata,at));
    return whereabouts.get(page);
  };
  const lifeFor=page=>{
    if(!lifetimes.has(page))lifetimes.set(page,dates.getPageDates(page.metadata,at));
    return lifetimes.get(page);
  };
  const nameFor=page=>names.getNameObject(page.path).name || page.name;
  const linkValue=(target,source,alias)=>{
    const page=lookup(target,source);
    if(page && !visible(page))return;
    if(!target)return;
    return {path:page?.path,name:alias || (page?nameFor(page):reference(target))};
  };
  const regionFor=page=>{
    // Start ABOVE the immediate home, even when that home is itself a realm.
    let parent=lookup(homeFor(page).home.location,page.path);
    const visited=new Set([page.path]);
    if(parent){visited.add(parent.path);parent=lookup(homeFor(parent).home.location,parent.path);}
    while(parent) {
      if(visited.has(parent.path) || visited.size>128)throw new HeaderDataError('home',[...visited,parent.path]);
      visited.add(parent.path);
      if(['realm','region'].includes(String(parent.metadata.typeOf).toLowerCase()))return visible(parent)?{path:parent.path,name:nameFor(parent)}:undefined;
      parent=lookup(homeFor(parent).home.location,parent.path);
    }
    return linkValue('Taelgar',page.path,'Taelgar');
  };
  const valuesFor=(page,field,roles=[])=>{
    const [namespace,...parts]=field.split('.'),key=parts[0],metadata=page.metadata;
    if(namespace==='metadata')return metadataValues(metadata,parts);
    if(namespace==='page') {
      if(key==='name')return [{path:page.path,name:nameFor(page),pronunciation:metadata.pronunciation}];
      if(key==='path')return [page.path];
      if(key==='kind')return [getPageType(metadata)];
      if(key==='tags')return metadataValues(metadata,['tags']).filter(value=>typeof value==='string').map(value=>value.replace(/^#/,''));
      if(key==='mainType')return [templates.formatDisplayString('<maintype:n>',{name:page.name,frontmatter:metadata},at)];
    }
    if(namespace==='life') {
      const life=lifeFor(page);
      return key==='exists'?[life.isCreated]:key==='active'?[life.isCreated && life.isAlive]:[life[key==='start'?'startDate':'endDate']];
    }
    if(namespace==='location') {
      if(key==='region')return [regionFor(page)].filter(Boolean);
      const where=homeFor(page)[key];return [linkValue(where?.location,page.path,where?.alias)].filter(Boolean);
    }
    if(namespace==='membership')return roles.map(role=>key==='org'?linkValue(role.org,page.path):key==='end' && role.status!=='former'?undefined:role[key]).filter(value=>value!==undefined);
    return [];
  };
  const filterValues=(page,field)=>field==='page.name'?[nameFor(page)]:valuesFor(page,field);
  const formattedParts=(text,source)=>{
    const parts=[];let end=0;
    for(const match of text.matchAll(/\[\[([^\[\]\n]+)\]\]/g)) {
      if(match.index>end)parts.push(text.slice(end,match.index));
      const [target,...alias]=match[1].split('|'),page=lookup(target,source),name=alias.length?alias.join('|'):target;
      parts.push(page?visible(page)?{path:page.path,name}:'Unknown':name);
      end=match.index+match[0].length;
    }
    if(end<text.length)parts.push(text.slice(end));return parts;
  };
  const linkParts=(value,source)=>value.includes('[[')?formattedParts(value,source):[linkValue(value,source) || 'Unknown'];
  const memberships=page=>{
    const result=[];
    for(const [raw,leader] of [[page.metadata.leaderOf,true],[page.metadata.affiliations,false]]) {
      for(const item of Array.isArray(raw)?raw:raw?[raw]:[]) {
        const value=typeof item==='string'?{org:item}:item;
        if(!value || typeof value!=='object')continue;
        const org=value.org || (leader?value.place:undefined);if(!org)continue;
        const start=dates.normalizeDate(value.start ?? (leader?page.metadata.reignStart:undefined),false);
        const end=dates.normalizeDate(value.end,true);
        if(start && start.sort>at.sort)continue;
        const status=end && end.sort<at.sort?'former':'current';
        result.push({org,title:value.title || (leader?page.metadata.title:undefined) || value.type || (leader?'leader':'member'),start,end,status});
      }
    }
    return result;
  };
  return {dates,templates,at,lookup,homeFor,valuesFor,filterValues,formattedParts,linkParts,memberships,nameFor,visible,pages};
}

export function headerIndexesForMetadata(metadata={},registry=EMPTY_INDEX_REGISTRY,context={}) {
  if(metadata.indexes!==undefined)return validateHeaderIndexIds(metadata.indexes,registry);
  const page={path:context.sourcePath || '',name:context.sourcePath?.split('/').at(-1)?.replace(/\.md$/,'') || '',metadata};
  if(!Object.keys(registry.headerRules || {}).length)return [];
  const env=context.snapshot?evaluation(context.snapshot,context):undefined;
  const values=field=>env?env.filterValues(page,field):field.startsWith('metadata.')?metadataValues(metadata,field.split('.').slice(1)):
    field==='page.kind'?[getPageType(metadata)]:field==='page.tags'?metadataValues(metadata,['tags']).filter(value=>typeof value==='string').map(value=>value.replace(/^#/,'')):field==='page.path'?[page.path]:field==='page.name'?[metadata.name || page.name]:[];
  const selected=[];
  for(const rule of Object.values(registry.headerRules || {}))if(rule.enabled!==false && indexConditions(rule.when).every(condition=>matchIndexField(condition,values(condition.field))))selected.push(...rule.indexes);
  return [...new Set(selected)];
}
export const headerIndexes=validateHeaderIndexIds;
export function queryIndex(snapshot,invocation,context={}) {return runQuery(snapshot,invocation,context,false);}
export function indexHasResults(snapshot,invocation,context={}) {return runQuery(snapshot,invocation,context,true);}
function runQuery(snapshot,invocation,context,firstOnly) {
  const options=resolveIndex(context.indexRegistry,invocation,{host:context.host || 'website'});
  const empty={index:options.index,label:options.label,target:'',items:[],warnings:[],columns:options.columns,cards:options.cards,options};
  if(!options.enabled)return firstOnly?false:empty;
  const env=evaluation(snapshot,context),{lookup,visible,homeFor,at}=env;
  const conditions=indexConditions(options.where),relation=conditions.find(condition=>condition.relation);
  const source=env.pages.get(context.sourcePath);
  const targetReference=options.target===undefined || options.target==='$source'?source?.path:options.target;
  if(targetReference==='$target')throw new Error('An index target cannot refer to itself with $target.');
  const target=targetReference?lookup(targetReference):source;
  const relationReference=relation?.[relation.relation==='affiliation'?'target':'within'];
  const within=relation?(relationReference==='$source'?source:relationReference==='$target'?target:lookup(relationReference)):undefined;
  if(relation && (!within || !visible(within)))throw new Error('The index relationship target is unavailable.');
  if(relation && getPageType(within.metadata)!==(relation.relation==='affiliation'?'group':'place'))throw new Error('The relationship requires a '+(relation.relation==='affiliation'?'group':'place')+' target.');
  if(relation?.relation==='watershed' && String(within.metadata.typeOf).toLowerCase()!=='watershed')throw new Error('The watershed target must have typeOf: watershed.');
  if(options.target && (!target || !visible(target)))throw new Error('The index target is unavailable.');
  const inOrganization=(org,path)=>{
    const seen=new Set();
    while(org) {
      const page=lookup(org,path);if(!page)return false;
      if(page.path===within.path)return true;
      if(!relation.recursive || getPageType(page.metadata)!=='group')return false;
      if(seen.has(page.path) || seen.size>128)throw new HeaderDataError('organization',[...seen,page.path]);
      seen.add(page.path);org=page.metadata.partOf;path=page.path;
    }
    return false;
  };
  const inHome=page=>{
    let cycle;const settled=new Map();
    const visit=(value,path,seen=[])=>{
      const parent=lookup(value,path);if(!parent)return false;
      if(parent.path===within.path)return true;
      if(!relation.recursive)return false;
      if(seen.includes(parent.path) || seen.length>128){cycle=[...seen,parent.path];return false;}
      if(settled.has(parent.path))return settled.get(parent.path);
      const where=homeFor(parent),next=[...seen,parent.path];
      const matched=visit(where.home.location,parent.path,next) || relation.relation==='watershed' && visit(where.secondary.location,parent.path,next);
      settled.set(parent.path,Boolean(matched));return matched;
    };
    const where=homeFor(page),matched=visit(where.home.location,page.path,[page.path]) || relation.relation==='watershed' && visit(where.secondary.location,page.path,[page.path]);
    if(!matched && cycle)throw new HeaderDataError('home',cycle);return matched;
  };
  const items=[],warnings=new Set(),predicates=conditions.filter(condition=>!condition.relation);
  for(const page of snapshot.pages) {
    if(!visible(page) || relation && page.path===within.path)continue;
    try {
      if(!predicates.every(condition=>matchIndexField(condition,env.filterValues(page,condition.field))))continue;
      let roles=[];
      if(relation?.relation==='affiliation') {
        roles=env.memberships(page).filter(role=>role.status===(relation.state || 'current') && inOrganization(role.org,page.path));
        if(!roles.length)continue;
        roles.sort((a,b)=>(a.start?.sort || 0)-(b.start?.sort || 0) || (a.end?.sort || Infinity)-(b.end?.sort || Infinity) || compareNames(a.title,b.title));
      }else if(relation && !inHome(page))continue;
      if(firstOnly)return true;
      const item={path:page.path,name:env.nameFor(page),imageTarget:page.metadata.image};
      const display={...env,row:item};
      item.cells=options.columns.map(column=>evaluateIndexColumn(column,page,roles,display).parts);
      item.card=Object.fromEntries(cardPositions.map(position=>[position,options.cards[position].map(column=>evaluateIndexColumn(column,page,roles,display).parts)]));
      if(!item.card.title.some(parts=>parts.some(part=>typeof part!=='string' || part.trim())))item.card.title=[[{path:item.path,name:item.name}]];
      item.sortValues=options.sort.map(column=>evaluateIndexColumn(column,page,roles,display).sort);
      items.push(item);
    }catch(error) {
      if(!(error instanceof HeaderDataError))throw error;
      warnings.add('Some pages were omitted because their relationship metadata contains a cycle.');
    }
  }
  if(firstOnly)return false;
  items.sort((a,b)=>options.sort.reduce((compared,column,i)=>compared || compareIndexValues(a.sortValues[i],b.sortValues[i],column.direction),0) || compareNames(a.name,b.name) || comparePaths(a.path,b.path));
  for(const item of items)delete item.sortValues;
  return {...empty,target:target?env.nameFor(target):within?env.nameFor(within):'',items,warnings:[...warnings]};
}
