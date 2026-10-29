import {Modal,FuzzySuggestModal,Notice} from 'obsidian';
import path from 'node:path';
import {createMapFiles,decodeMapPng,MAX_MAP_PNG_BYTES} from './create-map-files.mjs';

const safeStem=name=>name.replace(/\.png$/i,'').replace(/[:*?"<>|#\\/\x00-\x1f\x7f]/g,'-').replace(/^\.+|[. ]+$/g,'').trim() || 'New map';
const availablePath=(vault,prefix,suffix)=>{let value=prefix+suffix;for(let i=2;vault.getAbstractFileByPath(value);i++)value=prefix+'-'+i+suffix;return value;};

export function openCreateMap(feature){
  class CreateMapModal extends Modal {
    constructor(){super(feature.app);this.closed=false;this.busy=false;this.selected=null;feature.creators.add(this);}
    onOpen(){
      const root=this.contentEl,doc=root.ownerDocument;root.classList.add('map-create-dialog');
      const title=doc.createElement('h2');title.textContent='Create map from image';
      const help=doc.createElement('p');help.textContent='Choose a static PNG exported at the original Taelgar world scale: 1 image pixel = 1 world pixel (0.6 miles). For higher-resolution regional artwork, use Regional artwork in an existing map editor.';root.append(title,help);
      const button=(text,fn)=>{const b=doc.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',fn);root.append(b);return b;};
      const field=(name,type,value)=>{const label=doc.createElement('label');label.textContent=name;const input=doc.createElement('input');input.type=type;input.value=value;input.setAttribute('aria-label',name);label.append(input);root.append(label);return input;};
      this.pick=button('Choose PNG from vault',()=>{
        if(this.busy)return;
        const owner=this;
        class ImagePicker extends FuzzySuggestModal {
          getItems(){return owner.app.vault.getFiles().filter(file=>file.extension?.toLowerCase()==='png');}
          getItemText(file){return file.path;}
          onChooseItem(file){if(!owner.closed && !owner.busy)owner.choose({path:file.path,name:path.posix.basename(file.path)});}
        }
        this.picker=new ImagePicker(this.app);this.picker.setPlaceholder('Choose a map PNG');this.picker.open();
      });
      this.upload=field('Import PNG from computer','file','');this.upload.accept='.png,image/png';
      this.upload.addEventListener('change',()=>{const file=this.upload.files?.[0];if(file && !this.busy)this.choose({file,name:file.name});});
      this.selection=doc.createElement('p');this.selection.textContent='No image selected.';root.append(this.selection);
      this.image=field('Imported PNG path','text','');this.image.parentElement.hidden=true;
      this.manifest=field('New manifest path','text','');this.note=field('New map note path','text','');
      const alignment=doc.createElement('p');alignment.textContent='World offset locates the PNG’s top-left on the original Photoshop canvas. Use 0, 0 for the full canvas; enter the original X/Y for a cropped export. Keep the exported image at native scale.';root.append(alignment);
      this.x=field('World offset X','number','0');this.y=field('World offset Y','number','0');
      for(const input of [this.x,this.y]){input.min='0';input.max='100000';input.step='1';}
      this.status=doc.createElement('p');this.status.setAttribute('role','status');root.append(this.status);
      this.create=button('Create map and open editor',()=>void this.save());this.create.disabled=true;
      button('Cancel',()=>this.close());
    }
    choose(value){
      if(this.closed)return;
      this.selected=value;const stem=safeStem(value.name),vault=this.app.vault;
      this.selection.textContent=value.file?'Import '+value.name:'Use '+value.path;
      this.image.parentElement.hidden=!value.file;
      this.image.value=value.path??availablePath(vault,'assets/maps/'+stem,'.png');
      const imagePath=this.image.value;
      this.manifest.value=availablePath(vault,imagePath.replace(/\.png$/i,''),'.map.json');
      this.note.value=availablePath(vault,'Maps/'+stem,'.md');
      this.status.textContent='Creates new files; existing images and notes are preserved.';this.create.disabled=false;
    }
    async save(){
      if(this.busy || this.closed || !this.selected)return;
      this.busy=true;const inputs=[this.pick,this.upload,this.image,this.manifest,this.note,this.x,this.y,this.create];for(const input of inputs)input.disabled=true;
      try{
        if(!this.x.value.trim() || !this.y.value.trim())throw new Error('Enter both world offset coordinates.');
        const selected=this.selected,options={imagePath:selected.path??this.image.value.trim(),manifestPath:this.manifest.value.trim(),notePath:this.note.value.trim(),sourceOffset:[Number(this.x.value),Number(this.y.value)]};
        if(selected.file){if(selected.file.size>MAX_MAP_PNG_BYTES)throw new Error('Map PNG must be at most 256 MiB.');options.imageBytes=await selected.file.arrayBuffer();}
        this.status.textContent='Checking PNG and creating the map…';
        const result=await createMapFiles(this.app,options,{validateImage:bytes=>decodeMapPng(bytes,this.contentEl.ownerDocument),isOpen:()=>!this.closed && feature.active});
        // Creation is complete even if the user closed the dialog while writing.
        new Notice('Created '+result.notePath);
        if(!this.closed && feature.active){this.close();await feature.edit(result.notePath,{source:result.source,id:result.block.id});}
      }catch(error){if(!this.closed)this.status.textContent=error.message;}
      finally{this.busy=false;if(!this.closed)for(const input of inputs)input.disabled=false;}
    }
    onClose(){this.closed=true;this.picker?.close();feature.creators.delete(this);this.selected=null;this.contentEl.replaceChildren();}
  }
  const modal=new CreateMapModal();modal.open();return modal;
}
