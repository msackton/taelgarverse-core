import path from 'node:path';
import {validateManifest} from '../../../src/map-core.mjs';
import {validateMapLayers} from '../../../src/map-layers.mjs';

export async function saveMapLayerDocument(app,{manifestPath,manifest,document,data,isOpen=()=>true}){
  validateMapLayers(data);
  const text=JSON.stringify(data,null,2)+'\n';
  if(!isOpen())throw new Error('The map editor closed before saving.');
  if(document){
    const file=app.vault.getAbstractFileByPath(document.path);
    if(!file)throw new Error('Layer file was removed. Your draft is retained.');
    await app.vault.process(file,current=>{
      if(!isOpen())throw new Error('The map editor closed before saving.');
      if(current!==document.text)throw new Error('Layer file changed elsewhere. Cancel and choose Reload region layers before retrying; your draft is retained.');
      return text;
    });
    return {path:document.path,text,data};
  }
  const file=app.vault.getAbstractFileByPath(manifestPath);
  if(!file)throw new Error('Map manifest was removed.');
  const filename=path.posix.basename(manifestPath,'.map.json')+'-regions-'+crypto.randomUUID()+'.map-layers.json';
  const destination=path.posix.join(path.posix.dirname(manifestPath),filename);
  await app.vault.create(destination,text);
  try{
    await app.vault.process(file,current=>{
      if(!isOpen())throw new Error('The map editor closed before attaching the layer file.');
      const metadata=validateManifest(JSON.parse(current));
      if(JSON.stringify(metadata.layers??[])!==JSON.stringify(manifest.layers??[]))throw new Error('Manifest layer references changed elsewhere. Reopen the editor.');
      return JSON.stringify({...metadata,layers:[...(metadata.layers??[]),filename]},null,2)+'\n';
    });
  }catch(error){throw new Error(error.message+' The saved layer file remains at '+destination+'; attach it through the manifest layers field to recover it.');}
  manifest.layers=[...(manifest.layers??[]),filename];
  return {path:destination,text,data};
}
