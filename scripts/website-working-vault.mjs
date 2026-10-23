import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {NO_PUBLISH_MARKER} from '../src/folder-exclusions.mjs';

// Copy source inputs once. Stages operate on this request-owned directory;
// original ctime/mtime are retained separately for Dataview's file metadata.
export async function copyWorkingVault(vault,output,{log=()=>{}}={}) {
  vault=await fs.realpath(vault);output=path.resolve(output);
  if(!isInside(ROOT,output) || output===ROOT || isInside(vault,output) || isInside(output,vault))throw new Error('Working vault must be inside core and outside the original vault.');
  const parent=await fs.realpath(path.dirname(output));
  if(!isInside(ROOT,parent) || isInside(vault,parent))throw new Error('Working vault parent resolves outside core or inside the source vault.');
  await fs.mkdir(output);const stats=new Map();let copied=0;
  async function walk(folder) {
    const entries=await fs.readdir(path.join(vault,folder),{withFileTypes:true});
    if(entries.some(entry=>entry.name===NO_PUBLISH_MARKER))return;
    if(folder)await fs.mkdir(path.join(output,folder));
    for(const entry of entries) {
      if(entry.name.startsWith('.') || entry.isSymbolicLink())continue;
      const relative=folder?folder+'/'+entry.name:entry.name,source=path.join(vault,relative),target=path.join(output,relative);
      if(entry.isDirectory()){if(!entry.name.startsWith('_'))await walk(relative);}
      else if(entry.isFile()) {
        const stat=await fs.stat(source);await fs.copyFile(source,target);await fs.utimes(target,stat.atime,stat.mtime);
        if(/\.md$/i.test(relative))stats.set(relative,{ctime:stat.birthtimeMs,mtime:stat.mtimeMs,size:stat.size});
        copied++;
      }
    }
  }
  await walk('');log('Working vault: '+copied+' files copied; source notes unchanged.');
  return {directory:output,stats};
}
