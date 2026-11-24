import {parse} from 'yaml';
import {noteCampaignResolver} from './campaign-ownership.mjs';
import {dateKey} from './common.mjs';
import {eventISO,eventWindow} from './event-dates.mjs';
import {EVENT_SOURCE_VERSION,eligibleEventSource} from './event-sources.mjs';
import {createHeaderContext} from './header-core/index.mjs';

export const eventColumns=['Date','Event','File'];

const types=new Set(['person','power','place','event','object','group','ancestry','creature','session-note','story','source','background','meta']);
const typeAliases={item:'object',organization:'group','primary-source':'source'};
const selectorFields=new Set(['folder','note','type','knownTo','campaign']);
const blockFields=new Set(['yearStart','yearEnd','includeLifecycle','includeTravel','heading','show','sources','excludeSources']);
const mapping=value=>value && typeof value==='object' && !Array.isArray(value);
const list=value=>Array.isArray(value)?value:value==null?[]:[value];
const normalize=value=>String(value).trim().toLowerCase();

function sourceType(tags) {
  for(const value of list(tags).filter(value=>typeof value==='string').flatMap(value=>value.split(/[\s,]+/))) {
    const tag=normalize(value).replace(/^#/,'').split('/')[0];
    const type=Object.hasOwn(typeAliases,tag)?typeAliases[tag]:tag;
    if(types.has(type))return type;
  }
}

function sourceSelectors(value,key) {
  if(value===undefined)return undefined;
  if(!Array.isArray(value))throw new Error(key+' must be a list of selectors.');
  return value.map(rule=>{
    if(!mapping(rule) || !Object.keys(rule).length)throw new Error(key+' entries must be nonempty YAML mappings.');
    const result={};
    for(const [field,input] of Object.entries(rule)) {
      if(!selectorFields.has(field))throw new Error('Unknown event source option: '+field);
      if(typeof input!=='string' || !input.trim())throw new Error(field+' must be a nonempty string.');
      const value=input.trim();
      if(field==='folder') {
        const folder=value.replace(/\/$/,'');
        if(folder.split('/').some(part=>!part || part==='.' || part==='..') || folder.includes('\\'))
          throw new Error('folder must be a vault-relative path.');
        result.folder=folder;
      } else if(field==='type') {
        if(!types.has(value))throw new Error('Unknown event source type: '+value);
        result.type=value;
      } else result[field]=value;
    }
    return result;
  });
}

export function parseEvents(source) {
  const value=parse(source,{maxAliasCount:20});
  if(!mapping(value))throw new Error('Use YAML with a yearStart date.');
  for(const key of Object.keys(value))if(!blockFields.has(key))throw new Error('Unknown events option: '+key);
  for(const key of ['includeLifecycle','includeTravel','heading'])
    if(value[key]!==undefined && typeof value[key]!=='boolean')throw new Error(key+' must be true or false.');
  if(value.show!==undefined && !['obsidian','website','both'].includes(value.show))throw new Error('show must be obsidian, website, or both.');
  return {...eventWindow(value.yearStart,value.yearEnd),
    includeLifecycle:value.includeLifecycle ?? false,includeTravel:value.includeTravel ?? false,heading:value.heading ?? false,show:value.show ?? 'both',
    sources:sourceSelectors(value.sources,'sources'),excludeSources:sourceSelectors(value.excludeSources,'excludeSources') ?? []};
}

const byStart=(a,b)=>a.start-b.start;
export function createEventIndex(data) {
  if(data?.version!==EVENT_SOURCE_VERSION || !Array.isArray(data.notes))throw new Error('Event data format is unavailable.');
  const rows=data.notes.flatMap(([path,events])=>events.map((event,order)=>({...event,path,order}))).sort(byStart);
  const latestEnd=[];let end=0;
  for(const row of rows){end=Math.max(end,row.end);latestEnd.push(end);}
  return {rows,latestEnd,warnings:data.warnings ?? []};
}

function lowerBound(values,target) {
  let start=0,end=values.length;
  while(start<end) {
    const mid=Math.floor((start+end)/2);
    if(values[mid]<target)start=mid+1;
    else end=mid;
  }
  return start;
}

function eventSourceFilter(snapshot,options,{sourcePath,resolve,visible}) {
  const identities=noteCampaignResolver(snapshot.registry || {}).identities;
  const campaign=value=>identities.get(normalize(value));
  const compile=rule=>{
    const {folder,note,type,knownTo}=rule;
    const target=note && resolve(note.replace(/^\[\[|\]\]$/g,'').split(/[|#]/,1)[0].trim(),sourcePath);
    // A selectable note can be absent from a publication. That selector then
    // matches no sources, including when mixed with other explicit selectors.
    const known=knownTo && campaign(knownTo),owner=rule.campaign && campaign(rule.campaign);
    if(knownTo && !known)throw new Error('Unknown campaign for knownTo: '+knownTo);
    if(rule.campaign && !owner)throw new Error('Unknown campaign: '+rule.campaign);
    return (path,metadata)=>(!folder || path.startsWith(folder+'/')) && (!note || path===target) &&
      (!type || sourceType(metadata.tags)===type) &&
      (!known || list(metadata.knownTo).some(value=>campaign(value)===known)) &&
      (!owner || campaign(metadata.campaign)===owner);
  };
  const include=options.sources?.map(compile),exclude=options.excludeSources.map(compile);
  return (path,metadata)=>path!==sourcePath && eligibleEventSource(path) && visible(path) &&
    (!include || include.some(matches=>matches(path,metadata))) && !exclude.some(matches=>matches(path,metadata));
}

const snapshotPages=new WeakMap();
function pageIndex(snapshot) {
  if(!snapshotPages.has(snapshot))snapshotPages.set(snapshot,new Map(snapshot.pages.map(page=>[page.path,page])));
  return snapshotPages.get(snapshot);
}

function rowText(row,page,{names,locations}) {
  const {metadata,path}=page;
  if(row.kind==='inline') {
    const descriptor=metadata.timelineDescriptor ?? (metadata.type==='SessionNote'?metadata.campaign:metadata.name);
    return descriptor ? '*('+descriptor+')*: '+row.text : row.text;
  }
  const linked=(path,label)=>'[['+path+'|'+label+']]';
  let subject;
  try{subject=names.formatName({...names.getNameObject(path),linkTarget:path},'yt');}
  catch{subject=linked(path,metadata.name || page.name);}
  if(row.kind==='note')return metadata.summary?'*('+subject+')*: '+metadata.summary:subject;
  const locationName=target=>{
    try{return names.getName(target,'');}catch{return target;}
  };
  if(row.kind==='travel')return subject+' '+row.verb+' '+locationName(row.location);
  const display=names.getDisplayData(metadata),creation=row.kind==='start';
  const status=(creation?display.startStatus:display.endStatus) || (creation?metadata.born?'was born':'was created':metadata.died?'died':'ended');
  let place;
  try {
    const whereabouts=locations.getWhereabouts(metadata,eventISO(row.start));
    place=(creation?whereabouts.origin:whereabouts.lastKnown)?.location;
  } catch {
    // A malformed whereabouts entry does not prevent a lifecycle date.
  }
  return subject+' '+status+(place?' in '+locationName(place):'');
}

export function queryEvents(index,snapshot,options,{sourcePath,date,context=null,resolve,visible=()=>true}) {
  const pages=pageIndex(snapshot);
  const defaults=target=>pages.has(target)?target:pages.has(target+'.md')?target+'.md':snapshot.resolve?.(target)?.path;
  const matches=eventSourceFilter(snapshot,options,{sourcePath,resolve:resolve ?? defaults,visible});
  const ceiling=context?dateKey(context.date):Infinity,windowEnd=Math.min(options.end,ceiling);
  const campaigns=new Set(context?.campaigns ?? []);
  const condition=rule=>rule.campaign ? (rule.campaign==='none'?context.dm:campaigns.has(rule.campaign)) :
    rule.before ? ceiling<rule.before : ceiling>=rule.after;
  const accepted=new Map(),rows=[];
  if(windowEnd<options.start)return rows;
  for(let i=lowerBound(index.latestEnd,options.start);i<index.rows.length;i++) {
    const row=index.rows[i];
    if(row.start>windowEnd)break;
    if(row.end<options.start || row.end>ceiling || context && row.when && !row.when.every(condition))continue;
    if(row.kind==='travel' && !options.includeTravel || (row.kind==='start' || row.kind==='end') && !options.includeLifecycle)continue;
    const page=pages.get(row.path);
    if(!page)continue;
    if(!accepted.has(row.path))accepted.set(row.path,matches(row.path,page.metadata));
    if(accepted.get(row.path))rows.push(row);
  }
  rows.sort((a,b)=>a.sort-b.sort || a.path.localeCompare(b.path) || (a.line ?? 0)-(b.line ?? 0) || a.order-b.order);
  const services=createHeaderContext(snapshot,{date});
  return rows.map(row=>{
    const page=pages.get(row.path);
    return {...row,text:rowText(row,page,services).replace(/\s*\n\s*/g,' '),file:page.name};
  });
}
