import {isRoutePlace,routeConnections} from '../../../src/place-routes.mjs';
import {Component,ItemView,Setting,MarkdownRenderChild} from 'obsidian';
import {buildRelationshipGraph,proseMentions} from '../../../src/relationship-graph.mjs';
import {mountRelationshipExplorer} from '../../../src/browser/relationship-explorer.mjs';
import {getPageType} from '../../../src/header-core/metadata.mjs';
import {DateManager} from '../../../src/header-core/dates.mjs';
import {drDateString} from '../../../src/campaign-calendar.mjs';
import {bioDate} from './headers.mjs';

export const RELATIONSHIP_VIEW='taelgar-relationship-explorer';

export class RelationshipView extends ItemView {
  constructor(leaf,feature){super(leaf);this.feature=feature;}
  getViewType(){return RELATIONSHIP_VIEW;}
  getDisplayText(){return 'Relationship explorer';}
  getIcon(){return 'network';}
  async onOpen(){
    if(!this.feature.enabled){this.leaf.detach();return;}
    this.feature.views.add(this);
    this.explorer=mountRelationshipExplorer(this.contentEl,{
      initialRoot:this.feature.app.workspace.getActiveFile()?.path??'',
      loadData:date=>this.feature.data(date),
      openNote:(path,line)=>this.feature.openNote(path,line),
    });
    await this.explorer.ready;
  }
  onClose(){this.feature.views.delete(this);this.explorer?.dispose();this.explorer=null;}
}

export class RelationshipBlock extends MarkdownRenderChild {
  constructor(feature,element,path,source){
    super(element);Object.assign(this,{feature,path,source,disposed:false});
  }
  onload(){this.feature.blocks.add(this);this.render();}
  render(){
    this.explorer?.dispose();this.explorer=null;
    if(this.disposed)return;
    if(!this.feature.enabled){this.containerEl.textContent='Enable Relationship explorer in Taelgarverse settings.';return;}
    if(this.source.trim()){this.containerEl.textContent='Leave the taelgar-relationship block empty; it uses the current note.';return;}
    this.explorer=mountRelationshipExplorer(this.containerEl,{
      initialRoot:this.path,embedded:true,loadData:()=>this.feature.data(),
      openNote:(path,line)=>this.feature.openNote(path,line),
    });
    return this.explorer.ready;
  }
  onunload(){this.disposed=true;this.explorer?.dispose();this.explorer=null;this.feature.blocks.delete(this);this.containerEl.replaceChildren();}
}

export class RelationshipsFeature extends Component {
  constructor(plugin){
    super();this.plugin=plugin;this.app=plugin.app;this.views=new Set();this.blocks=new Set();this.bodies=new Map();this.disposed=false;
  }
  onload(){
    this.plugin.registerMarkdownCodeBlockProcessor('taelgar-relationship',(source,element,context)=>{
      context.addChild(new RelationshipBlock(this,element,context.sourcePath,source));
    });
    this.plugin.registerView(RELATIONSHIP_VIEW,leaf=>new RelationshipView(leaf,this));
    this.plugin.addCommand({id:'open-relationship-explorer',name:'Open relationship explorer',checkCallback:checking=>{
      if(!this.enabled)return false;if(!checking)void this.open();return true;
    }});
    this.activate(this.plugin.settings.relationshipsEnabled===true);
  }
  async setEnabled(enabled){
    this.plugin.settings.relationshipsEnabled=enabled===true;
    await this.plugin.saveData(this.plugin.settings);this.activate(enabled===true);
  }
  activate(enabled){
    if(this.enabled===enabled||this.disposed&&enabled)return;
    this.enabled=enabled;clearTimeout(this.timer);clearInterval(this.dateTimer);
    if(enabled){
      this.events=this.addChild(new Component());
      this.ribbon=this.plugin.addRibbonIcon('network','Open relationship explorer',()=>{void this.open();});
      const invalidate=(file,oldPath)=>{
        if(typeof oldPath==='string')this.bodies.delete(oldPath);
        if(file?.path)this.bodies.delete(file.path);else this.bodies.clear();
        this.schedule();
      };
      for(const [target,names] of [[this.app.metadataCache,['changed','resolved']],[this.app.vault,['rename','delete','modify']]])
        if(target?.on)for(const name of names)this.events.registerEvent(target.on(name,invalidate));
      if(this.app.workspace.on)this.events.registerEvent(this.app.workspace.on('taelgarverse:context-changed',()=>this.schedule()));
      // Match header refresh behavior for external calendar / CustomJS overrides.
      this.dateTimer=setInterval(()=>{
        if(!this.views.size&&!this.blocks.size)return;
        let key;try{key=JSON.stringify(bioDate({},globalThis,this.plugin.headers?.snapshot?.fallback));}catch(error){key=error.message;}
        if(key!==this.dateKey){this.dateKey=key;this.schedule();}
      },2000);
    }else{
      if(this.events){this.removeChild(this.events);this.events=null;}
      this.ribbon?.remove();this.ribbon=null;
      for(const view of this.views){view.explorer?.dispose();view.explorer=null;}
      this.views.clear();this.app.workspace.detachLeavesOfType?.(RELATIONSHIP_VIEW);
      this.bodies.clear();
    }
    for(const block of this.blocks)void block.render();
  }
  schedule(){
    if(!this.enabled||this.disposed)return;
    clearTimeout(this.timer);this.timer=setTimeout(()=>{for(const view of [...this.views,...this.blocks])void view.explorer?.refresh();},200);
  }
  async mentions(file,route=false){
    const key=file.stat?.mtime+':'+file.stat?.size,existing=this.bodies.get(file.path);
    if(existing?.key===key&&existing.route===route)return existing.pending;
    const pending=this.app.vault.cachedRead(file).then(source=>(route?routeConnections(source):proseMentions(source)).map(item=>({...item,source:file.path})));
    this.bodies.set(file.path,{key,route,pending});
    try{return await pending;}catch(error){if(this.bodies.get(file.path)?.pending===pending)this.bodies.delete(file.path);throw error;}
  }
  async data(date){
    if(!this.enabled||this.disposed)throw new Error('Relationship explorer disabled');
    const snapshot=await this.plugin.headers.getSnapshot(),warnings=[],mentions=[],routes=[];
    if(date===undefined){
      const dates=new DateManager({}),selected=dates.normalizeDate(bioDate({},globalThis,snapshot.fallback));
      if(!selected)throw new Error('No active campaign date');
      date=drDateString(selected.sort-dates.normalizeDate('0001-01-01').sort);
    }
    const files=this.app.vault.getMarkdownFiles().flatMap(file=>{
      const metadata=this.app.metadataCache.getFileCache(file)?.frontmatter??{},type=getPageType(metadata);
      const route=isRoutePlace({type,placeType:metadata.typeOf,subtype:metadata.typeOfAlias??metadata.typeOf});
      return type==='person'||route?[{file,route}]:[];
    });
    let index=0;
    await Promise.all(Array.from({length:Math.min(8,files.length)},async()=>{
      while(index<files.length){
        if(!this.enabled||this.disposed)return;
        const {file,route}=files[index++];
        try{(route?routes:mentions).push(...await this.mentions(file,route));}catch(error){warnings.push(file.path+': '+error.message);}
      }
    }));
    if(!this.enabled||this.disposed)throw new Error('Relationship explorer disabled');
    const graph=buildRelationshipGraph(snapshot.runtime,{date,mentions,routes,
      resolve:(target,source)=>this.app.metadataCache.getFirstLinkpathDest(target,source)});
    return {graph,warnings};
  }
  async openNote(path,line){
    const file=this.app.vault.getAbstractFileByPath(path);if(!file)return;
    const leaf=this.app.workspace.getLeaf('tab');
    await leaf.openFile(file,line===undefined?{}:{eState:{line}});
  }
  async open(){
    if(!this.enabled||this.disposed)return;
    let leaf=this.app.workspace.getLeavesOfType(RELATIONSHIP_VIEW)[0];
    if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:RELATIONSHIP_VIEW,active:true});}
    await this.app.workspace.revealLeaf(leaf);
  }
  renderSettings(container){
    new Setting(container).setName('Enable relationship explorer').setDesc('Explore people, organizations, prose mentions, and places in a separate tab or taelgar-relationship blocks. Turning this off closes the explorer and stops embedded diagrams and background reads.')
      .addToggle(toggle=>toggle.setValue(this.enabled===true).onChange(value=>this.setEnabled(value)));
  }
  onunload(){this.disposed=true;this.activate(false);for(const block of this.blocks)block.onunload();}
}

