import path from 'node:path';
import {ROOT} from '../src/config.mjs';
import {searchCredentials} from './search-database.mjs';
import {validateSearchDescriptor} from './search-index.mjs';

export const POINTER_KEY='published/current.json';
const revisionPattern=/^[a-f0-9]{64}$/;
const assetPattern=/^assets\/[a-f0-9]{64}$/;
const snapshotPattern=/^revisions\/([a-f0-9]{64})\/(?:index\.json|notes\/[a-f0-9]{2}\.json)$/;

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
export async function createRetentionStorage(config,{local=false,persistTo=path.join(ROOT,'.wrangler/state'),fetcher=fetch,credentials=searchCredentials}={}){
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
        putPointer:async pointer=>{validatePointer(pointer);await r2.put(POINTER_KEY,JSON.stringify(pointer)+'\n',{httpMetadata:{contentType:'application/json'}});},
        async list(prefix){const objects=[];let cursor;do{const page=await r2.list({prefix,cursor,limit:1000});objects.push(...page.objects);cursor=page.truncated?page.cursor:undefined;}while(cursor);return objects;},
        delete:keys=>r2.delete(keys),close:()=>mf.dispose()};
    }catch(error){await mf.dispose();throw error;}
  }
  const {account,token}=credentials(config),base=`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects`;
  const request=async(suffix,method='GET',body)=>{
    let response;
    try{response=await fetcher(base+suffix,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body});}
    catch{throw new Error('R2 retention request did not complete; retry publication to resume cleanup');}
    if(response.status===404 && method==='GET' && suffix.startsWith('/')){
      // Object-404 bodies vary across API deployments. Confirm the bucket
      // exists rather than mistaking an account/bucket failure for first build.
      let info;
      try{
        const check=await fetcher(base.slice(0,-'/objects'.length),{redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token}});
        if(check.ok)info=await check.json();
      }catch{throw new Error('Could not verify the R2 bucket after an object-404');}
      if(info?.success===true && info.result?.name===bucket)return null;
    }
    if(!response.ok)throw new Error('R2 retention request failed (HTTP '+response.status+')');
    return response;
  };
  return {
    async getJSON(key){const response=await request('/'+key.split('/').map(encodeURIComponent).join('/'));return response?response.json():null;},
    async putPointer(pointer){validatePointer(pointer);await request('/'+POINTER_KEY,'PUT',JSON.stringify(pointer)+'\n');},
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
      for(let offset=0;offset<keys.length;offset+=8){const result=await Promise.allSettled(keys.slice(offset,offset+8).map(key=>request('/'+key.split('/').map(encodeURIComponent).join('/'),'DELETE')));const failure=result.find(r=>r.status==='rejected');if(failure)throw failure.reason;}
    },close:async()=>{},
  };
}

// Caller holds the D1 publication lock throughout upload, activation and prune.
// Only a recorded successful pointer supplies rollback history; timestamps on
// unactivated uploads are never evidence that a snapshot was good.
export async function prunePublication(storage,index,pointer,{log=()=>{},dryRun=false}={}){
  validatePointer(pointer);
  if(pointer.retentionVersion!==1)throw new Error('Publish once with retention enabled before pruning legacy history');
  const assertCurrent=async()=>{if(JSON.stringify(await storage.getJSON(POINTER_KEY))!==JSON.stringify(pointer))throw new Error('Publication pointer changed; retention stopped');};
  await assertCurrent();
  const retained=[pointer,...(pointer.previous?[pointer.previous]:[])],keep=new Set();
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
    if(snapshot.search && JSON.stringify(snapshot.search)!==JSON.stringify(content.search))throw new Error('Retained search descriptor does not match R2');
    if(content.search)await index.verify(snapshot.revision,content.search);
  }
  const objects=[...await storage.list('revisions/'),...await storage.list('assets/')],present=new Set(objects.map(o=>o.key));
  for(const key of keep)if(!present.has(key))throw new Error('Retained R2 object is missing; cleanup stopped');
  const revisions=new Set(retained.map(s=>s.revision));
  const removed=objects.filter(o=>{const match=o.key.match(snapshotPattern);return match?!revisions.has(match[1]):assetPattern.test(o.key) && !keep.has(o.key);});
  const result={retained:[...revisions],deletedObjects:removed.length,deletedBytes:removed.reduce((sum,o)=>sum+(o.size || 0),0)};
  await assertCurrent();
  if(dryRun)return {...result,dryRun:true};
  // Delete D1 first. If R2 deletion fails the same two good snapshots survive
  // and the next unchanged publish retries the remaining object cleanup.
  await index.prune([...revisions]);
  for(let offset=0;offset<removed.length;offset+=500){await assertCurrent();await storage.delete(removed.slice(offset,offset+500).map(o=>o.key));}
  log(`Retention: ${retained.length} good snapshot(s); removed ${result.deletedObjects} R2 objects (${(result.deletedBytes/1048576).toFixed(1)} MiB).`);
  return result;
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
