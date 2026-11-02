import {Component} from 'obsidian';
import {createHeaderSnapshot} from '../../../src/header-core/index.mjs';
import {Contexts} from '../../../src/contexts.mjs';

export async function readObsidianSnapshot(app) {
  const [coreMeta,registry] = await Promise.all([
    app.vault.adapter.read((app.vault.configDir || '.obsidian') + '/metadata.json'),
    app.vault.adapter.read('_scripts/session_note_campaigns.json'),
  ]).then(values => values.map(value=>JSON.parse(value)));
  const pages = app.vault.getMarkdownFiles().map(file => ({path:file.path,metadata:app.metadataCache.getFileCache(file)?.frontmatter || {}}));
  const runtime = createHeaderSnapshot({pages,coreMeta,registry},{
    resolveLink:target=>app.metadataCache.getFirstLinkpathDest(target,app.vault.getRoot().path)?.path,
  });
  const fallback = new Contexts({entries:pages.map(page=>({id:page.path,note:{metadata:page.metadata}}))},registry,{default_date:'1750-01-01'}).resolve().date;
  return {runtime,fallback};
}

// Plugin-owned metadata cache. Rendering features only subscribe and consume.
export class ObsidianSnapshotService extends Component {
  constructor(app){super();this.app=app;this.listeners=new Set();this.disposed=false;}
  onload(){
    const invalidate=()=>this.invalidate();
    for(const [target,names] of [[this.app.metadataCache,['changed','resolved']],[this.app.vault,['create','rename','delete']]])
      if(target?.on)for(const name of names)this.registerEvent(target.on(name,invalidate));
    if(this.app.vault.on)this.registerEvent(this.app.vault.on('modify',file=>{
      if(file?.path===(this.app.vault.configDir || '.obsidian')+'/metadata.json' || file?.path==='_scripts/session_note_campaigns.json')this.invalidate();
    }));
  }
  subscribe(listener){
    if(this.disposed)throw new Error('The Obsidian snapshot service has unloaded.');
    this.listeners.add(listener);return ()=>this.listeners.delete(listener);
  }
  invalidate(){
    if(this.disposed)return;
    this.pending=null;this.snapshot=null;clearTimeout(this.timer);
    this.timer=setTimeout(()=>{if(!this.disposed)for(const listener of this.listeners)listener();},100);
  }
  async getSnapshot(){
    if(this.disposed)throw new Error('The Obsidian snapshot service has unloaded.');
    if(!this.pending){
      const pending=readObsidianSnapshot(this.app);this.pending=pending;
      pending.catch(()=>{if(this.pending===pending)this.pending=null;});
    }
    const pending=this.pending,snapshot=await pending;
    if(this.disposed)throw new Error('The Obsidian snapshot service has unloaded.');
    if(this.pending!==pending)return this.getSnapshot();
    this.snapshot=snapshot;return snapshot;
  }
  onunload(){this.disposed=true;clearTimeout(this.timer);this.pending=null;this.snapshot=null;this.listeners.clear();}
}
