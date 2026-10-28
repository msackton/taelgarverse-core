import {Component,MarkdownRenderChild,TFile,Notice} from 'obsidian';
import {createHash} from 'node:crypto';
import {parseMap} from '../../../src/maps.mjs';
import {mountMap} from '../../../src/browser/map-view.mjs';
import {parseMapBlock} from '../../../src/map-block.mjs';
import {loadObsidianBaseline} from '../maps/manifest.mjs';

export const legacyRenderers=['taelgar-map-tools','obsidian-leaflet-plugin','obsidian-leaflet'];
export const hasLegacyRenderer=app=>legacyRenderers.some(id=>app.plugins?.enabledPlugins?.has(id));

// Obsidian owns note availability. This adapter only renders the map block
// Obsidian passes to it; it does not rewrite Markdown or publish content.
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
    const element=this.containerEl,doc=element.ownerDocument;
    element.classList.add('taelgar-map-tools');
    try{
      const config=await obsidianMapConfig(this.plugin.app,this.source,this.context.sourcePath,this.plugin.hashes);
      if(this.disposed)return;
      const figure=doc.createElement('figure');figure.className='leaflet-map';figure.dataset.map=JSON.stringify(config);
      const canvas=doc.createElement('div');canvas.className='map-canvas';canvas.hidden=true;
      canvas.setAttribute('role','region');canvas.setAttribute('aria-label','Interactive Taelgar map');
      canvas.style.setProperty('--map-height',config.height);canvas.style.setProperty('--map-width',config.width);
      const caption=doc.createElement('figcaption'),status=doc.createElement('span');status.className='map-status';status.setAttribute('role','status');
      const original=doc.createElement('a');original.href=config.image;original.textContent=config.version===2?'Open full source image':'Open map image';original.target='_blank';original.rel='noopener';
      caption.append(status,original);figure.append(canvas,caption);element.replaceChildren(figure);
      this.dispose=mountMap(figure);
    }catch(error){
      if(this.disposed)return;
      const message=doc.createElement('p');message.className='map-error';message.textContent='Map unavailable: '+error.message;element.replaceChildren(message);
    }
  }
  onunload(){this.disposed=true;this.dispose?.();this.plugin.maps.delete(this);}
}

export class MapsFeature extends Component {
  constructor(plugin){super();this.plugin=plugin;this.app=plugin.app;}
  onload(){
    this.hashes=new Map();
    this.maps=new Set();
    const render=(source,element,context)=>{
      context.addChild(new MapChild(this,source,element,context));
    };
    this.plugin.registerMarkdownCodeBlockProcessor('taelgar-map',render);
    if(this.plugin.settings.legacyLeafletBlocks){
      if(hasLegacyRenderer(this.plugin.app))new Notice('Taelgarverse: legacy leaflet blocks are handled by another enabled map plugin. Use taelgar-map blocks or disable the other renderer and restart Obsidian.');
      else this.plugin.registerMarkdownCodeBlockProcessor('leaflet',render);
    }
  }
  onunload(){for(const child of this.maps)child.unload();this.hashes.clear();}
}
