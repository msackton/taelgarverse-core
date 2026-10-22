// Node-only reader. The Worker receives the compiled projection, never files
// from _sessions. Only recap session headers and Cast membership are inputs.
import fs from 'node:fs';
import path from 'node:path';

import {parseSessionRecap} from './recap-parser.mjs';
export {parseSessionRecap} from './recap-parser.mjs';

export function readSessionRecaps(settings) {
  if (!settings.vault_dir) return [];
  const root=path.join(settings.vault_dir,'_sessions'),files=[];
  function directories(directory) {
    if(!fs.existsSync(directory))return [];
    return fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&!entry.isSymbolicLink()).sort((a,b)=>a.name.localeCompare(b.name));
  }
  for (const campaign of directories(root)) for (const session of directories(path.join(root,campaign.name))) {
    const cleaned=path.join(root,campaign.name,session.name,'cleaned');
    if (!fs.existsSync(cleaned) || fs.lstatSync(cleaned).isSymbolicLink()) continue;
    for (const file of fs.readdirSync(cleaned,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (!file.isFile() || !file.name.endsWith('-session-recap.md')) continue;
      const filename=path.join(cleaned,file.name);
      if (fs.statSync(filename).size>8*1024*1024) throw new Error('Session recap is too large: '+file.name);
      files.push({key:path.relative(settings.vault_dir,filename).split(path.sep).join('/'),text:fs.readFileSync(filename,'utf8').replace(/\r\n?/g,'\n')});
    }
  }
  return files;
}
export function readInteractionBundles(settings) {
  const bundles=[],warnings=[];
  for (const {key,text} of readSessionRecaps(settings)) {
    try {
      const bundle=parseSessionRecap(text,key);
      bundles.push(bundle);
    } catch(error){warnings.push(key+': '+error.message);bundles.push({key,invalid:true});}
  }
  return {bundles,warnings};
}
