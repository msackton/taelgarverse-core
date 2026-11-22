import fs from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'yaml';
import {readVaultSessionBundles} from './vault-session-bundles.mjs';
import {sessionBundleManifest} from './session-bundles.mjs';
import {parseSessionRecap,sessionRecapHeader} from './recap-parser.mjs';

const maxArtifactSize=8*1024*1024;

async function readArtifact(folder,filename) {
  const target=path.join(folder,filename);
  const info=await fs.lstat(target);
  if(!info.isFile() || info.size>maxArtifactSize) throw new Error('Invalid session artifact '+filename+'.');
  return fs.readFile(target,'utf8');
}

async function bundleFacts(root,directory,identity) {
  const relative=directory+'/cleaned',folder=path.join(root,relative);
  const info=await fs.lstat(folder).catch(error=>{
    if(error.code!=='ENOENT') throw error;
  });
  if(!info?.isDirectory()) return null;
  const files=(await fs.readdir(folder,{withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>entry.name).sort();
  const filename=sessionBundleManifest(files);
  if(!filename) return null;
  const stem=filename.slice(0,-'-session.yaml'.length);
  const manifest=parse(await readArtifact(folder,filename),{uniqueKeys:true,maxAliasCount:100});
  if(!manifest || typeof manifest!=='object' || Array.isArray(manifest)) throw new Error('Expected a session YAML mapping.');
  const bundle={...identity,manifest,manifestPath:relative+'/'+filename};
  const recapName=stem+'-session-recap.md',statsName=stem+'-speaker-stats.json';
  const warnings=[];
  if(files.includes(recapName)) {
    try {
      const source=await readArtifact(folder,recapName);
      const recapPath=relative+'/'+recapName;
      const recap=parseSessionRecap(source,recapPath,identity);
      Object.assign(bundle,{recap:sessionRecapHeader(source),recapPath,recapStart:recap.date,recapEnd:recap.end});
    } catch(error) { warnings.push(relative+'/'+recapName+': '+error.message); }
  }
  if(files.includes(statsName)) {
    try {
      const stats=JSON.parse(await readArtifact(folder,statsName));
      if(!Array.isArray(stats?.speakers)) throw new Error('Expected a speakers list.');
      Object.assign(bundle,{speakerStats:stats,speakerStatsPath:relative+'/'+statsName});
    } catch(error) { warnings.push(relative+'/'+statsName+': '+error.message); }
  }
  bundle.played=!!bundle.recap || (manifest.scope==='session' &&
    ['transcript','narrative'].includes(manifest.sourceType) && files.includes(stem+'-source-prepared.md'));
  return {bundle,warnings};
}

export async function readCampaignSessionBundles(root,registry,campaign) {
  const inventory=readVaultSessionBundles(root,{campaigns:{[campaign]:registry.campaigns[campaign]}});
  const bundles=[],warnings=[],entries=[...inventory.entries()];
  // Limit concurrent reads against synced or slow vaults.
  for(let offset=0;offset<entries.length;offset+=12) {
    const batch=await Promise.all(entries.slice(offset,offset+12).map(async ([directory,identity])=>{
      try { return await bundleFacts(root,directory,identity); }
      catch(error) { return {warnings:[directory+': '+error.message]}; }
    }));
    for(const result of batch) {
      if(result?.bundle) bundles.push(result.bundle);
      if(result?.warnings) warnings.push(...result.warnings);
    }
  }
  return {bundles,warnings};
}
