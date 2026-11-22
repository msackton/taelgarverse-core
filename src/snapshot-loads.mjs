import {AsyncLocalStorage} from 'node:async_hooks';

const requestLoads=new AsyncLocalStorage();

export function withSnapshotLoads(operation) {
  return requestLoads.run(new Map(),operation);
}

// The isolate cache holds parsed values only. Pending I/O belongs to the
// invocation that started it, including when a client disconnects mid-read.
export function loadSnapshotValue(cache,key,read,limit=Infinity) {
  if(cache.has(key)){
    const value=cache.get(key);
    cache.delete(key);
    cache.set(key,value);
    return value;
  }
  const load=async()=>{
    const value=await read();
    if(!cache.has(key)){
      cache.set(key,value);
      if(cache.size>limit)cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  };
  const loads=requestLoads.getStore();
  if(!loads)return load();
  if(!loads.has(cache))loads.set(cache,new Map());
  const pending=loads.get(cache);
  if(!pending.has(key))pending.set(key,load().finally(()=>pending.delete(key)));
  return pending.get(key);
}
