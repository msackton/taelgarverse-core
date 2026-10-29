import {Modal,Notice} from 'obsidian';
import {PhotoshopJob} from './photoshop-runner.mjs';
import {createMapFiles,decodeMapPng,mapFilePath} from './create-map-files.mjs';

export function openCreatePhotoshopMap(feature){
  class PhotoshopModal extends Modal {
    constructor(){super(feature.app);this.closed=false;this.busy=false;this.job=null;this.layers=[];feature.creators.add(this);}
    onOpen(){
      const root=this.contentEl,doc=root.ownerDocument;root.classList.add('map-create-dialog','map-photoshop-dialog');
      const add=(tag,text)=>{const node=doc.createElement(tag);node.textContent=text;root.append(node);return node;};
      add('h2','Create map from Photoshop file');
      add('p','Uses your configured local Python exporter. Choose local artwork or a Dropbox PSD/PSB, load its layers, then export a new map. Artwork must use the original Taelgar scale (0.6 miles per pixel).');
      const field=(name,type,value='')=>{const label=add('label',name),input=doc.createElement(type==='select'?'select':'input');if(type!=='select')input.type=type;if(type==='checkbox')label.classList.add('map-create-checkbox');input.value=value;input.setAttribute('aria-label',name);label.append(input);return input;};
      const button=(text,action)=>{const b=add('button',text);b.type='button';b.addEventListener('click',action);return b;};
      this.mode=field('Source','select');
      for(const [value,text] of [['local','Local Photoshop file'],['dropbox','Dropbox API']]){const option=doc.createElement('option');option.value=value;option.textContent=text;this.mode.append(option);}
      this.source=field('Photoshop file path','text');this.source.placeholder='/absolute/path/world.psb';
      this.token=field('Dropbox access token (this dialog only)','password');this.token.autocomplete='off';this.token.spellcheck=false;
      this.namespace=field('Dropbox root namespace (optional)','text');
      this.dropboxHelp=add('p','Use an account-relative Dropbox path such as /Maps/world.psb or a file id:. Enter a short-lived token here, or configure a private credential JSON file in settings. Downloads use a verified local cache; Dropbox files are read only.');
      const updateMode=()=>{const isDropbox=this.mode.value==='dropbox';for(const node of [this.token.parentElement,this.namespace.parentElement,this.dropboxHelp])node.hidden=!isDropbox;this.source.placeholder=isDropbox?'/Maps/world.psb':'/absolute/path/world.psb';this.invalidate();};
      this.mode.addEventListener('change',updateMode);
      for(const input of [this.source,this.token,this.namespace])input.addEventListener('input',()=>this.invalidate());
      updateMode();
      this.load=button('Load Photoshop layers',()=>void this.inspect());
      this.canvas=add('p','No Photoshop source loaded.');
      const actions=add('div','');
      for(const [label,select] of [['Saved visibility',row=>row.visible],['Select all supported',()=>true],['Select none',()=>false]]){
        const b=doc.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>{for(const row of this.layers)row.input.checked=row.supported && select(row);});actions.append(b);
      }
      this.layerList=add('div','');this.layerList.className='map-photoshop-layers';
      add('p','Select drawable layers individually. Unsupported compositing is explained below each disabled layer. The exporter keeps native canvas coordinates.');
      this.topLeft=field('First hex (optional crop)','text');this.bottomRight=field('Last hex, inclusive (optional)','text');
      this.topLeft.placeholder='Blank for full canvas';this.bottomRight.placeholder='Blank for one hex';
      this.transparent=field('Transparent background','checkbox');
      this.image=field('New PNG path','text','assets/maps/New map.png');
      this.manifest=field('New manifest path','text','assets/maps/New map.map.json');
      this.note=field('New map note path','text','Maps/New map.md');
      this.status=add('pre','');this.status.className='map-photoshop-status';this.status.setAttribute('role','status');
      this.create=button('Export, create map and open editor',()=>void this.save());this.create.disabled=true;
      this.cancel=button('Cancel',()=>this.close());
    }
    invalidate(){
      if(this.busy)return;
      this.inventory=null;this.layers=[];this.layerList?.replaceChildren();
      if(this.create)this.create.disabled=true;
      if(this.canvas)this.canvas.textContent='Source changed. Load its layers before exporting.';
    }
    setBusy(value){
      this.busy=value;for(const input of this.contentEl.querySelectorAll('input,select,button'))if(input!==this.cancel)input.disabled=value;
      if(!value){this.create.disabled=!this.inventory;for(const row of this.layers)row.input.disabled=!row.supported;}
    }
    async inspect(){
      if(this.busy || this.closed)return;
      this.invalidate();this.setBusy(true);this.status.textContent='Loading Photoshop source…';
      try{
        await this.job?.dispose();this.job=null;
        const settings=feature.plugin.settings,isDropbox=this.mode.value==='dropbox';
        const job=await PhotoshopJob.create({python:settings.photoshopPython,exporter:settings.photoshopExporter,
          credentialsFile:isDropbox?settings.photoshopDropboxCredentials:'',vaultRoot:this.app.vault.adapter.getBasePath?.(),
          token:isDropbox?this.token.value:'',onProgress:text=>{if(!this.closed)this.status.textContent=text;}});
        this.job=job;if(this.closed){await job.dispose();return;}
        const inventory=await job.inspect({source:this.source.value,dropbox:isDropbox,namespace:this.namespace.value});
        if(this.closed)return;
        this.inventory=inventory;this.canvas.textContent=`${inventory.width} × ${inventory.height} pixels · ${inventory.layers.length} drawable layers`;
        const doc=this.contentEl.ownerDocument;
        this.layers=inventory.layers.map(row=>{
          const label=doc.createElement('label'),input=doc.createElement('input'),name=doc.createElement('span');input.type='checkbox';input.checked=row.supported && row.visible;input.disabled=!row.supported;name.textContent=row.path;label.append(input,name);
          if(!row.supported){const reason=doc.createElement('small');reason.textContent=row.reason || 'Unsupported compositing.';label.append(reason);}
          this.layerList.append(label);return {...row,input};
        });
        const stem=this.source.value.split(/[\\/]/).pop().replace(/\.ps[db]$/i,'').replace(/[:*?"<>|#\x00-\x1f\x7f]/g,'-').replace(/^\.+|[. ]+$/g,'').trim() || 'New map';
        const available=(prefix,suffix)=>{let value=prefix+suffix;for(let i=2;this.app.vault.getAbstractFileByPath(value);i++)value=prefix+'-'+i+suffix;return value;};
        this.image.value=available('assets/maps/'+stem,'.png');this.manifest.value=available(this.image.value.slice(0,-4),'.map.json');this.note.value=available('Maps/'+stem,'.md');
        this.status.textContent='Layers loaded. Review selection and output paths, then export.';
      }catch(error){if(!this.closed)this.status.textContent=error.message;}
      finally{if(!this.closed)this.setBusy(false);}
    }
    async save(){
      if(this.busy || this.closed || !this.inventory)return;
      this.setBusy(true);this.status.textContent='Exporting selected layers…';
      try{
        for(const [input,suffix] of [[this.image,'.png'],[this.manifest,'.map.json'],[this.note,'.md']]){
          const output=mapFilePath(input.value.trim(),suffix);
          if(this.app.vault.getAbstractFileByPath(output))throw new Error('Already exists: '+output+'; choose a new path.');
        }
        const exported=await this.job.export({layers:this.layers.filter(row=>row.input.checked).map(row=>row.path),topLeft:this.topLeft.value,bottomRight:this.bottomRight.value,transparent:this.transparent.checked});
        if(this.closed || !feature.active)return;
        this.status.textContent='Checking PNG and creating map files…';
        const result=await createMapFiles(this.app,{...exported,imagePath:this.image.value.trim(),manifestPath:this.manifest.value.trim(),notePath:this.note.value.trim()},
          {validateImage:bytes=>decodeMapPng(bytes,this.contentEl.ownerDocument),isOpen:()=>!this.closed && feature.active});
        new Notice('Created '+result.notePath);
        if(!this.closed && feature.active){this.close();await feature.edit(result.notePath,{source:result.source,id:result.block.id});}
      }catch(error){if(!this.closed)this.status.textContent=error.message;}
      finally{if(!this.closed)this.setBusy(false);}
    }
    onClose(){
      this.closed=true;feature.creators.delete(this);if(this.token)this.token.value='';
      void this.job?.dispose().catch(()=>new Notice('Could not remove the temporary Photoshop export folder. It can be removed from the system temp directory.'));
      this.layers=[];this.inventory=null;this.contentEl.replaceChildren();
    }
  }
  const modal=new PhotoshopModal();modal.open();return modal;
}
