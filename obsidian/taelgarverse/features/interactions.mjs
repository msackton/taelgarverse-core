import {Component,MarkdownRenderChild,editorInfoField,editorLivePreviewField} from 'obsidian';
import {StateEffect,StateField} from '@codemirror/state';
import {Decoration,EditorView,ViewPlugin,WidgetType} from '@codemirror/view';
import {interactionView} from '../../../src/interaction-view.mjs';
import {mountInteractions} from '../../../src/browser/interactions.mjs';
import {interactionParts} from '../../../src/browser/interaction-groups.mjs';
import {obsidianInteractions,hasKnownTo,hasInteractionsBlock,knownCampaigns,interactionsDate,localInteractions} from './interaction-data.mjs';

class InteractionsChild extends MarkdownRenderChild {
  constructor(feature,element,path,{source='',measure=()=>{}}={}) {
    super(element);Object.assign(this,{feature,path,source,measure,sequence:0,disposed:false});
  }
  onload() {
    this.feature.panels.set(this.containerEl,this);
    this.containerEl.classList.add('taelgar-interactions','md-typeset');
    this.registerDomEvent(this.containerEl,'click',event=>{
      const link=event.target.closest?.('a[href]'),target=this.links?.get(link?.getAttribute('href'));
      if(!target)return;
      event.preventDefault();event.stopPropagation();
      if(!this.feature.app.vault.getAbstractFileByPath(target))return;
      this.feature.app.workspace.openLinkText(target,this.path,event.ctrlKey || event.metaKey);
    });
    const Observer=this.containerEl.ownerDocument.defaultView?.ResizeObserver;
    if(Observer){this.observer=new Observer(()=>this.measure());this.observer.observe(this.containerEl);}
    return this.render();
  }
  async render() {
    const sequence=++this.sequence,element=this.containerEl;
    try {
      if(this.source.trim())throw new Error('Leave the taelgar-interactions block empty; campaigns come from knownTo.');
      const snapshot=await this.feature.getSnapshot();
      if(this.disposed || sequence!==this.sequence)return;
      const file=this.feature.app.vault.getAbstractFileByPath(this.path);
      if(!file)throw new Error('The source note is no longer available.');
      const metadata=this.feature.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const campaigns=knownCampaigns(snapshot,metadata);
      if(!campaigns.length)throw new Error('Add at least one registered campaign to knownTo.');
      this.selected=campaigns.find(campaign=>campaign.code===(this.selected || this.feature.selections.get(this.path)))?.code || campaigns[0].code;
      this.date=interactionsDate(metadata,globalThis,snapshot.fallback);
      const {group,links}=localInteractions(snapshot,this.path,campaigns.find(campaign=>campaign.code===this.selected),this.date,this.feature.app);
      const knowledgeOnly=!group.events.length;
      const compact=!interactionParts(group.events).beats.length;
      element.classList.toggle('taelgar-interactions--knowledge-only',knowledgeOnly);
      element.classList.toggle('taelgar-interactions--compact',compact);
      const output=element.ownerDocument.createElement('div');
      const timeline=element.ownerDocument.createElement('div');timeline.innerHTML=interactionView([group]);
      timeline.querySelector('#campaign-interactions')?.removeAttribute('id');
      if(campaigns.length>1) {
        const select=element.ownerDocument.createElement('select');select.setAttribute('aria-label','Campaign');
        for(const campaign of campaigns){const option=element.ownerDocument.createElement('option');option.value=campaign.code;option.textContent=campaign.name;option.selected=campaign.code===this.selected;select.append(option);}
        select.addEventListener('change',()=>{this.selected=select.value;this.feature.selections.set(this.path,this.selected);void this.render();});
        if(compact)timeline.querySelector('.interaction-knowledge-campaign').replaceWith(select);
        else {
          const label=element.ownerDocument.createElement('label');label.className='taelgar-interaction-campaign';label.textContent='Campaign ';
          label.append(select);output.append(label);
        }
      }
      output.append(timeline);this.links=links;element.replaceChildren(output);
      const campaign=timeline.querySelector('[data-interaction-campaign]');
      if(campaign)mountInteractions(campaign);this.measure();
    } catch(error) {
      if(this.disposed || sequence!==this.sequence)return;
      element.classList.remove('taelgar-interactions--knowledge-only','taelgar-interactions--compact');
      element.textContent='Campaign interactions unavailable: '+error.message;this.measure();
    }
  }
  onunload() {
    this.disposed=true;this.sequence++;this.observer?.disconnect();
    this.feature.panels.delete(this.containerEl);this.containerEl.replaceChildren();
  }
}

class FooterWidget extends WidgetType {
  constructor(feature,path,revision){super();Object.assign(this,{feature,path,revision});}
  eq(other){return this.path===other.path && this.revision===other.revision;}
  toDOM(view){const element=view.dom.ownerDocument.createElement('div');this.feature.addChild(new InteractionsChild(this.feature,element,this.path,{measure:()=>view.requestMeasure()}));return element;}
  destroy(element){this.feature.removePanel(element);}
  ignoreEvent(){return true;}
}

export function interactionFooterExtension(feature) {
  feature.rebuildEffect=StateEffect.define();
  const build=state=>{
    const file=state.field(editorInfoField,false)?.file;
    if(!feature.automatic || feature.disposed || !file || state.field(editorLivePreviewField,false)!==true ||
      !hasKnownTo(feature.app.metadataCache.getFileCache(file)?.frontmatter) || hasInteractionsBlock(state.doc.toString()))return Decoration.none;
    return Decoration.set([Decoration.widget({widget:new FooterWidget(feature,file.path,feature.revision),side:1,block:true}).range(state.doc.length)]);
  };
  const field=StateField.define({create:build,update:(value,transaction)=>
    transaction.docChanged || transaction.effects.some(effect=>effect.is(feature.rebuildEffect)) ||
    transaction.state.field(editorLivePreviewField,false)!==transaction.startState.field(editorLivePreviewField,false) ||
    transaction.state.field(editorInfoField,false)?.file?.path!==transaction.startState.field(editorInfoField,false)?.file?.path ? build(transaction.state) : value,
    provide:field=>EditorView.decorations.from(field)});
  const tracker=ViewPlugin.fromClass(class {
    constructor(view){this.view=view;feature.editors.add(view);}
    destroy(){feature.editors.delete(this.view);}
  });
  return [field,tracker];
}

export class InteractionsFeature extends Component {
  constructor(plugin){super();this.plugin=plugin;this.app=plugin.app;this.panels=new Map();this.reading=new Map();this.editors=new Set();this.selections=new Map();this.revision=0;this.disposed=false;this.automatic=plugin.settings.automaticInteractions!==false;}
  onload() {
    this.plugin.registerMarkdownCodeBlockProcessor('taelgar-interactions',(source,element,context)=>{
      context.addChild(new InteractionsChild(this,element,context.sourcePath,{source}));
    });
    this.plugin.registerEditorExtension(interactionFooterExtension(this));
    this.plugin.registerMarkdownPostProcessor(()=>this.scheduleReading());
    const refresh=()=>this.invalidate();
    for(const [events,names] of [[this.app.metadataCache,['changed','resolved']],[this.app.vault,['create','modify','rename','delete']]])
      if(events?.on)for(const name of names)this.registerEvent(events.on(name,refresh));
    for(const name of ['layout-change','file-open'])this.registerEvent(this.app.workspace.on(name,()=>this.scheduleReading()));
    this.app.workspace.onLayoutReady(()=>this.scheduleReading());
    this.calendarTimer=setInterval(()=>{
      for(const child of this.panels.values()) {
        const file=this.app.vault.getAbstractFileByPath(child.path),metadata=file && this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        try{if(interactionsDate(metadata,globalThis,this.snapshot?.fallback || '1750-01-01')!==child.date)void child.render();}catch{}
      }
    },2000);
  }
  async getSnapshot() {
    if(!this.pending){const pending=obsidianInteractions(this.app);this.pending=pending;pending.catch(()=>{if(this.pending===pending)this.pending=null;});}
    const pending=this.pending,snapshot=await pending;
    if(this.disposed)throw new Error('The campaign interactions renderer has unloaded.');
    if(this.pending!==pending)return this.getSnapshot();
    this.snapshot=snapshot;return snapshot;
  }
  invalidate() {
    if(this.disposed)return;
    this.pending=null;this.snapshot=null;this.revision++;clearTimeout(this.refreshTimer);
    this.refreshTimer=setTimeout(()=>{
      if(this.disposed)return;
      for(const child of this.panels.values())void child.render();
      for(const view of this.editors)view.dispatch({effects:this.rebuildEffect.of(this.revision)});
      this.scheduleReading();
    },150);
  }
  scheduleReading() {if(this.disposed)return;clearTimeout(this.readingTimer);this.readingTimer=setTimeout(()=>{void this.syncReading();},0);}
  async syncReading() {
    const sequence=this.readingSequence=(this.readingSequence || 0)+1,leaves=[];
    this.app.workspace.iterateAllLeaves(leaf=>{if(leaf.view.getViewType()==='markdown')leaves.push(leaf.view);});
    const roots=new Set();
    for(const view of leaves) {
      const file=view.file;
      if(!this.automatic || view.getMode()!=='preview' || !file || !hasKnownTo(this.app.metadataCache.getFileCache(file)?.frontmatter))continue;
      const root=view.previewMode?.containerEl.querySelector('.markdown-preview-sizer');
      if(!root)continue;
      let source;try{source=await this.app.vault.cachedRead(file);}catch{continue;}
      if(this.disposed || sequence!==this.readingSequence)return;
      if(!this.automatic || view.getMode()!=='preview' || view.file?.path!==file.path || !hasKnownTo(this.app.metadataCache.getFileCache(file)?.frontmatter) || hasInteractionsBlock(source))continue;
      roots.add(root);let mounted=this.reading.get(root);
      if(mounted?.path!==file.path) {
        if(mounted)this.removeReading(root);
        const element=root.ownerDocument.createElement('div');root.append(element);
        this.addChild(new InteractionsChild(this,element,file.path));
        const Observer=root.ownerDocument.defaultView?.MutationObserver;
        const observer=Observer ? new Observer(()=>{if(element.parentNode!==root || root.lastElementChild!==element)root.append(element);}) : null;
        observer?.observe(root,{childList:true});mounted={element,path:file.path,observer};this.reading.set(root,mounted);
      }
      if(root.lastElementChild!==mounted.element)root.append(mounted.element);
    }
    if(this.disposed || sequence!==this.readingSequence)return;
    for(const root of this.reading.keys())if(!roots.has(root))this.removeReading(root);
  }
  removePanel(element){const child=this.panels.get(element);if(child)this.removeChild(child);}
  removeReading(root){const mounted=this.reading.get(root);if(!mounted)return;mounted.observer?.disconnect();this.removePanel(mounted.element);mounted.element.remove();this.reading.delete(root);}
  setAutomatic(value){this.automatic=value===true;this.invalidate();}
  onunload() {
    this.disposed=true;this.readingSequence++;clearTimeout(this.refreshTimer);clearTimeout(this.readingTimer);clearInterval(this.calendarTimer);
    for(const root of [...this.reading.keys()])this.removeReading(root);
    for(const child of [...this.panels.values()])child.unload();this.panels.clear();this.editors.clear();this.selections.clear();this.pending=null;this.snapshot=null;
  }
}
