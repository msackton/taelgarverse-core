import {createHash} from 'node:crypto';
import {ContentStore,parseNote} from './content-store.mjs';
import {RenderError} from './common.mjs';
import {RenderEngine} from './render-engine.mjs';
import {createHeaderSnapshot,renderHeader,renderBio} from './header-core/index.mjs';

export class SnapshotStore extends ContentStore {
  constructor(index,bucket,lookups) {
    super(index.entries,index.warnings,index.settings,lookups);
    this.bucket=bucket;this.revision=index.revision;
    this.shards=new Map();this.pending=new Map();this.maxShards=8;
  }
  async getNote(entry) {
    return parseNote(await this.getText('notes',entry.id,entry.note));
  }
  async getTranscript(id,descriptor) {
    if (!descriptor || !/^[a-f0-9]{2}$/.test(descriptor.shard) || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new RenderError(503,'Transcript index is incomplete');
    return this.getText('transcripts',id,descriptor);
  }
  async getText(namespace,id,descriptor) {
    const key='revisions/'+this.revision+'/'+namespace+'/'+descriptor.shard+'.json';
    let shard=this.shards.get(key);
    if (shard) {this.shards.delete(key);this.shards.set(key,shard);}
    else {
      if (!this.pending.has(key)) this.pending.set(key,(async()=>{
        const object=await this.bucket.get(key);
        if (!object) throw new RenderError(503,'Content snapshot is incomplete');
        const value=await object.json();
        this.shards.set(key,value);
        while(this.shards.size>this.maxShards)this.shards.delete(this.shards.keys().next().value);
        return value;
      })().finally(()=>this.pending.delete(key)));
      shard=await this.pending.get(key);
    }
    const source=shard[id];
    if (typeof source!=='string' || createHash('sha256').update(source).digest('hex')!==descriptor.sha256) {
      throw new RenderError(503,'Content snapshot does not match its index');
    }
    return source;
  }
}

export async function loadSnapshot(bucket,revision) {
  if (!/^[a-f0-9]{64}$/.test(revision || '')) throw new RenderError(503,'No content revision has been published');
  const object=await bucket.get('revisions/'+revision+'/index.json');
  if (!object) throw new RenderError(503,'Content revision is not available');
  const index=await object.json();
  if (index.schemaVersion!==1 || index.revision!==revision) {
    throw new RenderError(503,'Content snapshot format is not supported by this Worker');
  }
  if (index.backlinks && ![1,2].includes(index.backlinks.version)) throw new RenderError(503,'Backlink index format is not supported by this Worker');
  if (index.interactions && (index.interactions.version!==2 || !index.interactions.byTarget || typeof index.interactions.byTarget!=='object' || Array.isArray(index.interactions.byTarget))) throw new RenderError(503,'Campaign interaction index format is not supported by this Worker');
  if (index.homeSource != null && typeof index.homeSource !== 'string') throw new RenderError(503,'Homepage content must be Markdown text');
  const store=new SnapshotStore(index,bucket);
  const headers=createHeaderSnapshot({pages:store.entries.filter(e=>e.note).map(e=>({path:e.id,metadata:e.note.metadata})),coreMeta:index.coreMeta,registry:index.registry});
  const engine=new RenderEngine({settings:index.settings,store,headers,renderHeader,renderBio,navigationSource:index.navigationSource,
    homeSource:index.homeSource ?? null,campaignHomes:index.campaignHomes,backlinkIndex:index.backlinks || null,interactionIndex:index.interactions,
    loadTranscript:id=>store.getTranscript(id,index.interactions?.transcripts?.[id])});
  return {engine,store,index};
}
