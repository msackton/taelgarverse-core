import {queryIndex} from '../../../src/indexes.mjs';

// Metadata changes replace the runtime snapshot, dropping its cached queries.
// This author-only cache never serves website requests or crosses date/source views.
const indexSnapshots=new WeakMap();
const MAX_INDEX_QUERIES=32;
function indexState(snapshot) {
  let state=indexSnapshots.get(snapshot.runtime);
  if(!state) {
    state={
      pages:new Map(snapshot.runtime.pages.map(page=>[page.path,page])),
      resolveAlias:snapshot.runtime.resolveAlias,
      queries:new Map(),
    };
    indexSnapshots.set(snapshot.runtime,state);
  }
  return state;
}
const indexKey=(options,sourcePath,date)=>JSON.stringify([sourcePath,date,options]);
const indexContext=(app,state,sourcePath,date)=>({date,sourcePath,resolve:(target,source)=>{
  const file=app.metadataCache.getFirstLinkpathDest(target,source);
  return file ? state.pages.get(file.path) : state.resolveAlias(target);
}});
export function obsidianIndex(app,snapshot,options,sourcePath,date) {
  const state=indexState(snapshot),key=indexKey(options,sourcePath,date);
  let result=state.queries.get(key);
  if(result)state.queries.delete(key);
  else result=queryIndex(snapshot.runtime,options,indexContext(app,state,sourcePath,date));
  state.queries.set(key,result);
  if(state.queries.size>MAX_INDEX_QUERIES)state.queries.delete(state.queries.keys().next().value);
  // Image URLs and other host additions belong to this render, not the cache.
  return structuredClone(result);
}
