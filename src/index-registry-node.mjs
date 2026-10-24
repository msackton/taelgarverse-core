import fs from 'node:fs';
import path from 'node:path';
import {EMPTY_INDEX_REGISTRY,parseIndexRegistry,compileIndexRegistry} from './index-registry.mjs';

function registryPath(vault,relative) {
  if(typeof relative!=='string' || !relative.trim() || path.isAbsolute(relative))throw new Error('Index registry paths must be vault-relative.');
  const filename=path.resolve(vault,relative),inside=path.relative(vault,filename);
  if(inside==='..' || inside.startsWith('..'+path.sep))throw new Error('Index registry path escapes the vault.');
  if(!fs.existsSync(filename))throw new Error('Selected index registry file is missing: '+relative);
  const real=path.relative(fs.realpathSync(vault),fs.realpathSync(filename));
  if(real==='..' || real.startsWith('..'+path.sep) || path.isAbsolute(real))throw new Error('Index registry file escapes the vault.');
  return filename;
}
export function readIndexRegistry(settings,{host='website'}={}) {
  if(!settings.vault_dir) {
    if(settings.index_registry!==undefined || settings.index_override)throw new Error('Index registry selection requires vault_dir.');
    return {registry:EMPTY_INDEX_REGISTRY,files:[]};
  }
  const base=settings.index_registry??'_scripts/indexes.yaml';
  if(settings.index_registry===undefined && !fs.existsSync(path.join(settings.vault_dir,base))) {
    if(settings.index_override)throw new Error('An index override requires a base index registry.');
    return {registry:EMPTY_INDEX_REGISTRY,files:[]};
  }
  const files=[registryPath(settings.vault_dir,base)];
  if(settings.index_override!==undefined && settings.index_override!==null)files.push(registryPath(settings.vault_dir,settings.index_override));
  const documents=files.map((filename,i)=>parseIndexRegistry(fs.readFileSync(filename,'utf8'),{filename,overlay:i>0}));
  return {registry:compileIndexRegistry(documents[0],documents[1],{host}),files};
}
