import path from 'node:path';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {ROOT} from '../src/config.mjs';
import {createCloudflareClient,searchCredentials} from './cloudflare-client.mjs';
import {validateSearchDescriptor} from './search-index.mjs';
import {DERIVATIVE_MANIFEST_KEY,manifestRecords} from './derivative-cache.mjs';
import {withPublicationProgress} from './publication-progress.mjs';
import {validRuntimeDescriptor,runtimeHash,supportedRuntimeVersion} from '../src/runtime-format.mjs';

export const POINTER_KEY='published/current.json';
const revisionPattern=/^[a-f0-9]{64}$/;
const assetPattern=/^assets\/[a-f0-9]{64}$/;
const snapshotPattern=/^revisions\/([a-f0-9]{64})\/(?:index\.json|runtime\.json|notes\/[a-f0-9]{2}\.json|runtime\/(?:render|navigation|headers|backlinks|search-metadata|assets\/[a-f0-9]{2}|(?:notes|backlinks)\/[0-9]{4,})\.json)$/;

export function validatePublicationUploads(revision,uploads){
  if(!revisionPattern.test(revision || '') || !Array.isArray(uploads) || !uploads.length || uploads.some(item=>{
    const match=typeof item?.key==='string'?item.key.match(snapshotPattern):null;
    return !assetPattern.test(item?.key || '') && (!match || match[1]!==revision);
  }))throw new Error('Upload manifest contains unexpected object keys; use only this snapshot and content-addressed assets');
  return uploads;
}

export function validatePointer(pointer){
  if(!revisionPattern.test(pointer?.revision || ''))throw new Error('Invalid publication revision');
  if(pointer.search)validateSearchDescriptor(pointer.search);
  if(pointer.previous){
    if(!revisionPattern.test(pointer.previous.revision || '') || pointer.previous.revision===pointer.revision || pointer.previous.previous)throw new Error('Invalid previous publication snapshot');
    if(pointer.previous.search)validateSearchDescriptor(pointer.previous.search);
  }
  return pointer;
}
export function activationPointer(current,next){
  validatePointer(next);if(current)validatePointer(current);
  const {previous:ignored,retentionVersion:ignoredVersion,...snapshot}=current || {};
  const previous=current?.revision===next.revision?current.previous:current?snapshot:undefined;
  return validatePointer({...next,retentionVersion:1,...(previous?{previous}:{})});
}

// Same account/bucket as publication. Remote operations use the documented R2
// object API; local operations share Wrangler's persisted Miniflare bucket.
export async function createRetentionStorage(config,{local=false,persistTo=path.join(ROOT,'.wrangler/state'),fetcher=fetch,credentials=searchCredentials,client,wait,log=()=>{}}={}){
  const bindings=config.r2_buckets?.filter(b=>b.binding==='CONTENT');
  if(bindings?.length!==1 || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(bindings[0].bucket_name || '') || bindings[0].jurisdiction || bindings[0].remote)throw new Error('Retention requires one standard CONTENT bucket');
  const bucket=bindings[0].bucket_name;
  if(local){
    const {Miniflare,convertV4MiniflareOptions}=await import('miniflare');
    const options=convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("Retention storage",{status:404})}}',
      compatibilityDate:'2026-10-19',host:'127.0.0.1',port:0,cf:false,r2Buckets:{CONTENT:bucket},resourcePersistencePath:path.join(persistTo,'v3')});
    const mf=new Miniflare({...options,telemetry:{enabled:false}});
    try{
      const r2=await mf.getR2Bucket('CONTENT');
      return {getJSON:async key=>(await r2.get(key))?.json() ?? null,
        putFile:async(key,file)=>{await r2.put(key,await fs.readFile(file));},
        putPointer:async pointer=>{validatePointer(pointer);await r2.put(POINTER_KEY,JSON.stringify(pointer)+'\n',{httpMetadata:{contentType:'application/json'}});},
        putDerivativeManifest:async manifest=>{await r2.put(DERIVATIVE_MANIFEST_KEY,JSON.stringify({schemaVersion:1,records:manifestRecords(manifest)}),{httpMetadata:{contentType:'application/json'}});},
        async list(prefix){const objects=[];let cursor;do{const page=await r2.list({prefix,cursor,limit:1000});objects.push(...page.objects);cursor=page.truncated?page.cursor:undefined;}while(cursor);return objects;},
        delete:keys=>r2.delete(keys),close:()=>mf.dispose()};
    }catch(error){await mf.dispose();throw error;}
  }
  client ??=await createCloudflareClient(config,{fetcher,credentials,wait,log});
  const base=`/r2/buckets/${bucket}/objects`;
  const request=async(suffix,method='GET',body)=>{
    const response=await client.request(base+suffix,()=>({method,headers:body?{'Content-Type':'application/json'}:{},body}),{retry:true});
    if(response.status===404 && method==='GET' && suffix.startsWith('/')){
      // Confirm the bucket exists; missing accounts/buckets are not first builds.
      await response.body?.cancel();
      const check=await client.request(base.slice(0,-'/objects'.length),()=>({method:'GET'}),{retry:true});
      const info=check.ok?await check.json():null;
      if(info?.success===true && info.result?.name===bucket)return null;
    }
    if(!response.ok){await response.body?.cancel();throw new Error('R2 request failed (HTTP '+response.status+')');}
    return response;
  };
  return {
    async getJSON(key){const response=await request('/'+key.split('/').map(encodeURIComponent).join('/'));return response?response.json():null;},
    async putPointer(pointer){validatePointer(pointer);const response=await request('/'+POINTER_KEY,'PUT',JSON.stringify(pointer)+'\n');await response.body?.cancel();},
    async putDerivativeManifest(manifest){const response=await request('/'+DERIVATIVE_MANIFEST_KEY,'PUT',JSON.stringify({schemaVersion:1,records:manifestRecords(manifest)}));await response.body?.cancel();},
    async putFile(key,file){
      if(!assetPattern.test(key) && !snapshotPattern.test(key))throw new Error('Invalid immutable upload key');
      const {size}=await fs.stat(file);
      if(size>300000000)throw new Error('R2 REST uploads are limited to 300 MB per object: '+key);
      const response=await client.request(base+'/'+key.split('/').map(encodeURIComponent).join('/'),()=>({
        method:'PUT',body:createReadStream(file),duplex:'half',headers:{'Content-Length':String(size)},
      }),{retry:true,timeoutMs:300000});
      await response.body?.cancel();
      if(!response.ok)throw new Error('R2 upload failed for '+key+' (HTTP '+response.status+')');
    },
    async list(prefix){
      const objects=[],seen=new Set();let cursor,startAfter;
      do{
        const query=new URLSearchParams({prefix,per_page:'1000',...(cursor?{cursor}:{}),...(startAfter?{start_after:startAfter}:{})});
        const data=await (await request('?'+query)).json();
        if(data.success!==true || !Array.isArray(data.result) || data.result.some(o=>typeof o.key!=='string' || !o.key.startsWith(prefix)))throw new Error('Invalid R2 retention listing');
        if(startAfter && data.result.some(o=>o.key<=startAfter))throw new Error('Incomplete R2 retention pagination');
        objects.push(...data.result);
        if(data.result_info){
          if(typeof data.result_info.is_truncated!=='boolean')throw new Error('Invalid R2 retention pagination');
          cursor=data.result_info.is_truncated?data.result_info.cursor:undefined;startAfter=undefined;
          if(data.result_info.is_truncated && (!cursor || seen.has(cursor)))throw new Error('Incomplete R2 retention pagination');
          seen.add(cursor);
        }else{
          // Some R2 API deployments omit result_info. Walk start_after until an
          // empty page instead of assuming a short page contains every object.
          cursor=undefined;startAfter=data.result.length?data.result.map(o=>o.key).sort().at(-1):undefined;
        }
      }while(cursor || startAfter);return objects;
    },
    async delete(keys){
      // Bounded parallelism; retries are idempotent after a partial failure.
      for(let offset=0;offset<keys.length;offset+=8){const result=await Promise.allSettled(keys.slice(offset,offset+8).map(async key=>{const response=await request('/'+key.split('/').map(encodeURIComponent).join('/'),'DELETE');await response.body?.cancel();}));const failure=result.find(r=>r.status==='rejected');if(failure)throw failure.reason;}
    },close:async()=>{},
  };
}

// Caller holds the D1 publication lock throughout upload, activation and prune.
// Only a recorded successful pointer supplies rollback history; timestamps on
// unactivated uploads are never evidence that a snapshot was good.
export async function prunePublication(storage,index,pointer,{log=()=>{},dryRun=false}={}){
  return withPublicationProgress(dryRun?'Retention inspection':'Retention cleanup',async progress=>{
    validatePointer(pointer);
    if(pointer.retentionVersion!==1)throw new Error('Publish once with retention enabled before pruning legacy history');
    const assertCurrent=async()=>{if(JSON.stringify(await storage.getJSON(POINTER_KEY))!==JSON.stringify(pointer))throw new Error('Publication pointer changed; retention stopped');};
    await assertCurrent();
    const retained=[pointer,...(pointer.previous?[pointer.previous]:[])],keep=new Set();
    progress(`Retention: verifying ${retained.length} retained snapshot(s).`);
    for(const snapshot of retained){
      const key=`revisions/${snapshot.revision}/index.json`,content=await storage.getJSON(key);
      if(content?.schemaVersion!==1 || content.revision!==snapshot.revision || !Array.isArray(content.entries))throw new Error('Retained R2 snapshot is missing or invalid; cleanup stopped');
      keep.add(key);
      for(const entry of content.entries){
        if(entry.note){
          if(!/^[a-f0-9]{2}$/.test(entry.note.shard || ''))throw new Error('Invalid retained note shard');
          keep.add(`revisions/${snapshot.revision}/notes/${entry.note.shard}.json`);
        }else{
          if(!assetPattern.test(entry.objectKey || ''))throw new Error('Invalid retained asset key');
          keep.add(entry.objectKey);
        }
      }
      if(content.runtime){
        const prefix=`revisions/${snapshot.revision}/`,manifest=await storage.getJSON(prefix+'runtime.json');
        if(!supportedRuntimeVersion(manifest?.version) || manifest.revision!==snapshot.revision || !manifest.parts || !manifest.assets)throw new Error('Retained runtime manifest is missing or invalid; cleanup stopped');
        const descriptors=[...Object.values(manifest.parts),...Object.values(manifest.assets)];
        if(descriptors.some(value=>!validRuntimeDescriptor(value)) || !validRuntimeDescriptor(manifest.parts.render))throw new Error('Invalid retained runtime descriptor');
        const render=await storage.getJSON(prefix+manifest.parts.render.file);
        if(!render || runtimeHash(JSON.stringify(render))!==manifest.parts.render.sha256 || !Array.isArray(render.entries))throw new Error('Retained runtime render index is missing or invalid');
        if(manifest.version===1){
          for(const entry of render.entries)if(entry.note)descriptors.push(entry.note.prepared);
        }else{
          if(!Array.isArray(render.noteShards) || render.entries.some(entry=>entry.note &&
            (!Number.isSafeInteger(entry.note.prepared) || entry.note.prepared<0 || !render.noteShards[entry.note.prepared])))throw new Error('Invalid retained note shard reference');
          descriptors.push(...render.noteShards);
          if(!validRuntimeDescriptor(manifest.parts.backlinks))throw new Error('Invalid retained backlink descriptor');
          const backlinks=await storage.getJSON(prefix+manifest.parts.backlinks.file);
          if(!backlinks || runtimeHash(JSON.stringify(backlinks))!==manifest.parts.backlinks.sha256 || !Array.isArray(backlinks.shards) ||
            !Array.isArray(backlinks.targets) || backlinks.targets.some(([id,shard])=>!Number.isSafeInteger(id) || id<0 || !render.entries[id]?.note ||
              !Number.isSafeInteger(shard) || shard<0 || !backlinks.shards[shard]))throw new Error('Retained backlink index is missing or invalid');
          descriptors.push(...backlinks.shards);
        }
        if(descriptors.some(value=>!validRuntimeDescriptor(value)))throw new Error('Invalid retained prepared note descriptor');
        keep.add(prefix+'runtime.json');
        for(const descriptor of descriptors)keep.add(prefix+descriptor.file);
      }
      if(snapshot.search && JSON.stringify(snapshot.search)!==JSON.stringify(content.search))throw new Error('Retained search descriptor does not match R2');
      if(content.search)await index.verify(snapshot.revision,content.search);
    }
    progress('Retention: listing stored revisions.');
    const objects=await storage.list('revisions/');
    progress(`Retention: found ${objects.length} revision objects; listing assets.`);
    objects.push(...await storage.list('assets/'));
    const present=new Set(objects.map(o=>o.key));
    for(const key of keep)if(!present.has(key))throw new Error('Retained R2 object is missing; cleanup stopped');
    const revisions=new Set(retained.map(s=>s.revision));
    const removed=objects.filter(o=>{const match=o.key.match(snapshotPattern);return match?!revisions.has(match[1]):assetPattern.test(o.key) && !keep.has(o.key);});
    const result={retained:[...revisions],deletedObjects:removed.length,deletedBytes:removed.reduce((sum,o)=>sum+(o.size || 0),0)};
    await assertCurrent();
    if(dryRun)return {...result,dryRun:true};
    // Delete D1 first. If R2 deletion fails the same two good snapshots survive
    // and the next unchanged publish retries the remaining object cleanup.
    progress(`Retention: ${removed.length} obsolete R2 objects (${(result.deletedBytes/1048576).toFixed(1)} MiB); pruning old D1 search data and compacting its index.`);
    await index.prune([...revisions]);
    progress(`Retention R2 cleanup: 0/${removed.length} objects deleted.`);
    for(let offset=0;offset<removed.length;offset+=500){
      await assertCurrent();await storage.delete(removed.slice(offset,offset+500).map(o=>o.key));
      progress(`Retention R2 cleanup: ${Math.min(offset+500,removed.length)}/${removed.length} objects deleted.`);
    }
    log(`Retention: ${retained.length} good snapshot(s); removed ${result.deletedObjects} R2 objects (${(result.deletedBytes/1048576).toFixed(1)} MiB).`);
    return result;
  },log);
}

export async function rollbackPublication(storage,index,{log=()=>{}}={}){
  return index.withPublicationLock(async()=>{
    const current=await storage.getJSON(POINTER_KEY);validatePointer(current);
    if(!current.previous)throw new Error('No previous good publication is recorded');
    // Check both content and search before touching the live pointer.
    await prunePublication(storage,index,current,{dryRun:true});
    const pointer=activationPointer(current,{...current.previous,completedAt:new Date().toISOString()});
    await storage.putPointer(pointer);
    try{await prunePublication(storage,index,pointer,{log});}
    catch(error){throw new Error('Rollback is active, but cleanup failed; run content:prune: '+error.message);}
    return pointer;
  });
}
