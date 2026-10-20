import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildObsidian,releaseFiles} from './build-obsidian.mjs';

const inside=(base,target)=>{const relative=path.relative(base,target);return relative!=='' && !relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative);};
export async function installObsidian(vault,{enable=false}={}){
  const root=await fs.realpath(vault),config=await fs.realpath(path.join(root,'.obsidian'));
  if(!inside(root,config))throw new Error('The Obsidian configuration directory must stay inside the requested vault');
  const target=path.join(config,'plugins','taelgarverse');
  const communityFile=path.join(config,'community-plugins.json');
  let community=[];
  try{community=JSON.parse(await fs.readFile(communityFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!Array.isArray(community) || community.some(id=>typeof id!=='string'))throw new Error('Invalid enabled-plugin list');
  await fs.mkdir(target,{recursive:true});
  if(!inside(config,await fs.realpath(target)))throw new Error('The plugin directory must stay inside the vault configuration directory');
  try{
    const manifest=JSON.parse(await fs.readFile(path.join(target,'manifest.json'),'utf8'));
    if(manifest.id!=='taelgarverse')throw new Error('The target directory contains a different plugin');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  // Validate all destinations before replacing any files; preserve data.json.
  if(enable){
    try{if((await fs.lstat(communityFile)).isSymbolicLink())throw new Error('Refusing to overwrite an enabled-plugin-list symlink');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  for(const file of releaseFiles){
    const destination=path.join(target,file);
    try{if((await fs.lstat(destination)).isSymbolicLink())throw new Error('Refusing to overwrite a plugin-file symlink');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const source=await buildObsidian();
  for(const file of releaseFiles)await fs.copyFile(path.join(source,file),path.join(target,file));
  if(enable){
    const enabled=community.filter(id=>id!=='taelgar-map-tools');
    if(!enabled.includes('taelgarverse'))enabled.push('taelgarverse');
    await fs.writeFile(communityFile,JSON.stringify(enabled,null,2)+'\n');
  }
  return target;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),index=args.indexOf('--vault');
  if(index<0 || !args[index+1] || args.some((value,i)=>!['--vault','--enable'].includes(value) && i!==index+1))throw new Error('Use --vault PATH [--enable]');
  console.log('Installed Taelgarverse plugin: '+await installObsidian(args[index+1],{enable:args.includes('--enable')}));
  console.log('Restart Obsidian to apply the plugin change.');
}
