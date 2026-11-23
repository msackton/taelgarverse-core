import {Component,MarkdownRenderChild,MarkdownRenderer,Notice} from 'obsidian';
import {renderHeaderCallout} from '../../../src/header-core/index.mjs';
import {escapeHtml} from '../../../src/common.mjs';
import {parseIndex} from '../../../src/indexes.mjs';
import {indexView,indexError} from '../../../src/index-view.mjs';
import {indexImageTarget} from '../../../src/index-images.mjs';
import {IMAGE_TYPES} from '../../../src/content-store.mjs';
import {headerSourceEligibility,rewriteHeader} from '../../../src/header-rewrite.mjs';
import {installHeaderTool} from '../header-tool.mjs';
import {obsidianIndex} from '../services/indexes.mjs';
import {obsidianInternalLink,mountObsidianInternalLinks} from '../services/internal-links.mjs';

export function obsidianBio(snapshot,file,metadata,date) {
  return renderHeaderCallout(snapshot.runtime,{name:file.basename,
    metadata,date,mode:'obsidian'});
}

async function indexMarkup(feature,snapshot,options,sourcePath,date,heading) {
  const result=obsidianIndex(feature.app,snapshot,options,sourcePath,date);
  if(options.mode!=='table')for(const item of result.items) {
    const target=indexImageTarget(item.imageTarget);
    const file=target && feature.app.metadataCache.getFirstLinkpathDest(target,item.path);
    if(file && IMAGE_TYPES.has('.'+file.path.split('.').at(-1).toLowerCase()))item.image=feature.app.vault.getResourcePath(file);
  }
  const link=item=>item.path ? obsidianInternalLink(item.path,item.name,'taelgar-index-link') : escapeHtml(item.name);
  return indexView(result,link,options.mode,{heading});
}

class BioChild extends MarkdownRenderChild {
  constructor(feature,source,container,context,measure=()=>{}) {
    super(container);this.feature=feature;this.source=source;this.context=context;this.sequence=0;this.disposed=false;this.measure=measure;
  }
  onload() {
    this.feature.bios.add(this);
    this.register(this.feature.plugin.dates.subscribe(()=>{
      const file=this.feature.app.vault.getAbstractFileByPath(this.context.sourcePath);
      if(!file)return;
      const metadata=this.feature.app.metadataCache.getFileCache(file)?.frontmatter || {};
      try {
        const date=JSON.stringify(this.feature.plugin.dates.getDate(metadata,this.feature.plugin.snapshots.snapshot?.fallback));
        if(date!==this.date)this.render();
      } catch {this.render();}
    }));
    return this.render();
  }
  async render() {
    const sequence=++this.sequence,element=this.containerEl,app=this.feature.app;
    let rendering;
    try {
      const snapshot=await this.feature.plugin.snapshots.getSnapshot();
      if(this.disposed || sequence!==this.sequence)return;
      const file=app.vault.getAbstractFileByPath(this.context.sourcePath);
      if(!file)throw new Error('The source note is no longer available.');
      const metadata=app.metadataCache.getFileCache(file)?.frontmatter || {};
      const date=this.feature.plugin.dates.getDate(metadata,snapshot.fallback);this.date=JSON.stringify(date);
      if(this.disposed || sequence!==this.sequence)return;
      const markdown=obsidianBio(snapshot,file,metadata,date);
      // Render offscreen so a stale async render cannot replace a newer header.
      const output=element.ownerDocument.createElement('div');
      output.className='taelgar-generated-bio';
      rendering=this.addChild(new Component());
      await MarkdownRenderer.render(app,markdown,output,this.context.sourcePath,rendering);
      if(this.disposed || sequence!==this.sequence){this.removeChild(rendering);return;}
      if(this.rendered)this.removeChild(this.rendered);
      this.rendered=rendering;element.replaceChildren(output);this.measure();
    } catch(error) {
      if(rendering)this.removeChild(rendering);
      if(this.disposed || sequence!==this.sequence)return;
      this.date=null;
      if(this.rendered){this.removeChild(this.rendered);this.rendered=null;}
      this.disposeIndexes?.();this.disposeIndexes=null;
      element.textContent='Bio unavailable: '+error.message;
    }
  }
  onunload() {this.disposed=true;this.sequence++;this.disposeIndexes?.();this.containerEl.replaceChildren();this.feature.bios.delete(this);}
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
      const snapshot=await this.feature.plugin.snapshots.getSnapshot();
      if(this.disposed || sequence!==this.sequence)return;
      const metadata=this.feature.app.metadataCache.getFileCache(this.feature.app.vault.getAbstractFileByPath(this.context.sourcePath))?.frontmatter || {};
      const date=this.feature.plugin.dates.getDate(metadata,snapshot.fallback);this.date=JSON.stringify(date);
      const html=await indexMarkup(this.feature,snapshot,options,this.context.sourcePath,date,options.heading);
      if(this.disposed || sequence!==this.sequence)return;
      this.disposeIndexes?.();element.hidden=false;element.innerHTML=html;
      this.disposeIndexes=mountObsidianInternalLinks(element,this.feature.app,this.context.sourcePath,'.taelgar-index-link');
    }catch(error){
      if(this.disposed || sequence!==this.sequence)return;
      this.date=null;this.disposeIndexes?.();this.disposeIndexes=null;element.hidden=false;element.innerHTML=indexError(error);
    }
  }
}

export class HeadersFeature extends Component {
  constructor(plugin) {super();this.plugin=plugin;this.app=plugin.app;this.bios=new Set();this.disposed=false;}
  async regeneratePageHeader(editor,file,{add=false,view}={}) {
    try {
      if(!file)throw new Error('Open a Markdown note first.');
      const source=editor.getValue(),eligibility=headerSourceEligibility(source);
      if(!eligibility.eligible){new Notice(eligibility.reason);return {status:'skipped',reason:eligibility.reason};}
      let coreMeta;
      try{coreMeta=JSON.parse(await this.app.vault.adapter.read((this.app.vault.configDir || '.obsidian')+'/metadata.json'));}
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(coreMeta!==undefined && (!coreMeta || typeof coreMeta!=='object' || Array.isArray(coreMeta)))throw new Error('metadata.json must contain a mapping.');
      if(editor.getValue()!==source || view && view.file?.path!==file.path) {
        const reason='The note changed while preparing its header; run the command again.';
        new Notice(reason);return {status:'skipped',reason};
      }
      const result=rewriteHeader(source,{filename:file.path,add,coreMeta});
      if(result.status==='changed') {
        editor.replaceRange(result.replacement,editor.offsetToPos(result.start),editor.offsetToPos(result.end));
        new Notice('Page header '+result.kind+'.');
      } else new Notice(result.reason || 'Page header is already up to date.');
      return result;
    } catch(error) {new Notice('Header unavailable: '+error.message);return {status:'error',reason:error.message};}
  }
  onload() {
    for(const [id,name,add] of [['regenerate-page-header','Regenerate page header',false],['add-page-header','Add header to current note',true]])
      this.plugin.addCommand({id,name,editorCallback:(editor,view)=>this.regeneratePageHeader(editor,view.file,{add,view})});
    this.toolReady=installHeaderTool(this.app,this.plugin.manifest).catch(error=>{new Notice('Header tool unavailable: '+error.message);});
    this.plugin.registerMarkdownCodeBlockProcessor('taelgar-index',(source,element,context)=>{
      context.addChild(new IndexChild(this,source,element,context));
    });
    // Obsidian also runs these processors inside its native Live Preview callout
    // widget. Registering another CodeMirror replacement duplicates that widget.
    this.plugin.registerMarkdownPostProcessor((element,context)=>{
      if(element.closest?.('.taelgar-generated-bio'))return;
      const selector='.callout[data-callout="taelgar-header"]';
      const callouts=[...(element.matches?.(selector)?[element]:[]),...element.querySelectorAll(selector)];
      for(const callout of callouts) {
        if(callout.parentElement?.closest('.callout,blockquote,li,.taelgar-generated-bio'))continue;
        const host=callout.ownerDocument.createElement('div');
        callout.replaceWith(host);
        context.addChild(new BioChild(this,'',host,context));
      }
    },100);
    this.register(this.plugin.snapshots.subscribe(()=>{for(const child of this.bios)void child.render();}));
  }
  onunload() {this.disposed=true;for(const child of [...this.bios])child.unload();}
}
