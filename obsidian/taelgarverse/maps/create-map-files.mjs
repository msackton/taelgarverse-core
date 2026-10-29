import path from 'node:path';
import {mapBlockId} from '../../../src/map-block.mjs';
import {resolveMapSource} from '../../../src/map-core.mjs';

export const MAX_MAP_PNG_BYTES=256*1024*1024;
export function mapFilePath(value,suffix){
  if(typeof value!=='string' || value.length>1024 || /[:*?"<>|#\\\x00-\x1f\x7f]/.test(value) ||
    !value.split('/').every(p=>p && p===p.trim() && !p.startsWith('.') && !p.endsWith('.')) || !(suffix==='.map.json'?value.endsWith(suffix):value.toLowerCase().endsWith(suffix)))
    throw new Error('Use a vault-relative '+suffix+' path without hidden folders, dot segments, or special filename characters.');
  return value;
}
export function mapPngInfo(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.byteLength>MAX_MAP_PNG_BYTES)throw new Error('Map PNG must be at most 256 MiB.');
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<33 || data.getUint32(0)!==0x89504e47 || data.getUint32(4)!==0x0d0a1a0a || data.getUint32(8)!==13 || data.getUint32(12)!==0x49484452)
    throw new Error('Choose a static PNG image.');
  const info={width:data.getUint32(16),height:data.getUint32(20)};
  resolveMapSource({version:2,image:'image.png',sourceOffset:[0,0]},info);
  for(let offset=8;offset+12<=bytes.length;){
    const length=data.getUint32(offset),type=data.getUint32(offset+4),next=offset+length+12;
    if(next>bytes.length)throw new Error('The PNG is truncated.');
    if(type===0x6163544c)throw new Error('Animated PNGs are not supported as map sources.');
    if(type===0x49454e44 && length===0)return info;
    offset=next;
  }
  throw new Error('The PNG is missing its end chunk.');
}
export async function decodeMapPng(bytes,doc){
  const info=mapPngInfo(bytes),host=doc.defaultView;
  const url=host.URL.createObjectURL(new host.Blob([bytes],{type:'image/png'}));
  try{
    const image=new host.Image();image.src=url;await image.decode();
    if(image.naturalWidth!==info.width || image.naturalHeight!==info.height)throw new Error('Decoded PNG dimensions do not match its header.');
    return info;
  }finally{host.URL.revokeObjectURL(url);}
}
async function ensureParent(vault,filePath){
  const parts=filePath.split('/').slice(0,-1);
  for(let count=1;count<=parts.length;count++){
    const folder=parts.slice(0,count).join('/');let item=vault.getAbstractFileByPath(folder);
    if(!item){try{await vault.createFolder(folder);}catch(error){if(!vault.getAbstractFileByPath(folder))throw error;}item=vault.getAbstractFileByPath(folder);}
    if(!Array.isArray(item?.children))throw new Error('A file occupies the folder path: '+folder);
  }
}
function requireNew(vault,filePath){if(vault.getAbstractFileByPath(filePath))throw new Error('Already exists: '+filePath+'. Choose a different output path.');}

// Create new files only. Keep named recovery files if a later write fails; never
// roll back by deleting something that may already be open or edited by a user.
export async function createMapFiles(app,{imagePath,imageBytes,manifestPath,notePath,sourceOffset=[0,0]},
  {validateImage,isOpen=()=>true,newId=mapBlockId}={}){
  const vault=app.vault;
  mapFilePath(imagePath,'.png');mapFilePath(manifestPath,'.map.json');mapFilePath(notePath,'.md');
  requireNew(vault,manifestPath);requireNew(vault,notePath);
  const imported=imageBytes!==undefined;
  if(imported)requireNew(vault,imagePath);
  const imageFile=imported?null:vault.getAbstractFileByPath(imagePath);
  if(!imported && (!imageFile || Array.isArray(imageFile.children)))throw new Error('Source PNG is missing: '+imagePath);
  if(imageFile?.stat?.size>MAX_MAP_PNG_BYTES)throw new Error('Map PNG must be at most 256 MiB.');
  const revision=imageFile?{mtime:imageFile.stat?.mtime,size:imageFile.stat?.size}:null;
  const bytes=imported?imageBytes:await vault.readBinary(imageFile);
  const info=mapPngInfo(bytes);
  if(typeof validateImage!=='function')throw new Error('PNG decoding is required before creating a map.');
  await validateImage(bytes);
  const relativeImage=path.posix.relative(path.posix.dirname(manifestPath),imagePath);
  if(relativeImage.startsWith('../'))throw new Error('Place the manifest beside the PNG or in one of its parent folders.');
  const manifest={version:2,image:relativeImage,sourceOffset};
  resolveMapSource(manifest,info);
  const block={version:2,id:newId(),source:manifestPath};
  const source='version: 2\nid: '+JSON.stringify(block.id)+'\nsource: '+JSON.stringify(manifestPath)+'\n';
  const text='```taelgar-map\n'+source+'```\n',created=[];
  if(!isOpen())throw new Error('Map creation cancelled before writing files.');
  if(!imported && (vault.getAbstractFileByPath(imagePath)!==imageFile || imageFile.stat?.mtime!==revision.mtime || imageFile.stat?.size!==revision.size))
    throw new Error('The source PNG changed while loading. Choose it again before creating the map.');
  // Check again after decoding: a second dialog may have created these names.
  requireNew(vault,manifestPath);requireNew(vault,notePath);if(imported)requireNew(vault,imagePath);
  try{
    if(imported){await ensureParent(vault,imagePath);await vault.createBinary(imagePath,bytes instanceof Uint8Array?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):bytes);created.push(imagePath);}
    await ensureParent(vault,manifestPath);await vault.create(manifestPath,JSON.stringify(manifest,null,2)+'\n');created.push(manifestPath);
    await ensureParent(vault,notePath);const note=await vault.create(notePath,text);created.push(notePath);
    return {note,block,source,manifest,imagePath,manifestPath,notePath,created};
  }catch(error){
    throw new Error(error.message+(created.length?' Files retained for recovery: '+created.join(', ')+'.':''));
  }
}
