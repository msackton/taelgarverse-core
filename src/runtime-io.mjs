import {RenderError} from './common.mjs';

export const storageTimeoutMs=4000;
export const cacheTimeoutMs=250;
export class RequestTimeout extends RenderError {
  constructor(){super(503,'This request took too long. Please try again.');this.name='RequestTimeout';}
}

// R2 and D1 bindings cannot abort a pending call. Stop waiting, observe its
// eventual rejection, and let callers release any body that arrives late.
// Commit loaded values to shared in-memory state only AFTER this resolves:
// an unabortable loader can still finish after its deadline.
export function withTimeout(operation,timeoutMs=storageTimeoutMs) {
  const controller=new AbortController();
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{const error=new RequestTimeout();reject(error);controller.abort(error);},timeoutMs);
  });
  const pending=Promise.resolve().then(()=>operation(controller.signal));
  return Promise.race([pending,deadline]).finally(()=>clearTimeout(timer));
}

export function discardBody(object){try{object?.body?.cancel().catch(()=>{});}catch{}}

export async function objectText(object,signal) {
  if(signal.aborted){discardBody(object);throw signal.reason;}
  if(!object)return null;
  // Cancel the reader, including an in-progress body read, when the deadline
  // expires. Calling body.cancel() after text() locks it would not release it.
  if(object.body?.getReader){
    const reader=object.body.getReader(),decoder=new TextDecoder(),chunks=[];
    const abort=()=>{reader.cancel().catch(()=>{});};
    signal.addEventListener('abort',abort,{once:true});
    try{
      while(true){
        const {done,value}=await reader.read();
        signal.throwIfAborted();
        if(done)break;
        chunks.push(decoder.decode(value,{stream:true}));
      }
      chunks.push(decoder.decode());return chunks.join('');
    }finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
  }
  const text=object.text ? await object.text() : JSON.stringify(await object.json());
  signal.throwIfAborted();return text;
}

export function bucketText(bucket,key,timeoutMs=storageTimeoutMs){
  return withTimeout(async signal=>objectText(await bucket.get(key),signal),timeoutMs);
}

export const timingLog=record=>console.log(JSON.stringify(record));
export function timings(log=timingLog) {
  const started=performance.now(),phases={},failures={},active=new Map();
  let finished=false;
  return {
    async measure(name,operation){
      const start=performance.now();
      active.set(name,(active.get(name) || 0)+1);
      try{return await operation();}
      catch(error){if(!finished)failures[name]=error instanceof RequestTimeout?'timeout':'error';throw error;}
      finally{
        active.set(name,active.get(name)-1);
        if(!finished)phases[name]=Math.round(((phases[name] || 0)+performance.now()-start)*10)/10;
      }
    },
    finish(route,status){
      finished=true;
      const ms=Math.round((performance.now()-started)*10)/10;
      // Fixed route categories only: never URLs, queries, excerpts or errors.
      if(['article','home','search','navigation'].includes(route) || status>=500 || ms>=1000)
        log({event:'request-timing',route,status,ms,phases,failures,pending:[...active].filter(([,count])=>count>0).map(([name])=>name)});
    },
  };
}
