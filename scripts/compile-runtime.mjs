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
export function compileRuntime(index,sourceStore,{noteShardBytes=65536,backlinkShardBytes=32768}={}) {
  const objects=new Map();
  const add=(file,value)=>{const json=JSON.stringify(value);objects.set(file,json);return {file,sha256:hash(json)};};
  const entries=index.entries.filter(entry=>!entry.generatedImageVariant && !entry.generatedMapTile).map(entry=>entry.note ?
    {...entry,availability:compileAvailability(entry),note:{metadata:entry.note.metadata}} : entry);
  const byId=new Map(entries.map(entry=>[entry.id,entry]));
  const noteShards=[];
  let shard={},bytes=2,ordinal=0;
  const flush=()=>{
    if(!Object.keys(shard).length)return;
    const descriptor=add('runtime/notes/'+String(ordinal++).padStart(4,'0')+'.json',shard);
    for(const id of Object.keys(shard))byId.get(id).note.prepared=noteShards.length;
    noteShards.push(descriptor);
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
  const compact=entries.filter(entry=>entry.note).map(entry=>{
    const {id,name,title,target,slug,extension,availability}=entry;
    return {id,name,title,target,slug,extension,availability,searchMetadata:compileSearchMetadata(entry),note:{metadata:{}}};
  });
  const search=add('runtime/search-metadata.json',compact);
  const nav=add('runtime/navigation.json',navigation.compile(presets));
  const headers=add('runtime/headers.json',compileHeaderIndexes({pages:entries.filter(entry=>entry.note).map(entry=>({path:entry.id,metadata:entry.note.metadata})),coreMeta:index.coreMeta,registry:index.registry}));
  // IDs are positions in this revision's entry table, never public URL IDs.
  // Keep a target's references together so rendering needs at most one shard.
  const pageIds=new Map(entries.flatMap((entry,id)=>entry.note ? [[entry.slug,id]] : []));
  const backlinkShards=[],targets=[];
  let links={},linkBytes=2;
  const flushLinks=()=>{
    if(!Object.keys(links).length)return;
    backlinkShards.push(add('runtime/backlinks/'+String(backlinkShards.length).padStart(4,'0')+'.json',links));
    links={};linkBytes=2;
  };
  for(const [target,incoming] of Object.entries(index.backlinks.byTarget)){
    const id=pageIds.get(target),compactLinks=incoming.map(({source,when})=>{
      const sourceId=pageIds.get(source);
      if(sourceId===undefined)throw new Error('Unknown backlink source: '+source);
      return [sourceId,when];
    });
    if(id===undefined)throw new Error('Unknown backlink target: '+target);
    const size=Buffer.byteLength(JSON.stringify({[id]:compactLinks}));
    if(linkBytes+size>backlinkShardBytes)flushLinks();
    targets.push([id,backlinkShards.length]);links[id]=compactLinks;linkBytes+=size;
  }
  flushLinks();
  const backlinks=add('runtime/backlinks.json',{shards:backlinkShards,targets,
    campaigns:[...buildBacklinkCampaigns(store,index.registry)].map(([slug,campaigns])=>[pageIds.get(slug),campaigns])});
  const render=add('runtime/render.json',{entries,noteShards,lookups:store.compileLookups(),home:index.homeSource==null?null:parseNote(index.homeSource),sites:sites.compile()});
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
