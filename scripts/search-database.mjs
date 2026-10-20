import path from 'node:path';
import {ROOT} from '../src/config.mjs';
import {createCloudflareClient,searchCredentials} from './cloudflare-client.mjs';
export {searchCredentials} from './cloudflare-client.mjs';

export const SEARCH_BINDING='SEARCH_DB';
export const SEARCH_DATABASE='taelgarverse-search';
const localId='00000000-0000-4000-8000-000000000001';
export function searchBinding(config,{local=false}={}){
  const bindings=(config.d1_databases || []).filter(d=>d.binding===SEARCH_BINDING);
  if(bindings.length>1)throw new Error('Configure exactly one SEARCH_DB binding');
  const binding=bindings[0] || (local?{binding:SEARCH_BINDING,database_name:SEARCH_DATABASE,database_id:localId}:null);
  if(!binding || binding.database_name!==SEARCH_DATABASE || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(binding.database_id || '') || binding.remote)throw new Error('Configure SEARCH_DB with the taelgarverse-search D1 name and explicit database_id before publishing');
  return binding;
}
export async function createSearchDatabase(config,{local=false,persistTo=path.join(ROOT,'.wrangler/state'),fetcher=fetch,credentials=searchCredentials,client}={}){
  const binding=searchBinding(config,{local});
  if(local){
    const {Miniflare,convertV4MiniflareOptions}=await import('miniflare');
    // Match the pinned Wrangler's D1 execute/dev adapter and persistence layout.
    const options=convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("Local search storage",{status:404})}}',
      compatibilityDate:'2026-10-19',host:'127.0.0.1',port:0,cf:false,d1Databases:{[SEARCH_BINDING]:binding.database_id},resourcePersistencePath:path.join(persistTo,'v3')});
    const mf=new Miniflare({...options,telemetry:{enabled:false}});
    try{
      const db=await mf.getD1Database(SEARCH_BINDING);
      return {identity:'local:'+binding.database_id,query:statements=>db.batch(statements.map(({sql,params=[]})=>db.prepare(sql).bind(...params))),close:()=>mf.dispose()};
    }catch(error){await mf.dispose();throw error;}
  }
  client ??=await createCloudflareClient(config,{fetcher,credentials});
  const account=client.account,base='/d1/database/'+binding.database_id;
  const request=async body=>{
    const response=await client.request(base+(body?'/query':''),()=>({method:body?'POST':'GET',
      headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined}),{retry:!body});
    let data;
    try{data=await response.json();}catch{throw new Error('Invalid D1 search response (HTTP '+response.status+')');}
    if(!response.ok || data.success===false || (Array.isArray(data.result) && data.result.some(r=>r.success===false)))throw new Error('D1 search request failed (HTTP '+response.status+'; codes '+(data.errors || []).map(e=>Number(e.code)).join(',')+')');
    return data.result;
  };
  const info=await request();
  if(info?.name!==binding.database_name || info?.uuid!==binding.database_id)throw new Error('D1 identity does not match the search publication destination');
  return {identity:account+':'+binding.database_id,query:statements=>request({batch:statements}),close:async()=>{}};
}
