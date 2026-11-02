import {Component,MarkdownRenderChild,MarkdownRenderer,Notice} from 'obsidian';
import {renderHeaderCallout} from '../../../src/header-core/index.mjs';
import {escapeHtml} from '../../../src/common.mjs';
import {headerIndexesForMetadata,parseIndex,indexLabels} from '../../../src/indexes.mjs';
import {indexView,indexPopup,indexPopupShell,indexError} from '../../../src/index-view.mjs';
import {indexImageTarget} from '../../../src/index-images.mjs';
import {IMAGE_TYPES,parseNote} from '../../../src/content-store.mjs';
import {firstDescriptionSentence} from '../../../src/index-description.mjs';
import {mountIndexPopups} from '../../../src/browser/index-popups.mjs';
import {headerSourceEligibility,rewriteHeader} from '../../../src/header-rewrite.mjs';
import {installHeaderTool} from '../header-tool.mjs';
import {obsidianIndex,obsidianIndexExists} from '../services/indexes.mjs';

export function obsidianBio(snapshot,file,metadata,date) {
  return renderHeaderCallout(snapshot.runtime,{name:file.basename,
    metadata,date,mode:'obsidian'});
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
      let disposeIndexes;
      const indexButtons=this.feature.headerIndexPopups ? headerIndexMarkup(this.feature,snapshot,metadata,this.context.sourcePath,date) : '';
      if(indexButtons) {
        const buttons=element.ownerDocument.createElement('div');buttons.className='taelgar-index-buttons';
        buttons.innerHTML=indexButtons;
        if(buttons.innerHTML) {
          output.append(buttons);
          disposeIndexes=mountIndexes(buttons,app,this.context.sourcePath,{load:async details=>{
            const current=await this.feature.plugin.snapshots.getSnapshot();
            const currentFile=app.vault.getAbstractFileByPath(this.context.sourcePath);
            if(!currentFile)throw new Error('Index target unavailable');
            const currentMetadata=app.metadataCache.getFileCache(currentFile)?.frontmatter || {};
            return indexMarkup(this.feature,current,{type:details.dataset.indexType},this.context.sourcePath,this.feature.plugin.dates.getDate(currentMetadata,current.fallback));
          }});
        }
      }
      this.disposeIndexes?.();this.disposeIndexes=disposeIndexes;
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
      const html=await indexMarkup(this.feature,snapshot,options,this.context.sourcePath,date,{heading:options.heading});
      if(this.disposed || sequence!==this.sequence)return;
      this.disposeIndexes?.();element.hidden=false;element.innerHTML=html;
      this.disposeIndexes=mountIndexes(element,this.feature.app,this.context.sourcePath);
    }catch(error){
      if(this.disposed || sequence!==this.sequence)return;
      this.date=null;this.disposeIndexes?.();this.disposeIndexes=null;element.hidden=false;element.innerHTML=indexError(error);
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
