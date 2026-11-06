import {runtimeHash} from './runtime-format.mjs';
import {bucketText,cacheTimeoutMs,storageTimeoutMs,withTimeout,objectText,timingLog} from './runtime-io.mjs';
import {RenderError} from './common.mjs';

const invalid=()=>new RenderError(503,'Compiled content snapshot is missing or invalid');
// These keys are private Cache API entries, not HTTP routes. All campaign hosts
// use the same immutable bytes; visibility still runs after loading the data.
const cacheKey=(revision,descriptor)=>new Request('https://taelgar.org/.taelgarverse-cache/snapshots/v1/'+revision+'/'+descriptor.sha256+'/'+descriptor.file);

export async function readSnapshotPart(bucket,revision,descriptor,{
  cache=globalThis.caches?.default,timeoutMs=storageTimeoutMs,cacheMs=cacheTimeoutMs,log=timingLog,
}={}){
  const started=performance.now(),key=cacheKey(revision,descriptor);
  let source='r2',status='ok',edge='disabled',write='skipped';
  const phases={},measure=async(name,operation)=>{
    const start=performance.now();
    try{return await operation();}finally{phases[name]=Math.round((performance.now()-start)*10)/10;}
  };
  const decode=text=>{
    if(text===null || runtimeHash(text)!==descriptor.sha256)throw invalid();
    return JSON.parse(text);
  };
  try{
    if(cache){
      try{
        const text=await measure('cache-read',()=>withTimeout(async signal=>{
          const response=await cache.match(key);
          return objectText(response,signal);
        },cacheMs));
        edge=text===null?'miss':'hit';
        if(text!==null){const value=decode(text);source='edge';return value;}
      }catch(error){
        edge=error.name==='RequestTimeout'?'timeout':'error';
        // A corrupt/unavailable cache must not poison the validated R2 source.
        // A later verified put replaces this entry without a delete/write race.
      }
    }
    const text=await measure('r2',()=>bucketText(bucket,'revisions/'+revision+'/'+descriptor.file,timeoutMs));
    const value=decode(text);
    if(cache){
      // Bounded write-through finishes before sharing the result across
      // requests. No first-request ExecutionContext is kept in the snapshot.
      const response=new Response(text,{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=86400'}});
      try{await measure('cache-write',()=>withTimeout(async signal=>{
        signal.addEventListener('abort',()=>{response.body?.cancel().catch(()=>{});},{once:true});
        await cache.put(key,response);
      },cacheMs));write='stored';}catch(error){write=error.name==='RequestTimeout'?'timeout':'error';}
    }
    return value;
  }catch(error){status=error.name==='RequestTimeout'?'timeout':'error';throw error;}
  finally{
    // Classify shards without logging note names, object keys or content.
    const part=descriptor.file.split('/')[1].replace(/\.json$/,'');
    log({event:'snapshot-read',part,source,edge,write,status,ms:Math.round((performance.now()-started)*10)/10,phases});
  }
}
