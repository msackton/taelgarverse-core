import {Component} from 'obsidian';
import {parseNote} from '../../../src/content-store.mjs';
import {createEventIndex,queryEvents} from '../../../src/events.mjs';
import {eligibleEventSource,EVENT_SOURCE_VERSION,extractEventSource} from '../../../src/event-sources.mjs';

export class ObsidianEventService extends Component {
  constructor(app) {
    super();
    this.app=app;
    this.records=new Map();
    this.listeners=new Set();
  }

  onload() {
    const vault=this.app.vault;
    if(!vault.on)return;
    for(const name of ['create','modify','delete','rename'])this.registerEvent(vault.on(name,(file,oldPath)=>{
      if(file?.path)this.invalidate(file.path,oldPath);
    }));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return ()=>this.listeners.delete(listener);
  }

  invalidate(path,oldPath) {
    const paths=[path,oldPath].filter(Boolean);
    const inScope=value=>paths.some(path=>value===path || value.startsWith(path+'/'));
    let changed=paths.some(path=>/\.md$/i.test(path) && eligibleEventSource(path));
    for(const cached of this.records.keys())if(inScope(cached)) {
      this.records.delete(cached);
      changed=true;
    }
    if(!changed)return;
    this.pending=null;
    clearTimeout(this.timer);
    if(this.listeners.size)this.timer=setTimeout(()=>{for(const listener of this.listeners)listener();},80);
  }

  read(file) {
    const path=file.path;
    if(!this.records.has(path))this.records.set(path,(async()=>{
      try{return extractEventSource(path,parseNote(await this.app.vault.cachedRead(file)));}
      catch(error){return {rows:[],warnings:[path+': '+error.message]};}
    })());
    return this.records.get(path);
  }

  async build() {
    const files=this.app.vault.getMarkdownFiles().filter(file=>eligibleEventSource(file.path));
    const notes=[],warnings=[];
    for(let start=0;start<files.length && !this.disposed;start+=32) {
      const records=await Promise.all(files.slice(start,start+32).map(async file=>[file.path,await this.read(file)]));
      for(const [path,record] of records) {
        if(record.rows.length)notes.push([path,record.rows]);
        warnings.push(...record.warnings);
      }
    }
    return createEventIndex({version:EVENT_SOURCE_VERSION,notes,warnings});
  }

  async getIndex() {
    while(!this.disposed) {
      const pending=this.pending ??= this.build();
      try {
        const index=await pending;
        if(!this.disposed && this.pending===pending)return index;
      } catch(error) {
        if(this.pending!==pending)continue;
        this.pending=null;
        throw error;
      }
    }
    throw new Error('The Obsidian event service has unloaded.');
  }

  onunload() {
    this.disposed=true;
    clearTimeout(this.timer);
    this.records.clear();
    this.listeners.clear();
    this.pending=null;
  }
}

export function obsidianEvents(app,index,snapshot,options,sourcePath,{date=snapshot.fallback,context,visible}={}) {
  return queryEvents(index,snapshot.runtime,options,{sourcePath,date,context,visible,
    resolve:(target,source)=>app.metadataCache.getFirstLinkpathDest(target,source)?.path});
}
