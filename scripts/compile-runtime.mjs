import {ContentStore,compileAvailability,parseNote} from '../src/content-store.mjs';
import {Contexts} from '../src/contexts.mjs';
import {CampaignSites} from '../src/campaign-sites.mjs';
import {Navigation} from '../src/navigation.mjs';
import {buildBacklinkCampaigns} from '../src/backlinks.mjs';
import {compileHeaderIndexes} from '../src/header-core/snapshot.mjs';
import {compileSearchMetadata} from '../src/search-metadata.mjs';
import {leadingBioBlock,leadingHeaderMarker} from '../src/bio-block.mjs';
import {RUNTIME_VERSION,runtimeHash as hash,assetPartition} from '../src/runtime-format.mjs';


// Only immutable data is compiled here. HTML, generated biographies, Markdown
// rendering and reader-specific choices remain request-time work.
export function compileRuntime(index,sourceStore,{noteShardBytes=65536}={}) {
  const objects=new Map();
  const add=(file,value)=>{const json=JSON.stringify(value);objects.set(file,json);return {file,sha256:hash(json)};};
  const entries=index.entries.filter(entry=>!entry.generatedImageVariant && !entry.generatedMapTile).map(entry=>entry.note ?
    {...entry,availability:compileAvailability(entry),searchMetadata:compileSearchMetadata(entry),note:{metadata:entry.note.metadata}} : entry);
  const byId=new Map(entries.map(entry=>[entry.id,entry]));
  let shard={},bytes=2,ordinal=0;
  const flush=()=>{
    if(!Object.keys(shard).length)return;
    const descriptor=add('runtime/notes/'+String(ordinal++).padStart(4,'0')+'.json',shard);
    for(const id of Object.keys(shard))byId.get(id).note.prepared=descriptor;
    shard={};bytes=2;
  };
  for(const entry of sourceStore.bySlug.values()){
    const {body,source,metadata}=entry.note,bio=leadingBioBlock(body),marker=leadingHeaderMarker(body);
    const note={body,bio,headerMarkerEnd:marker?.[0].length || 0,
      ...(!bio && !marker && metadata.headerVersion && metadata.tags ? {source} : {})};
    const size=Buffer.byteLength(JSON.stringify([entry.id,note]));
    if(bytes+size>noteShardBytes)flush();
    Object.defineProperty(shard,entry.id,{value:note,enumerable:true,configurable:true});bytes+=size;
  }
  flush();
  const store=new ContentStore(entries,index.warnings,index.settings);
  const contexts=new Contexts(store,index.registry,index.settings),sites=new CampaignSites(index.campaignHomes,contexts);
  const presets=contexts.list().filter(context=>context.available && context.date);
  for(const site of sites.byHost.values())if(contexts.byId.get(site.contextId)?.available)presets.push(contexts.resolve(site.contextId,site.date,site.campaigns));
  const navigation=new Navigation(store,index.navigationSource);
  const compact=entries.filter(entry=>entry.note).map(({id,name,title,target,slug,extension,availability,searchMetadata,note})=>
    ({id,name,title,target,slug,extension,availability,searchMetadata,note:{metadata:{}}}));
  const search=add('runtime/search-metadata.json',compact);
  const nav=add('runtime/navigation.json',navigation.compile(presets));
  const headers=add('runtime/headers.json',compileHeaderIndexes({pages:entries.filter(entry=>entry.note).map(entry=>({path:entry.id,metadata:entry.note.metadata})),coreMeta:index.coreMeta,registry:index.registry}));
  const backlinks=add('runtime/backlinks.json',{index:index.backlinks,campaigns:[...buildBacklinkCampaigns(store,index.registry)]});
  const render=add('runtime/render.json',{entries,lookups:store.compileLookups(),home:index.homeSource==null?null:parseNote(index.homeSource),sites:sites.compile()});
  const partitions=new Map();
  for(const entry of index.entries.filter(entry=>!entry.note)){
    const key=assetPartition(entry.target),items=partitions.get(key) || [];
    items.push(entry);partitions.set(key,items);
  }
  const assets=Object.fromEntries([...partitions].sort(([a],[b])=>a.localeCompare(b)).map(([key,items])=>[key,add('runtime/assets/'+key+'.json',items)]));
  const manifest={version:RUNTIME_VERSION,settings:index.settings,sourceVersion:index.sourceVersion,search:index.search,
    pages:store.bySlug.size,warnings:index.warnings,contexts:contexts.compile(),sites:sites.compile().map(([host,{note,...site}])=>[host,site]),
    parts:{search,navigation:nav,headers,backlinks,render},assets};
  return {manifest,objects,digest:hash(JSON.stringify({manifest,objects:[...objects].map(([file,json])=>[file,hash(json)])}))};
}
