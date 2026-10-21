import {Component,MarkdownRenderChild,MarkdownRenderer} from 'obsidian';
import {createHeaderSnapshot,renderBio} from '../../../src/header-core/index.mjs';
import {Contexts} from '../../../src/contexts.mjs';

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
      rendering=this.addChild(new Component());
      await MarkdownRenderer.render(app,markdown,output,this.context.sourcePath,rendering);
      if(this.disposed || sequence!==this.sequence){this.removeChild(rendering);return;}
      if(this.rendered)this.removeChild(this.rendered);
      this.rendered=rendering;element.replaceChildren(output);
    } catch(error) {
      if(rendering)this.removeChild(rendering);
      if(this.disposed || sequence!==this.sequence)return;
      if(this.rendered){this.removeChild(this.rendered);this.rendered=null;}
      element.textContent='Bio unavailable: '+error.message;
    }
  }
  onunload() {this.disposed=true;this.sequence++;clearInterval(this.timer);this.feature.bios.delete(this);}
}

export class HeadersFeature extends Component {
  constructor(plugin) {super();this.plugin=plugin;this.app=plugin.app;this.bios=new Set();this.disposed=false;}
  onload() {
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
