import {Contexts} from './contexts.mjs';
import {CampaignSites} from './campaign-sites.mjs';
import {Navigation} from './navigation.mjs';
import {RenderEngine} from './render-engine.mjs';
import {hydrateHeaderSnapshot} from './header-core/snapshot.mjs';
import {RenderError} from './common.mjs';
import {ContentStore} from './content-store.mjs';
import {validInteractionIndex,validRuntimeManifest,assetPartition,validRuntimeDescriptor} from './runtime-format.mjs';
import {bucketText} from './runtime-io.mjs';
import {readSnapshotPart} from './snapshot-cache.mjs';
import {loadSnapshotValue} from './snapshot-loads.mjs';
import {snapshotCampaignSource} from './snapshot-campaigns.mjs';

const failure=()=>new RenderError(503,'Compiled content snapshot is missing or invalid');

export async function openSnapshot(bucket,revision,options={}) {
  if(!/^[a-f0-9]{64}$/.test(revision))throw failure();
  const text=await bucketText(bucket,'revisions/'+revision+'/runtime.json',options.timeoutMs);
  let manifest;
  try { manifest=JSON.parse(text); } catch { throw failure(); }
  if(!validRuntimeManifest(manifest,revision))throw failure();
  return new RuntimeSnapshot(bucket,manifest,options);
}

export class RuntimeSnapshot {
  constructor(bucket,index,options={}) {
    this.bucket=bucket;this.index=index;this.revision=index.revision;this.options=options;
    this.parts=new Map();this.cache=new Map();
    this.contexts=Contexts.hydrate(index.contexts,index.settings);
    this.campaignSites=CampaignSites.hydrate(index.sites);
  }

  async read(descriptor) {
    if(!validRuntimeDescriptor(descriptor))throw failure();
    return loadSnapshotValue(this.cache,descriptor.file,
      ()=>readSnapshotPart(this.bucket,this.revision,descriptor,this.options),16);
  }

  once(name,load) {
    return loadSnapshotValue(this.parts,name,load);
  }

  async getNote(entry,noteShards) {
    const descriptor=noteShards[entry.note.prepared];
    const shard=await this.read(descriptor),note=Object.hasOwn(shard,entry.id)?shard[entry.id]:null;
    if(!note || typeof note.body!=='string')throw failure();
    return {...note,metadata:entry.note.metadata};
  }

  searchStore() {
    return this.once('searchStore',async()=>{
      const entries=await this.read(this.index.parts.search);
      return {entries,bySlug:new Map(entries.map(entry=>[entry.slug,entry])),settings:this.index.settings,warnings:this.index.warnings};
    });
  }

  navigation(store,compiled) {
    return this.once('navigation',async()=>{
      [store,compiled]=await Promise.all([store || this.searchStore(),compiled || this.read(this.index.parts.navigation)]);
      return Navigation.hydrate(store,compiled);
    });
  }

  backlinkLoader(backlinks,store) {
    if(!Array.isArray(backlinks.shards) || backlinks.shards.some(value=>!validRuntimeDescriptor(value)) || !Array.isArray(backlinks.targets))throw failure();
    const page=id=>{
      if(!Number.isSafeInteger(id) || id<0 || !store.entries[id]?.note)throw failure();
      return store.entries[id];
    };
    const targets=new Map(backlinks.targets.map(([id,shard])=>{
      if(!Number.isSafeInteger(shard) || shard<0 || !backlinks.shards[shard])throw failure();
      return [page(id).slug,{id,descriptor:backlinks.shards[shard]}];
    }));
    const campaigns=new Map(backlinks.campaigns.map(([id,codes])=>[page(id).slug,codes]));
    const load=async entry=>{
      const target=targets.get(entry.slug);
      if(!target)return {version:2,byTarget:{}};
      const shard=await this.read(target.descriptor),rows=shard[target.id];
      if(!Array.isArray(rows))throw failure();
      const incoming=rows.map(([source,when])=>{
        if(!Array.isArray(when))throw failure();
        return {source:page(source).slug,when};
      });
      // Keep the selected target request-local. Concurrent requests must never
      // replace the shared engine's backlink index or reader context.
      return {version:2,byTarget:{[entry.slug]:incoming}};
    };
    return {campaigns,load};
  }

  renderer() {
    return this.once('renderer',async()=>{
      const [data,compiledHeaders,backlinks,compiledNavigation]=await Promise.all([
        this.read(this.index.parts.render),this.read(this.index.parts.headers),this.read(this.index.parts.backlinks),this.read(this.index.parts.navigation)]);
      if(!Array.isArray(data.noteShards) || data.noteShards.some(value=>!validRuntimeDescriptor(value)) ||
        data.entries.some(entry=>entry.note && (!Number.isSafeInteger(entry.note.prepared) || entry.note.prepared<0 || !data.noteShards[entry.note.prepared])))throw failure();
      if(!validInteractionIndex(data.interactions))throw failure();
      const store=new ContentStore(data.entries,this.index.warnings,this.index.settings,data.lookups);
      store.getNote=entry=>this.getNote(entry,data.noteShards);
      const navigation=await this.navigation(store,compiledNavigation);
      const compactBacklinks=this.backlinkLoader(backlinks,store);
      const headers=hydrateHeaderSnapshot(compiledHeaders,store.entries.filter(entry=>entry.note).map(entry=>({path:entry.id,metadata:entry.note.metadata})));
      const engine=new RenderEngine({settings:this.index.settings,store,headers,backlinkIndex:null,
        interactionIndex:data.interactions,campaignSource:snapshotCampaignSource(data.campaignRecords,descriptor=>this.read(descriptor)),
        prepared:{contexts:this.contexts,campaignSites:CampaignSites.hydrate(data.sites),navigation,home:data.home,
          backlinkCampaigns:compactBacklinks.campaigns,loadBacklinks:compactBacklinks.load}});
      engine.loadMapSources=()=>this.once('mapSources',async()=>{
        const sources=await this.read(this.index.parts.maps);
        if(!Array.isArray(sources) || sources.some(source=>typeof source.id!=='string' || typeof source.body!=='string'))throw failure();
        return sources;
      });
      return {engine,store,index:this.index};
    });
  }

  async forRequest(request) {
    const url=new URL(request.url);
    // Let the shared router return its normal method/URI error response without
    // loading route data first.
    let pathname='';
    try{if(['GET','HEAD'].includes(request.method))pathname=decodeURIComponent(url.pathname);}catch{}
    if(pathname==='/api/maps' || pathname==='/api/page' || pathname==='/api/index' || pathname==='/api/diagram-links' || pathname.startsWith('/page/') || pathname==='/' && !url.searchParams.has('q'))return this.renderer();
    let store={bySlug:{size:this.index.pages},warnings:this.index.warnings,assets:new Map(),settings:this.index.settings};
    const engine={settings:this.index.settings,contexts:this.contexts,campaignSites:this.campaignSites};
    if(pathname.startsWith('/assets/')){
      const target=pathname.slice(8),descriptor=this.index.assets[assetPartition(target)];
      if(descriptor){const entries=await this.read(descriptor);store.assets=new Map(entries.map(entry=>[entry.target,entry]));}
    }
    if(pathname==='/' || pathname.startsWith('/browse/') || pathname==='/api/navigation'){
      [store,engine.navigation]=await Promise.all([this.searchStore(),this.navigation()]);
    }else if(pathname==='/api/search')store=await this.searchStore();
    engine.store=store;
    return {engine,store,index:this.index};
  }
}
