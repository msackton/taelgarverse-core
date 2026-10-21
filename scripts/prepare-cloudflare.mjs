import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ROOT,loadSettings,isInside} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {normalizeHeader} from '../src/bio-block.mjs';
import {buildBacklinkIndex} from '../src/backlinks.mjs';
import {headerCoreRevision} from './header-core-revision.mjs';
import {repositoryVersion} from './repository-version.mjs';
import {compileSearch,searchDescriptor} from './compile-search.mjs';
import {prepareMaps} from './build-maps.mjs';
import {prepareImages} from './build-images.mjs';
import {collectImageUsages} from './image-usage.mjs';
import {readCampaignHomes} from '../src/website-sources.mjs';
import {CampaignSites} from '../src/campaign-sites.mjs';
import {Contexts} from '../src/contexts.mjs';
import {DerivativeCache} from './derivative-cache.mjs';
import {compileRuntime} from './compile-runtime.mjs';

const sha = value=>createHash('sha256').update(value).digest('hex');
const writeJSON = (file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value)+'\n');};
export function loadCloudflareConfig() {
  const config=JSON.parse(fs.readFileSync(path.join(ROOT,'wrangler.json'),'utf8'));
  const localFile=path.join(ROOT,'wrangler.local.json');
  const local=fs.existsSync(localFile) ? JSON.parse(fs.readFileSync(localFile,'utf8')) : {};
  for (const key of ['name','account_id','r2_buckets','d1_databases','limits']) if (local[key]) config[key]=local[key];
  return config;
}
async function hashFile(file) {
  const hash=createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function prepareContent(settings=loadSettings(),output=path.join(ROOT,'.cache/cloudflare'),sourceVersion=repositoryVersion(settings.vault_dir),imageOptions={},imageProgress,derivativeCache=new DerivativeCache(),{runtime=true}={}) {
  output=path.resolve(output);
  if (!isInside(ROOT,output) || output===ROOT) throw new Error('Content staging directory must be inside this project');
  const store=new Store(settings), shards=new Map(), uploads=[];
  // Use one header format before hashing, backlinks, search or media discovery.
  // This also accepts raw vault notes when no Dataview export is needed.
  for (const entry of store.entries) if (entry.note) {
    try { entry.note=normalizeHeader(entry.note); }
    catch (error) { throw new Error(entry.id + ': ' + error.message, {cause:error}); }
  }
  const homeSource=settings.home_source ? fs.readFileSync(settings.home_source,'utf8') : null;
  const registry=JSON.parse(fs.readFileSync(path.join(settings.vault_dir,'_scripts/session_note_campaigns.json'),'utf8'));
  const campaignHomes=readCampaignHomes(settings);
  new CampaignSites(campaignHomes,new Contexts(store,registry,settings));
  const usages=collectImageUsages(store,{homeSource,campaignHomes});
  const images=await prepareImages(store,path.join(ROOT,'.cache/images'),{...imageOptions,usages},undefined,imageProgress,derivativeCache);
  await prepareMaps(store,path.join(ROOT,'.cache/maps'),derivativeCache);
  const entries=[];
  for (const original of store.entries) {
    const {filename,note,remoteAsset,...entry}=original;
    if (note) {
      const shard=(Number.parseInt(sha(entry.id).slice(0,2),16)%32).toString(16).padStart(2,'0');
      const notes=shards.get(shard) || {};
      notes[entry.id]=note.source;shards.set(shard,notes);
      entry.note={metadata:note.metadata,shard,sha256:sha(note.source)};
    } else {
      const hash=remoteAsset ? remoteAsset.key.slice('assets/'.length) : await hashFile(filename);
      const cached=path.join(output,'objects',hash);
      if (!remoteAsset && !fs.existsSync(cached)) {
        fs.mkdirSync(path.dirname(cached),{recursive:true});
        const temporary=cached+'.tmp';
        fs.copyFileSync(filename,temporary);
        if (await hashFile(temporary)!==hash) throw new Error('Asset changed while packaging: '+entry.id+'; prepare the snapshot again');
        fs.renameSync(temporary,cached);
      }
      entry.size=remoteAsset ? remoteAsset.size : fs.statSync(cached).size;entry.sha256=hash;entry.etag='"'+hash+'"';entry.objectKey='assets/'+hash;
      uploads.push(remoteAsset ? {key:entry.objectKey,size:entry.size,remoteOnly:true} : {key:entry.objectKey,file:cached});entry.note=null;
    }
    entries.push(entry);
  }
  const backlinks=buildBacklinkIndex(store),searchManifest=compileSearch(store),search=searchDescriptor(searchManifest);
  const base={schemaVersion:1,sourceVersion:{commit:sourceVersion.commit,dirty:sourceVersion.dirty},settings:{default_date:settings.default_date,campaigns:settings.campaigns,respect_pov_dates:settings.respect_pov_dates === true},backlinks,
    registry,
    coreMeta:JSON.parse(fs.readFileSync(path.join(settings.vault_dir,'.obsidian/metadata.json'),'utf8')),
    navigationSource:settings.nav_source ? fs.readFileSync(settings.nav_source,'utf8') : null,
    homeSource,
    campaignHomes,
    search,warnings:[...store.warnings,...backlinks.warnings,...searchManifest.warnings],entries};
  const compiled=runtime ? compileRuntime(base,store) : null;
  if(compiled)base.runtime={version:1,digest:compiled.digest};
  const revision=sha(JSON.stringify(base)), prefix='revisions/'+revision;
  const directory=path.join(output,'revisions',revision);
  for (const [shard,notes] of shards) {
    const file=path.join(directory,'notes',shard+'.json');
    writeJSON(file,notes);uploads.push({key:prefix+'/notes/'+shard+'.json',file});
  }
  const index={...base,revision};
  const indexFile=path.join(directory,'index.json');writeJSON(indexFile,index);
  if(compiled){
    const file=path.join(directory,'runtime.json');writeJSON(file,{...compiled.manifest,revision});
    uploads.push({key:prefix+'/runtime.json',file});
    for(const [relative,json] of compiled.objects){
      const artifact=path.join(directory,relative);fs.mkdirSync(path.dirname(artifact),{recursive:true});fs.writeFileSync(artifact,json);
      uploads.push({key:prefix+'/'+relative,file:artifact});
    }
  }
  // Search text can include DM material. Keep the compiler payload local; only
  // its descriptor enters the R2 metadata index. D1 gets it via explicit stage.
  const searchFile=path.join(directory,'search.json');writeJSON(searchFile,searchManifest);
  uploads.push({key:prefix+'/index.json',file:indexFile});
  // A binary can occur at multiple vault paths. Upload its content only once.
  const unique=[...new Map(uploads.map(upload=>[upload.key,upload])).values()];
  const manifestFile=path.join(directory,'uploads.json');writeJSON(manifestFile,unique);
  const derivativeManifestFile=path.join(directory,'derivatives.json');writeJSON(derivativeManifestFile,derivativeCache.manifest(entries));
  const config=loadCloudflareConfig();
  config.main=path.join(ROOT,'src/worker.mjs');
  config.assets.directory=path.join(ROOT,'public');
  const configFile=path.join(output,'wrangler.json');writeJSON(configFile,config);
  const pointerFile=path.join(output,'current.json');writeJSON(pointerFile,{revision});
  const report={revision,indexFile,manifestFile,configFile,bucket:config.r2_buckets.find(b=>b.binding==='CONTENT').bucket_name,
    notes:entries.filter(e=>e.note).length,assets:entries.filter(e=>!e.note).length,objects:unique.length,
    assetBytes:entries.filter(e=>!e.note).reduce((sum,e)=>sum+e.size,0),pointerFile,headerRevision:headerCoreRevision(),search,searchFile,searchStats:searchManifest.stats,images,
    derivativeManifestFile,derivativeCacheHits:{...derivativeCache.hits}};
  writeJSON(path.join(output,'latest.json'),report);
  return report;
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const report=await prepareContent();
  console.log(JSON.stringify(report,null,2));
}
