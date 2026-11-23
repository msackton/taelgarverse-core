import fs from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'yaml';
import {createHash} from 'node:crypto';
import {campaignRegistry, registryPath} from '../../../src/campaign-registry.mjs';
import {sessionBundleManifest} from '../../../src/session-bundles.mjs';
import {readVaultSessionBundles} from '../../../src/vault-session-bundles.mjs';
import {parseNote} from '../../../src/content-store.mjs';

// Discovery hints only. Guarded Python inspection validates a chosen review.
// Do not follow symlinks/junctions while browsing the local session inventory.
export async function discoverSessionReviews(vault){
  const root=path.resolve(vault),sessions=[];
  const relative=file=>path.relative(root,file).split(path.sep).join('/');
  async function entries(folder){
    try{
      if(!(await fs.lstat(folder)).isDirectory())return [];
      return await fs.readdir(folder);
    }
    catch(error){if(error.code==='ENOENT')return [];throw error;}
  }
  async function plain(file){
    const parts=path.relative(root,file).split(path.sep);
    if (parts[0] === '..' || path.isAbsolute(parts.join(path.sep))) throw new Error('Session discovery requires a vault path');
    let current=root;
    for(const part of parts){
      current=path.join(current,part);
      const info=await fs.lstat(current);
      if(info.isSymbolicLink())throw new Error('Session discovery does not follow linked files or folders');
    }
    return fs.readFile(file,'utf8');
  }
  async function readRegistry() {
    let index;
    try {
      index = JSON.parse(await plain(path.join(root, registryPath)));
    } catch (error) {
      if (error.code === 'ENOENT') return {campaigns: {}};
      throw error;
    }
    const notes = new Map(await Promise.all(Object.values(index).map(async target =>
      [target, parseNote(await plain(path.join(root, target))).metadata])));
    return campaignRegistry(index, target => notes.get(target));
  }
  async function inspect(directory,{campaign,number}){
    const folder=path.join(root,directory,'cleaned');
    const row={sessionYaml:relative(folder),stage:'not mapped',campaign:registry.campaigns[campaign].name,number};
    try{
      const manifests=(await entries(folder)).filter(name=>name.endsWith('-session.yaml')).sort();
      if(!manifests.length)return;
      const file=path.join(folder,manifests[0]);
      row.sessionYaml=relative(file);
      sessionBundleManifest(manifests);
      const data=parse(await plain(file));
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Expected a session YAML object');
      const entity=path.join(folder,path.basename(file).replace(/-session\.yaml$/,'-entity-map.json'));
      try{
        const doc=JSON.parse(await plain(entity));
        if(!Array.isArray(doc.entities)||doc.entities.some(item=>!item?.review))throw new Error('Invalid entity inventory');
        row.entities=doc.entities.length;
        const reviewPath=entity.replace(/-entity-map\.json$/,'-entities-review.json');
        try{
          const review=JSON.parse(await plain(reviewPath));
          if(review.transaction){row.pending=doc.entities.length;row.reviewRecovery=true;}
          if(!review.transaction&&review.mapSha256!==createHash('sha256').update(await plain(entity)).digest('hex'))throw new Error('Review JSON is out of sync with the entity map');
        }catch(error){if(error.code!=='ENOENT')throw error;}
        Object.assign(row,{stage:'reviewable',entities:doc.entities.length,
          pending:row.reviewRecovery?doc.entities.length:doc.entities.filter(item=>item.review.status!=='humanReviewed').length,
          human:doc.entities.filter(item=>item.review.status==='humanReviewed').length});
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }catch(error){row.stage='error';row.error=error.message;}
    sessions.push(row);
  }
  const registry=await readRegistry();
  const inventory=readVaultSessionBundles(root,registry);
  for(const [directory,identity] of [...inventory.entries()].sort(([left],[right])=>left.localeCompare(right))){
    await inspect(directory,identity);
  }
  return {sessions,countsAreUnvalidated:true};
}
