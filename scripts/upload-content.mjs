import fs from 'node:fs/promises';
import {validatePublicationUploads} from './content-retention.mjs';
import {saveDerivativeManifest} from './derivative-cache.mjs';

// The caller holds the publication lock until upload, activation and cleanup
// finish. Remote inventory, not local receipts, is the authority on each run.
export async function uploadContent(report,storage,{assetsOnly=false,log=()=>{},concurrency=4}={}){
  const uploads=validatePublicationUploads(report.revision,JSON.parse(await fs.readFile(report.manifestFile,'utf8')));
  if(!Number.isInteger(concurrency) || concurrency<1 || concurrency>8)throw new Error('Upload concurrency must be 1–8');
  const assets=uploads.filter(item=>item.key.startsWith('assets/'));
  const snapshots=uploads.filter(item=>!item.key.startsWith('assets/'));
  const present=new Map((assets.length?await storage.list('assets/'):[]).map(object=>[object.key,object.size]));
  const missing=[];let reused=0;
  for(const item of assets){
    const size=item.remoteOnly ? item.size : (await fs.stat(item.file)).size;
    if(!Number.isSafeInteger(size) || size<0)throw new Error('Invalid asset size: '+item.key);
    if(present.get(item.key)===size)reused++;
    else if(item.remoteOnly)throw new Error('Cached derivative is missing or has changed in the destination: '+item.key+'. Prepare the snapshot again to regenerate it.');
    else missing.push({...item,size});
  }
  log(`Assets: ${reused} already stored; ${missing.length} to upload (of ${assets.length}).`);
  const upload=async(items,label)=>{
    let next=0,completed=0,failure;
    // Drain in-flight writes before releasing the lock, even when one fails.
    await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
      while(!failure && next<items.length){
        const item=items[next++];
        try{
          await storage.putFile(item.key,item.file);completed++;
          if(completed%10===0 || completed===items.length)log(`${label}: uploaded ${completed}/${items.length}.`);
        }catch(error){failure ??=new Error(`${label} upload failed for ${item.key}: ${error.message} Completed assets remain reusable on the next run.`);}
      }
    }));
    if(failure)throw failure;
  };
  await upload(missing,'Assets');
  for(const item of missing)present.set(item.key,item.size);
  if(report.derivativeManifestFile){
    await saveDerivativeManifest(storage,JSON.parse(await fs.readFile(report.derivativeManifestFile,'utf8')),present);
    log('Saved reusable image and map recipes to R2.');
  }
  if(!assetsOnly)await upload(snapshots,'Notes and index');
  return {reusedAssets:reused,uploadedAssets:missing.length,uploadedSnapshots:assetsOnly?0:snapshots.length};
}
