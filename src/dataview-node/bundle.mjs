import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,isInside} from '../config.mjs';

export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const DATAVIEW_RELEASE=Object.freeze({
  version:'0.5.68',
  url:'https://github.com/blacksmithgu/obsidian-dataview/releases/download/0.5.68',
  hashes:Object.freeze({
    'main.js':'794e9eaede73920bb8d54b0eda4f5de2182d698cc638774500f24f14bcd4da0b',
    'manifest.json':'9235db47112da81b85591c79ecb9ae2574e5e72207056e976472f90616286185',
  }),
});
export const DEFAULT_DATAVIEW_DIRECTORY=path.join(ROOT,'.cache/dataview',DATAVIEW_RELEASE.version);
const acceptedMainHashes=new Set([
  DATAVIEW_RELEASE.hashes['main.js'],
  // The installed copy has the same executable code, with its source map removed.
  'bcdb7a7882051a30427a3fa370533c1052019591e7551bcc12611bb9a726bbb3',
]);

export async function bundleIdentity(directory) {
  const source=await fs.readFile(path.join(directory,'main.js'),'utf8');
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  if(manifest.id!=='dataview' || manifest.version!==DATAVIEW_RELEASE.version)throw new Error('The Node adapter supports Dataview '+DATAVIEW_RELEASE.version+' only; review private seams before updating.');
  if(!acceptedMainHashes.has(sha256(source)))throw new Error('Unrecognized Dataview '+DATAVIEW_RELEASE.version+' bundle; review and repin the private loader seams.');
  return {source,identity:{version:manifest.version,sha256:sha256(source)}};
}

async function verifyRelease(directory,release) {
  if((await fs.lstat(directory)).isSymbolicLink())throw new Error('Dataview cache cannot be a symlink.');
  const files={};
  for(const [name,expected] of Object.entries(release.hashes)) {
    const filename=path.join(directory,name),stat=await fs.lstat(filename);
    if(!stat.isFile() || stat.isSymbolicLink())throw new Error('Dataview cache file must be a regular file: '+name);
    files[name]=await fs.readFile(filename);
    if(sha256(files[name])!==expected)throw new Error('Dataview cache checksum mismatch: '+name);
  }
  const manifest=JSON.parse(files['manifest.json'].toString('utf8'));
  if(manifest.id!=='dataview' || manifest.version!==release.version)throw new Error('Dataview cache manifest does not match the pinned release.');
}

const pending=new Map();
async function prepareCache(directory,{release,fetchImpl,log}) {
  let exists=false;
  try{await fs.lstat(directory);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(exists) {
    try{await verifyRelease(directory,release);}
    catch(error){throw new Error('Invalid pinned Dataview cache at '+directory+': '+error.message+'. Remove this cache directory and retry, or select --dataview-directory explicitly.',{cause:error});}
    log('Dataview '+release.version+': using verified local cache.');return directory;
  }
  const cacheRoot=path.join(ROOT,'.cache');
  if(!isInside(cacheRoot,directory))throw new Error('Downloaded Dataview cache must stay inside core\'s .cache directory.');
  const parent=path.dirname(directory);await fs.mkdir(parent,{recursive:true});
  const realParent=await fs.realpath(parent),realRoot=await fs.realpath(ROOT);
  if(!isInside(realRoot,realParent))throw new Error('Dataview cache parent resolves outside core.');
  let temporary=await fs.mkdtemp(path.join(realParent,'dataview-stage-'));
  try {
    log('Downloading pinned Dataview '+release.version+' from GitHub…');
    const files=await Promise.all(Object.keys(release.hashes).map(async name=>{
      const url=release.url+'/'+name;
      try {
        const response=await fetchImpl(url,{signal:AbortSignal.timeout(60000)});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const bytes=Buffer.from(await response.arrayBuffer());
        if(sha256(bytes)!==release.hashes[name])throw new Error('SHA-256 checksum mismatch');
        return {name,bytes};
      } catch(error){throw new Error('Cannot download pinned Dataview '+release.version+' '+name+': '+error.message+'. A verified cache or explicit --dataview-directory is required offline.',{cause:error});}
    }));
    for(const {name,bytes} of files)await fs.writeFile(path.join(temporary,name),bytes,{flag:'wx'});
    await verifyRelease(temporary,release);
    try{await fs.rename(temporary,directory);temporary=undefined;}
    catch(error){
      // Another process may have installed the same verified release meanwhile.
      try{await verifyRelease(directory,release);}catch{throw error;}
    }
    log('Cached verified Dataview '+release.version+'.');return directory;
  } finally {
    if(temporary) {
      const resolved=await fs.realpath(temporary);
      if(path.dirname(resolved)!==realParent || !isInside(realRoot,resolved) || !path.basename(resolved).startsWith('dataview-stage-'))throw new Error('Refusing to remove an unexpected Dataview staging directory.');
      await fs.rm(resolved,{recursive:true,force:true});
    }
  }
}

export async function ensureCachedDataview({directory=DEFAULT_DATAVIEW_DIRECTORY,release=DATAVIEW_RELEASE,fetchImpl=globalThis.fetch,log=()=>{}}={}) {
  directory=path.resolve(directory);
  const key=directory+'\0'+JSON.stringify(release);
  if(pending.has(key))return pending.get(key);
  const task=prepareCache(directory,{release,fetchImpl,log});pending.set(key,task);
  try{return await task;}finally{pending.delete(key);}
}
