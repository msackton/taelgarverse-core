import fs from 'node:fs/promises';
import {isUtf8} from 'node:buffer';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {isPublicationEntry,NO_PUBLISH_MARKER} from '../src/folder-exclusions.mjs';
import {inspectWebsiteNote} from '../src/website-secrets.mjs';
import {validateMapPath} from '../src/map-feature-path.mjs';
import {readMapPathFile} from '../src/map-path-files.mjs';

// Copy source inputs once. Stages operate on this request-owned directory;
// original ctime/mtime are retained separately for Dataview's file metadata.
export async function copyWorkingVault(vault,output,{log=()=>{}}={}) {
  vault=await fs.realpath(vault);output=path.resolve(output);
  if(!isInside(ROOT,output) || output===ROOT || isInside(vault,output) || isInside(output,vault))throw new Error('Working vault must be inside core and outside the original vault.');
  const parent=await fs.realpath(path.dirname(output));
  if(!isInside(ROOT,parent) || isInside(vault,parent))throw new Error('Working vault parent resolves outside core or inside the source vault.');
  await fs.mkdir(output);const stats=new Map(),pathSources=new Set();let copied=0;
  async function walk(folder) {
    const entries=await fs.readdir(path.join(vault,folder),{withFileTypes:true});
    if(entries.some(entry=>entry.name===NO_PUBLISH_MARKER))return;
    if(folder)await fs.mkdir(path.join(output,folder));
    for(const entry of entries) {
      const relative=folder?folder+'/'+entry.name:entry.name;
      if(!isPublicationEntry(entry,relative))continue;
      const source=path.join(vault,relative),target=path.join(output,relative);
      if(entry.isDirectory())await walk(relative);
      else if(entry.isFile()) {
        const stat=await fs.stat(source);
        let metadata;
        const markdown=/\.md$/i.test(relative);
        if(markdown){
          const bytes = await fs.readFile(source);
          const text = bytes.toString('utf8');
          const inspected = inspectWebsiteNote(text,relative);
          if (inspected.omitted) continue;
          metadata = inspected.note?.metadata;
          if (inspected.source !== text && !isUtf8(bytes)) {
            throw new Error(relative+': cannot filter secrets in invalid UTF-8');
          }
          await fs.writeFile(target,inspected.source === text ? bytes : inspected.source);
        }else await fs.copyFile(source,target);
        await fs.utimes(target,stat.atime,stat.mtime);
        if(markdown){
          stats.set(relative,{ctime:stat.birthtimeMs,mtime:stat.mtimeMs,size:stat.size});
          // Only explicitly referenced geometry is copied from private folders.
          // Malformed metadata remains the Store/renderer validation boundary.
          try{const value=metadata?.mapPath;if(value?.source!==undefined)pathSources.add(validateMapPath(value).source);}catch{}
        }
        copied++;
      }
    }
  }
  await walk('');
  for(const source of pathSources){
    // Missing/invalid references are reported during content preparation.
    try{readMapPathFile(vault,source);}catch{continue;}
    const target=path.join(output,source);
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(vault,source),target);
  }
  log('Working vault: '+copied+' files copied; source notes unchanged.');
  return {directory:output,stats};
}

export async function saveWorkingNotes(store) {
  const original=await fs.realpath(store.settings.vault_dir),working=await fs.realpath(store.settings.source_dir);
  if(!isInside(ROOT,working) || working===path.resolve(ROOT) || isInside(original,working) || isInside(working,original))throw new Error('Prepared notes must be written to a separate working vault inside core.');
  for(const entry of store.entries)if(entry.note)await fs.writeFile(entry.filename,entry.note.source);
}
