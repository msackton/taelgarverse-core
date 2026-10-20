import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildObsidianMaps} from './build-obsidian-maps.mjs';

const inside=(base,target)=>{const relative=path.relative(base,target);return relative!=='' && !relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative);};
export async function installObsidianMaps(vault,{enable=false}={}){
  const root=await fs.realpath(vault),config=await fs.realpath(path.join(root,'.obsidian'));
  if(!inside(root,config))throw new Error('The Obsidian configuration directory must stay inside the requested vault');
  const target=path.join(config,'plugins','taelgar-map-tools');
  const communityFile=path.join(config,'community-plugins.json');
  let community=[];
  try{community=JSON.parse(await fs.readFile(communityFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!Array.isArray(community) || community.some(id=>typeof id!=='string'))throw new Error('Invalid enabled-plugin list');
  if(enable && community.some(id=>['obsidian-leaflet-plugin','obsidian-leaflet'].includes(id)))throw new Error('Choose one leaflet-block renderer before enabling Taelgar Map Tools; the existing Leaflet plugin is enabled');
  await fs.mkdir(target,{recursive:true});
  if(!inside(config,await fs.realpath(target)))throw new Error('The plugin directory must stay inside the vault configuration directory');
  try{
    const manifest=JSON.parse(await fs.readFile(path.join(target,'manifest.json'),'utf8'));
    if(manifest.id!=='taelgar-map-tools')throw new Error('The target directory contains a different plugin');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const source=await buildObsidianMaps();
  for(const file of ['manifest.json','main.js','styles.css']){
    const destination=path.join(target,file);
    try{if((await fs.lstat(destination)).isSymbolicLink())throw new Error('Refusing to overwrite a plugin-file symlink');}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.copyFile(path.join(source,file),destination);
  }
  if(enable && !community.includes('taelgar-map-tools')){
    try{if((await fs.lstat(communityFile)).isSymbolicLink())throw new Error('Refusing to overwrite an enabled-plugin-list symlink');}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.writeFile(communityFile,JSON.stringify([...community,'taelgar-map-tools'],null,2)+'\n');
  }
  return target;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),index=args.indexOf('--vault');
  if(index<0 || !args[index+1] || args.some((value,i)=>!['--vault','--enable'].includes(value) && i!==index+1))throw new Error('Use --vault PATH [--enable]');
  console.log('Installed Obsidian map plugin: '+await installObsidianMaps(args[index+1],{enable:args.includes('--enable')}));
}
