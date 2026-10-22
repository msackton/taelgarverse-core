import {Contexts} from './contexts.mjs';
import {CampaignSites} from './campaign-sites.mjs';
import {Navigation} from './navigation.mjs';
import {RenderEngine} from './render-engine.mjs';
import {hydrateHeaderSnapshot} from './header-core/snapshot.mjs';
import {renderHeader,renderBio} from './header-core/index.mjs';
import {RenderError} from './common.mjs';
import {loadSnapshot,SnapshotStore} from './snapshot.mjs';
import {supportedRuntimeVersion,runtimeHash,assetPartition,validRuntimeDescriptor} from './runtime-format.mjs';

const failure=()=>new RenderError(503,'Compiled content snapshot is missing or invalid');

export async function openSnapshot(bucket,revision) {
  const object=await bucket.get('revisions/'+revision+'/runtime.json');
  if(!object){
    const legacy=await loadSnapshot(bucket,revision);
    return {forRequest:async()=>legacy};
  }
  const manifest=await object.json();
  if(!supportedRuntimeVersion(manifest.version) || manifest.revision!==revision || !manifest.parts || !manifest.assets ||
    !Number.isSafeInteger(manifest.pages) || !manifest.contexts || !Array.isArray(manifest.sites) ||
    ['search','navigation','headers','backlinks','render'].some(name=>!validRuntimeDescriptor(manifest.parts[name])) ||
    Object.values(manifest.assets).some(value=>!validRuntimeDescriptor(value)))throw failure();
  return new RuntimeSnapshot(bucket,manifest);
}

export class RuntimeSnapshot {
  constructor(bucket,index) {
    this.bucket=bucket;this.index=index;this.revision=index.revision;
    this.parts=new Map();this.cache=new Map();this.pending=new Map();
    this.contexts=Contexts.hydrate(index.contexts,index.settings);
    this.campaignSites=CampaignSites.hydrate(index.sites);
  }

  async read(descriptor) {
    if(!validRuntimeDescriptor(descriptor))throw failure();
    const key=descriptor.file;
    if(this.cache.has(key)){const value=this.cache.get(key);this.cache.delete(key);this.cache.set(key,value);return value;}
    if(!this.pending.has(key))this.pending.set(key,(async()=>{
      const object=await this.bucket.get('revisions/'+this.revision+'/'+key);
      if(!object)throw failure();
      const text=object.text ? await object.text() : JSON.stringify(await object.json());
      if(runtimeHash(text)!==descriptor.sha256)throw failure();
      const value=JSON.parse(text);
      this.cache.set(key,value);
      while(this.cache.size>16)this.cache.delete(this.cache.keys().next().value);
      return value;
    })().finally(()=>this.pending.delete(key)));
    return this.pending.get(key);
  }

  once(name,load) {
    if(!this.parts.has(name))this.parts.set(name,Promise.resolve().then(load).catch(error=>{this.parts.delete(name);throw error;}));
    return this.parts.get(name);
  }

  async getNote(entry,noteShards) {
    const descriptor=this.index.version===1 ? entry.note.prepared : noteShards?.[entry.note.prepared];
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
      if(this.index.version===2 && (!Array.isArray(data.noteShards) || data.noteShards.some(value=>!validRuntimeDescriptor(value)) ||
        data.entries.some(entry=>entry.note && (!Number.isSafeInteger(entry.note.prepared) || entry.note.prepared<0 || !data.noteShards[entry.note.prepared]))))throw failure();
      if(data.interactions && (data.interactions.version!==2 || !data.interactions.byTarget || typeof data.interactions.byTarget!=='object' || Array.isArray(data.interactions.byTarget)))throw failure();
      const store=new SnapshotStore({entries:data.entries,warnings:this.index.warnings,settings:this.index.settings,revision:this.revision},this.bucket,data.lookups);
      store.getNote=entry=>this.getNote(entry,data.noteShards);
      const navigation=await this.navigation(store,compiledNavigation);
      const compactBacklinks=this.index.version===2 ? this.backlinkLoader(backlinks,store) : null;
      const headers=hydrateHeaderSnapshot(compiledHeaders,store.entries.filter(entry=>entry.note).map(entry=>({path:entry.id,metadata:entry.note.metadata})));
      const engine=new RenderEngine({settings:this.index.settings,store,headers,renderHeader,renderBio,backlinkIndex:compactBacklinks ? null : backlinks.index,
        interactionIndex:data.interactions,loadTranscript:id=>store.getTranscript(id,data.interactions?.transcripts?.[id]),
        prepared:{contexts:this.contexts,campaignSites:CampaignSites.hydrate(data.sites),navigation,home:data.home,
          backlinkCampaigns:compactBacklinks?.campaigns || new Map(backlinks.campaigns),loadBacklinks:compactBacklinks?.load}});
      return {engine,store,index:this.index};
    });
  }

  async forRequest(request) {
    const url=new URL(request.url);
    // Let the shared router return its normal method/URI error response without
    // loading route data first.
    let pathname='';
    try{if(['GET','HEAD'].includes(request.method))pathname=decodeURIComponent(url.pathname);}catch{}
    if(pathname==='/api/page' || pathname==='/api/index' || pathname==='/api/diagram-links' || pathname.startsWith('/page/') || pathname.startsWith('/campaign-transcripts/') || pathname==='/' && !url.searchParams.has('q'))return this.renderer();
    let store={bySlug:{size:this.index.pages},warnings:this.index.warnings,assets:new Map(),settings:this.index.settings};
    const engine={settings:this.index.settings,contexts:this.contexts,campaignSites:this.campaignSites};
    if(pathname.startsWith('/assets/')){
      const target=pathname.slice(8),descriptor=this.index.assets[assetPartition(target)];
      if(descriptor){const entries=await this.read(descriptor);store.assets=new Map(entries.map(entry=>[entry.target,entry]));}
    }
    if(pathname==='/api/search' || pathname==='/' || pathname.startsWith('/browse/') || pathname==='/api/navigation')store=await this.searchStore();
    if(pathname==='/' || pathname.startsWith('/browse/') || pathname==='/api/navigation')engine.navigation=await this.navigation();
    engine.store=store;
    return {engine,store,index:this.index};
  }
}
