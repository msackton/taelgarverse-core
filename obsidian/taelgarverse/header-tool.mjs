import fs from 'node:fs/promises';
import path from 'node:path';

export const bundledHeaderTool=typeof __TAELGAR_HEADER_TOOL__==='undefined'?null:__TAELGAR_HEADER_TOOL__;
const inside=(root,target)=>{const relative=path.relative(root,target);return relative!=='' && relative!=='..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative);};

// BRAT installs only its usual three assets. main.js embeds the standalone tool
// and makes it available locally on plugin load, without a repository checkout.
export async function installHeaderTool(app,manifest,source=bundledHeaderTool) {
  if(source==null)return null;
  if(typeof source!=='string' || !source.length || manifest.id!=='taelgarverse')throw new Error('Invalid bundled header tool.');
  const root=await fs.realpath(app.vault.adapter.getBasePath());
  const directory=await fs.realpath(path.join(root,app.vault.configDir || '.obsidian','plugins',manifest.id));
  if(!inside(root,directory))throw new Error('Header tool directory must stay inside the vault.');
  const destination=path.join(directory,'header-tool.cjs');
  try{if((await fs.lstat(destination)).isSymbolicLink())throw new Error('Refusing to overwrite a header-tool symlink.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(await fs.readFile(destination,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return null;})!==source)
    await fs.writeFile(destination,source,'utf8');
  return destination;
}
