import {Component,MarkdownRenderChild,TFile,Notice} from 'obsidian';
import {createHash} from 'node:crypto';
import {parseMap} from '../../../src/maps.mjs';
import {mountMap} from '../../../src/browser/map-view.mjs';
import {parseMapBlock,mapFences} from '../../../src/map-block.mjs';
import {loadObsidianBaseline} from '../maps/manifest.mjs';
import {MAP_EDITOR_VIEW,MapEditorView,openMapEditor} from '../maps/view.mjs';
import {mountTownPlacement} from '../maps/towns.mjs';

export const legacyRenderers=['taelgar-map-tools','obsidian-leaflet-plugin','obsidian-leaflet'];
export const hasLegacyRenderer=app=>legacyRenderers.some(id=>app.plugins?.enabledPlugins?.has(id));

// Rendering never writes notes. Explicit town Saves patch only their
// guarded frontmatter field, through editor or atomic vault updates.
export async function obsidianMapConfig(app,source,sourcePath,hashes) {
  if(parseMapBlock(source).version===2)return (await loadObsidianBaseline(app,source,sourcePath)).config;
  let file,entry;
  const store={canonical:new Map(),lookup(image){
    file=app.metadataCache.getFirstLinkpathDest(image,sourcePath);
    if(!(file instanceof TFile))return {};
    entry={id:file.path,target:file.path,extension:'.'+file.extension.toLowerCase(),note:null};
    return {entry};
  }};
  parseMap(source,store,{id:sourcePath});
  const key=JSON.stringify([file.path,file.stat.mtime,file.stat.size]);
  let pending=hashes.get(key);
  if(!pending){
    pending=app.vault.readBinary(file).then(bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));
    hashes.set(key,pending);
    pending.catch(()=>hashes.delete(key));
    // Keep only recent images; a changed file gets a fresh content hash.
    while(hashes.size>32)hashes.delete(hashes.keys().next().value);
  }
  const sha256=await pending;
  store.lookup=()=>({entry:{...entry,sha256}});
  const {config}=parseMap(source,store,{id:sourcePath});
  config.image=app.vault.getResourcePath(file);
  return config;
}

class MapChild extends MarkdownRenderChild {
  constructor(plugin,source,container,context){super(container);this.plugin=plugin;this.source=source;this.context=context;this.disposed=false;plugin.maps.add(this);}
  async onload(){
    const sequence=this.sequence=(this.sequence??0)+1;
    this.dispose?.();this.dispose=null;this.towns=null;
    const element=this.containerEl,doc=element.ownerDocument;
    element.classList.add('taelgar-map-tools');
    try{
      const baseline=parseMapBlock(this.source).version===2?await loadObsidianBaseline(this.plugin.app,this.source,this.context.sourcePath):null;
      const config=baseline?.config??await obsidianMapConfig(this.plugin.app,this.source,this.context.sourcePath,this.plugin.hashes);
      if(this.disposed || this.sequence!==sequence)return;
      const figure=doc.createElement('figure');figure.className='leaflet-map';figure.dataset.map=JSON.stringify(config);
      const canvas=doc.createElement('div');canvas.className='map-canvas';canvas.hidden=true;
      canvas.setAttribute('role','region');canvas.setAttribute('aria-label','Interactive Taelgar map');
      canvas.style.setProperty('--map-height',config.height);canvas.style.setProperty('--map-width',config.width);
      const caption=doc.createElement('figcaption'),status=doc.createElement('span');status.className='map-status';status.setAttribute('role','status');
      const original=doc.createElement('a');original.href=config.image;original.textContent=config.version===2?'Open full source image':'Open map image';original.target='_blank';original.rel='noopener';
      caption.append(status,original);figure.append(canvas,caption);element.replaceChildren(figure);
      this.dispose=mountMap(figure,{decorate:baseline?context=>{
        this.towns=mountTownPlacement({...context,figure,manifest:baseline.manifest,app:this.plugin.app,sourcePath:this.context.sourcePath,
          onSaved:(file,location)=>{for(const child of this.plugin.maps)child.towns?.updateNote(file,location);}});
        return this.towns;
      }:undefined});
      if(config.version===2){
        this.lineHint=this.context.getSectionInfo?.(element)?.lineStart;
        const edit=doc.createElement('button');edit.type='button';edit.textContent='Open map editor';caption.append(edit);
        edit.addEventListener('click',()=>void this.plugin.edit(this.context.sourcePath,{source:this.source,lineHint:this.context.getSectionInfo?.(element)?.lineStart}));
      }
    }catch(error){
      if(this.disposed || this.sequence!==sequence)return;
      const message=doc.createElement('p');message.className='map-error';message.textContent='Map unavailable: '+error.message;element.replaceChildren(message);
    }
  }
  onunload(){this.disposed=true;this.dispose?.();this.plugin.maps.delete(this);}
}

export class MapsFeature extends Component {
  constructor(plugin){super();this.plugin=plugin;this.app=plugin.app;}
  onload(){
    this.active=true;
    this.hashes=new Map();
    this.maps=new Set();
    this.editors=new Set();
    this.plugin.registerView(MAP_EDITOR_VIEW,leaf=>new MapEditorView(leaf,this));
    this.plugin.addCommand({id:'edit-current-map',name:'Open current map in editor',editorCheckCallback:(checking,editor,view)=>{
      const line=editor.getCursor().line,block=mapFences(editor.getValue()).find(b=>b.startLine-1<=line && b.endLine-1>=line && b.data?.version===2);
      if(!block || !view.file)return false;
      if(!checking)void this.edit(view.file.path,{source:block.body,lineHint:line});return true;
    }});
    const render=(source,element,context)=>{
      context.addChild(new MapChild(this,source,element,context));
    };
    this.plugin.registerMarkdownCodeBlockProcessor('taelgar-map',render);
    if(this.plugin.settings.legacyLeafletBlocks){
      if(hasLegacyRenderer(this.plugin.app))new Notice('Taelgarverse: legacy leaflet blocks are handled by another enabled map plugin. Use taelgar-map blocks or disable the other renderer and restart Obsidian.');
      else this.plugin.registerMarkdownCodeBlockProcessor('leaflet',render);
    }
  }
  async edit(path,selection){try{await openMapEditor(this,path,selection);}catch(error){new Notice('Map editor: '+error.message);}}
  refreshMap(path,id,source,previous){
    const normalized=s=>s.replace(/\r\n/g,'\n').trim();
    const unique=mapFences(previous.note).filter(b=>b.raw===previous.raw).length===1;
    for(const child of this.maps){
      if(child.context.sourcePath!==path)continue;
      let data;try{data=parseMapBlock(child.source);}catch{continue;}
      if(data.id===id || (!data.id && normalized(child.source)===normalized(previous.body) && (unique || child.lineHint===previous.lineHint))){child.source=source;void child.onload();}
    }
  }
  onunload(){this.active=false;for(const child of this.maps)child.unload();for(const editor of this.editors)editor.onClose();this.app.workspace.detachLeavesOfType?.(MAP_EDITOR_VIEW);this.hashes.clear();}
}
