import {Component,MarkdownRenderChild,MarkdownRenderer} from 'obsidian';
import {createHeaderSnapshot,renderBio} from '../../../src/header-core/index.mjs';
import {Contexts} from '../../../src/contexts.mjs';
import {escapeHtml} from '../../../src/common.mjs';
import {headerIndexesForMetadata,parseIndex,queryIndex,indexHasResults,indexLabels} from '../../../src/indexes.mjs';
import {indexView,indexPopup,indexPopupShell,indexError} from '../../../src/index-view.mjs';
import {indexImageTarget} from '../../../src/index-images.mjs';
import {IMAGE_TYPES,parseNote} from '../../../src/content-store.mjs';
import {firstDescriptionSentence} from '../../../src/index-description.mjs';
import {mountIndexPopups} from '../../../src/browser/index-popups.mjs';

export function bioDate(metadata, globals, fallback) {
  if (globals.customJS?.state?.overrideDate) return globals.customJS.state.overrideDate;
  if (metadata.pageTargetDate) return metadata.pageTargetDate;
  const fantasy = globals.FantasyCalendarAPI?.getCalendars()?.[0]?.current;
  if (fantasy) return fantasy;
  try { return globals.Calendarium?.getAPI('Taelgar')?.getCurrentDate() ?? fallback; }
  catch { return fallback; }
}

export async function obsidianHeaders(app) {
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

export function obsidianBio(snapshot,file,metadata,globals=globalThis) {
  return renderBio(snapshot.runtime,{name:file.basename,
    metadata,date:bioDate(metadata,globals,snapshot.fallback),headerType:'static'});
}

// Metadata changes replace the runtime snapshot, dropping its cached queries.
// This author-only cache never serves website requests or crosses date/source views.
const indexSnapshots=new WeakMap();
const MAX_INDEX_QUERIES=32;
function indexState(snapshot) {
  let state=indexSnapshots.get(snapshot.runtime);
  if(!state) {
    state={pages:new Map(snapshot.runtime.pages.map(page=>[page.path,page])),queries:new Map()};
    indexSnapshots.set(snapshot.runtime,state);
  }
  return state;
}
const indexKey=(options,sourcePath,date)=>JSON.stringify([sourcePath,options.type,options.target,options.recursive ?? options.type!=='members',date]);
const indexContext=(app,state,sourcePath,date)=>({date,sourcePath,resolve:(target,source)=>{
  const file=app.metadataCache.getFirstLinkpathDest(target,source);
  return file && state.pages.get(file.path);
}});
export function obsidianIndexExists(app,snapshot,options,sourcePath,date) {
  const state=indexState(snapshot),cached=state.queries.get(indexKey(options,sourcePath,date));
  return cached ? cached.items.length>0 : indexHasResults(snapshot.runtime,options,indexContext(app,state,sourcePath,date));
}
export function obsidianIndex(app,snapshot,options,sourcePath,date) {
  const state=indexState(snapshot),key=indexKey(options,sourcePath,date);
  let result=state.queries.get(key);
  if(result)state.queries.delete(key);
  else result=queryIndex(snapshot.runtime,options,indexContext(app,state,sourcePath,date));
  state.queries.set(key,result);
  if(state.queries.size>MAX_INDEX_QUERIES)state.queries.delete(state.queries.keys().next().value);
  // Image URLs and other host additions belong to this render, not the cache.
  return structuredClone(result);
}

async function indexMarkup(feature,snapshot,options,sourcePath,date,{popup=false,heading=false}={}) {
  const result=obsidianIndex(feature.app,snapshot,options,sourcePath,date);
  if(options.type==='members' && (popup || options.mode!=='table'))await Promise.all(result.items.map(async item=>{
    const file=feature.app.vault.getAbstractFileByPath(item.path);
    if(file)item.firstSentence=firstDescriptionSentence(parseNote(await feature.app.vault.cachedRead(file)),{date,source:item.path});
  }));
  if(popup || options.mode!=='table')for(const item of result.items) {
    const target=indexImageTarget(item.imageTarget);
    const file=target && feature.app.metadataCache.getFirstLinkpathDest(target,item.path);
    if(file && IMAGE_TYPES.has('.'+file.path.split('.').at(-1).toLowerCase()))item.image=feature.app.vault.getResourcePath(file);
  }
  const link=item=>item.path ? '<a class="internal-link taelgar-index-link" data-href="'+escapeHtml(item.path)+'" href="'+escapeHtml(item.path)+'">'+escapeHtml(item.name)+'</a>' : escapeHtml(item.name);
  return popup ? indexPopup(result,link) : indexView(result,link,options.mode,{heading});
}

function mountIndexes(root,app,sourcePath,options={}) {
  const disposePopup=mountIndexPopups(root,options),disposers=[];
  // Delegation also covers links inserted by a lazy load after mounting.
  for(const container of [root,...root.querySelectorAll('.taelgar-index-panel')]) {
    const open=event=>{
      const link=event.target.closest?.('.taelgar-index-link');
      if(event.button!==0 || !link || !container.contains(link))return;
      event.preventDefault();event.stopPropagation();
      app.workspace.openLinkText(link.dataset.href,sourcePath,!!(event.ctrlKey || event.metaKey || event.shiftKey));
    };
    container.addEventListener('click',open);disposers.push(()=>container.removeEventListener('click',open));
  }
  return ()=>{disposePopup();for(const dispose of disposers)dispose();};
}

function headerIndexMarkup(feature,snapshot,metadata,sourcePath,date) {
  try{return headerIndexesForMetadata(metadata).filter(type=>obsidianIndexExists(feature.app,snapshot,{type},sourcePath,date))
    .map(type=>indexPopupShell({type,label:indexLabels[type],target:metadata.name || sourcePath.split('/').at(-1).replace(/\.md$/,'')})).join('');}
  catch(error){return indexError(error);}
}

class BioChild extends MarkdownRenderChild {
  constructor(feature,source,container,context) {
    super(container);this.feature=feature;this.source=source;this.context=context;this.sequence=0;this.disposed=false;
  }
  onload() {
    this.feature.bios.add(this);
    this.timer=setInterval(()=>{
      const file=this.feature.app.vault.getAbstractFileByPath(this.context.sourcePath);
      if(!file)return;
      const metadata=this.feature.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const date=JSON.stringify(bioDate(metadata,globalThis,this.feature.snapshot?.fallback));
      if(date!==this.date)this.render();
    },2000);
    return this.render();
  }
  async render() {
    const sequence=++this.sequence,element=this.containerEl,app=this.feature.app;
    let rendering;
    try {
      if(this.source.trim())throw new Error('Leave the taelgar-header block empty; its values come from frontmatter.');
      const snapshot=await this.feature.getSnapshot();
      if(this.disposed || sequence!==this.sequence)return;
      const file=app.vault.getAbstractFileByPath(this.context.sourcePath);
      if(!file)throw new Error('The source note is no longer available.');
      const metadata=app.metadataCache.getFileCache(file)?.frontmatter || {};
      this.date=JSON.stringify(bioDate(metadata,globalThis,snapshot.fallback));
      const markdown=obsidianBio(snapshot,file,metadata);
      // Render offscreen so a stale async render cannot replace a newer header.
      const output=element.ownerDocument.createElement('div');
      output.className='taelgar-generated-bio'+(metadata.pronunciation ? ' taelgar-bio taelgar-bio--pronunciation' : '');
      rendering=this.addChild(new Component());
      await MarkdownRenderer.render(app,markdown,output,this.context.sourcePath,rendering);
      if(this.disposed || sequence!==this.sequence){this.removeChild(rendering);return;}
      let disposeIndexes;
      const indexButtons=this.feature.headerIndexPopups ? headerIndexMarkup(this.feature,snapshot,metadata,this.context.sourcePath,bioDate(metadata,globalThis,snapshot.fallback)) : '';
      if(indexButtons) {
        const buttons=element.ownerDocument.createElement('div');buttons.className='taelgar-index-buttons';
        buttons.innerHTML=indexButtons;
        if(buttons.innerHTML) {
          output.append(buttons);
          disposeIndexes=mountIndexes(buttons,app,this.context.sourcePath,{load:async details=>{
            const current=await this.feature.getSnapshot();
            const currentFile=app.vault.getAbstractFileByPath(this.context.sourcePath);
            if(!currentFile)throw new Error('Index target unavailable');
            const currentMetadata=app.metadataCache.getFileCache(currentFile)?.frontmatter || {};
            return indexMarkup(this.feature,current,{type:details.dataset.indexType},this.context.sourcePath,bioDate(currentMetadata,globalThis,current.fallback));
          }});
        }
      }
      this.disposeIndexes?.();this.disposeIndexes=disposeIndexes;
      if(this.rendered)this.removeChild(this.rendered);
      this.rendered=rendering;element.replaceChildren(output);
    } catch(error) {
      if(rendering)this.removeChild(rendering);
      if(this.disposed || sequence!==this.sequence)return;
      if(this.rendered){this.removeChild(this.rendered);this.rendered=null;}
      this.disposeIndexes?.();this.disposeIndexes=null;
      element.textContent='Bio unavailable: '+error.message;
    }
  }
  onunload() {this.disposed=true;this.sequence++;clearInterval(this.timer);this.disposeIndexes?.();this.feature.bios.delete(this);}
}

class IndexChild extends BioChild {
  onload() {this.containerEl.classList.add('taelgar-index-host');return super.onload();}
  async render() {
    const sequence=++this.sequence,element=this.containerEl;
    try {
      const options=parseIndex(this.source);
      if(options?.show==='website') {
        this.disposeIndexes?.();this.disposeIndexes=null;element.replaceChildren();element.hidden=true;return;
      }
      const snapshot=await this.feature.getSnapshot();
      if(this.disposed || sequence!==this.sequence)return;
      const metadata=this.feature.app.metadataCache.getFileCache(this.feature.app.vault.getAbstractFileByPath(this.context.sourcePath))?.frontmatter || {};
      const date=bioDate(metadata,globalThis,snapshot.fallback);this.date=JSON.stringify(date);
      const html=await indexMarkup(this.feature,snapshot,options,this.context.sourcePath,date,{heading:true});
      if(this.disposed || sequence!==this.sequence)return;
      this.disposeIndexes?.();element.hidden=false;element.innerHTML=html;
      this.disposeIndexes=mountIndexes(element,this.feature.app,this.context.sourcePath);
    }catch(error){
      if(this.disposed || sequence!==this.sequence)return;
      this.disposeIndexes?.();this.disposeIndexes=null;element.hidden=false;element.innerHTML=indexError(error);
    }
  }
}

export class HeadersFeature extends Component {
  constructor(plugin) {super();this.plugin=plugin;this.app=plugin.app;this.bios=new Set();this.disposed=false;this.headerIndexPopups=plugin.settings?.headerIndexPopups!==false;}
  async setHeaderIndexPopups(value) {
    this.headerIndexPopups=value!==false;
    await Promise.all([...this.bios].filter(child=>!(child instanceof IndexChild)).map(child=>{
      child.disposeIndexes?.();child.disposeIndexes=null;
      return child.render();
    }));
  }
  onload() {
    this.plugin.registerMarkdownCodeBlockProcessor('taelgar-index',(source,element,context)=>{
      context.addChild(new IndexChild(this,source,element,context));
    });
    this.plugin.registerMarkdownCodeBlockProcessor('taelgar-header',(source,element,context)=>{
      context.addChild(new BioChild(this,source,element,context));
    });
    const refresh=()=>{
      this.pending=null;this.snapshot=null;clearTimeout(this.timer);
      this.timer=setTimeout(()=>{for(const child of this.bios)child.render();},100);
    };
    for(const [events,names] of [[this.app.metadataCache,['changed','resolved']],[this.app.vault,['rename','delete']]]) {
      if(events?.on)for(const name of names)this.registerEvent(events.on(name,refresh));
    }
  }
  async getSnapshot() {
    if(!this.pending) {
      const pending=obsidianHeaders(this.app);this.pending=pending;
      pending.catch(()=>{if(this.pending===pending)this.pending=null;});
    }
    const pending=this.pending,snapshot=await pending;
    if(this.disposed)throw new Error('The bio renderer has unloaded.');
    if(this.pending!==pending)return this.getSnapshot();
    this.snapshot=snapshot;return snapshot;
  }
  onunload() {this.disposed=true;clearTimeout(this.timer);for(const child of [...this.bios])child.unload();this.pending=null;this.snapshot=null;}
}
