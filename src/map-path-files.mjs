import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isInside} from './config.mjs';
import {mapPathSource,validateMapPathGeometry} from './map-feature-path.mjs';

// Geometry is an input to a note, never a public asset. Explicit references may
// live under _maps, but cannot escape the vault or bypass .nopublish boundaries.
export function readMapPathFile(root,source,{policyRoot=root,excludedFolders=[]}={}){
  mapPathSource(source);
  const parts=source.split('/');
  if(/^assets?\/dm(?:\/|$)/i.test(source) || parts.some(p=>p.toLowerCase()==='worldbuilding') ||
    excludedFolders.some(folder=>!folder || source.startsWith(folder+'/')))
    throw new Error('Path geometry is in an excluded folder: '+source);
  try{
    for(const base of new Set([root,policyRoot])){
      let directory=base;
      for(const part of parts){
        if(fs.existsSync(path.join(directory,'.nopublish')))throw new Error('Excluded');
        directory=path.join(directory,part);
        if(fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink())throw new Error('Symlink');
      }
    }
    const filename=path.join(root,source);
    if(!isInside(fs.realpathSync(root),fs.realpathSync(filename)))throw new Error('Outside vault');
    if(fs.statSync(filename).size>2_000_000)throw new Error('Too large');
    const bytes=fs.readFileSync(filename);
    const data=validateMapPathGeometry(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    return {data,sha256:createHash('sha256').update(bytes).digest('hex')};
  }catch{throw new Error('Path geometry missing, invalid or excluded: '+source);}
}
