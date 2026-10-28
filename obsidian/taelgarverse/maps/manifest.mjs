import path from 'node:path';
import {TFile} from 'obsidian';
import {parseMapBlock,baselineViewConfig} from '../../../src/map-block.mjs';
import {validateManifest,resolveMapSource} from '../../../src/map-core.mjs';

export async function loadObsidianBaseline(app,source,sourcePath) {
  const block=parseMapBlock(source);
  if(typeof block.source!=='string')throw new Error('Use a local manifest path; enclose [[wikilinks]] in quotes.');
  const target=block.source.trim().replace(/^!?\[\[|\]\]$/g,'').split('|')[0].trim();
  if(!target || /[:?#\x00-\x1f\\]/.test(target) || target.startsWith('/'))throw new Error('Manifest source must be a local vault path.');
  const manifestFile=app.metadataCache.getFirstLinkpathDest(target,sourcePath);
  if(!(manifestFile instanceof TFile) || !manifestFile.path.endsWith('.map.json'))throw new Error('Core .map.json manifest is missing: '+target);
  const metadata=validateManifest(JSON.parse(await app.vault.read(manifestFile)));
  const imagePath=path.posix.join(path.posix.dirname(manifestFile.path),metadata.image);
  // Image paths are exact and relative to the manifest, never basename guesses.
  const image=app.vault.getAbstractFileByPath(imagePath);
  if(!(image instanceof TFile))throw new Error('Core image is missing: '+imagePath);
  const bytes=new Uint8Array(await app.vault.readBinary(image));
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<33 || data.getUint32(0)!==0x89504e47 || data.getUint32(4)!==0x0d0a1a0a || data.getUint32(12)!==0x49484452)
    throw new Error('Map image must be a PNG.');
  const manifest=resolveMapSource(metadata,{width:data.getUint32(16),height:data.getUint32(20)});
  return {block,manifest,manifestPath:manifestFile.path,config:baselineViewConfig(block,manifest,app.vault.getResourcePath(image))};
}
