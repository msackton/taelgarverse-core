import {queryIndex,indexHasResults} from '../../../src/indexes.mjs';

// Metadata changes replace the runtime snapshot, dropping its cached queries.
// This author-only cache never serves website requests or crosses date/source views.
const indexSnapshots=new WeakMap();
const MAX_INDEX_QUERIES=32;
function indexState(snapshot) {
  let state=indexSnapshots.get(snapshot.runtime);
  if(!state) {
    state={pages:new Map(snapshot.runtime.pages.map(page=>[page.path,page])),queries:new Map()};
    indexSnapshots.set(snapshot.runtime,state);
  }
  return state;
}
const indexKey=(options,sourcePath,date)=>JSON.stringify([sourcePath,options.type,options.target,options.recursive ?? options.type!=='members',options.placeType,date]);
const indexContext=(app,state,sourcePath,date)=>({date,sourcePath,resolve:(target,source)=>{
  const file=app.metadataCache.getFirstLinkpathDest(target,source);
  return file && state.pages.get(file.path);
}});
export function obsidianIndexExists(app,snapshot,options,sourcePath,date) {
  const state=indexState(snapshot),cached=state.queries.get(indexKey(options,sourcePath,date));
  return cached ? cached.items.length>0 : indexHasResults(snapshot.runtime,options,indexContext(app,state,sourcePath,date));
}
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
