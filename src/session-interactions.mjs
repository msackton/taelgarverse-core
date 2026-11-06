// Node-only reader. The Worker receives the compiled projection, never files
// from _sessions. Maps take precedence over recap headers and Cast membership.
import fs from 'node:fs';
import path from 'node:path';

import {parseSessionRecap} from './recap-parser.mjs';
import {readMappedSession} from './mapped-sessions.mjs';
export {parseSessionRecap} from './recap-parser.mjs';

function readSessionArtifacts(settings,suffixes) {
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
      if (!file.isFile() || !suffixes.some(suffix=>file.name.endsWith(suffix))) continue;
      const filename=path.join(cleaned,file.name);
      if (fs.statSync(filename).size>8*1024*1024) throw new Error('Session artifact is too large: '+file.name);
      files.push({key:path.relative(settings.vault_dir,filename).split(path.sep).join('/'),filename});
    }
  }
  return files;
}
export function readSessionRecaps(settings) {
  return readSessionArtifacts(settings,['-session-recap.md']).map(({key,filename})=>({key,text:fs.readFileSync(filename,'utf8').replace(/\r\n?/g,'\n')}));
}
export function readInteractionBundles(settings) {
  const bundles=[],warnings=[];
  for (const {key,text} of readSessionRecaps(settings)) {
    try {
      const bundle=parseSessionRecap(text,key);
      bundles.push(bundle);
    } catch(error){warnings.push(key+': '+error.message);bundles.push({key,invalid:true});}
  }
  const mapped=readSessionArtifacts(settings,['-entity-map.json','-interactions.json']),directories=new Set(mapped.map(file=>path.posix.dirname(file.key)));
  const output=bundles.filter(bundle=>!directories.has(path.posix.dirname(bundle.key)));
  for(const {key} of mapped) {
    if(key.endsWith('-interactions.json') && mapped.some(file=>file.key===key.replace(/-interactions.json$/,'-entity-map.json')))continue;
    try {
      if(!key.endsWith('-entity-map.json'))throw new Error('Interactions are missing their entity map');
      const recaps=bundles.filter(bundle=>path.posix.dirname(bundle.key)===path.posix.dirname(key) && !bundle.invalid);
      output.push(readMappedSession(settings,key,recaps.length===1 ? recaps[0] : null));
    } catch(error){warnings.push(key+': '+error.message);output.push({key,mapped:true,invalid:true});}
  }
  return {bundles:output,warnings};
}
