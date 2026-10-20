import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT} from '../src/config.mjs';

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
export function searchCredentials(config,env=process.env,execute=execFileSync){
  const capture=args=>{
    try{return JSON.parse(execute(process.execPath,[path.join(ROOT,'node_modules/wrangler/bin/wrangler.js'),...args,'--json'],{
      cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:60000,
      env:{...env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}}));}
    catch{throw new Error('Cloudflare authentication failed; run the project-local wrangler whoami/login. Raw credential output was withheld.');}
  };
  const account=config.account_id || env.CLOUDFLARE_ACCOUNT_ID || (()=>{const info=capture(['whoami']);if(info.accounts?.length!==1)throw new Error('Select the publishing account in wrangler.local.json');return info.accounts[0].id;})();
  if(config.account_id && env.CLOUDFLARE_ACCOUNT_ID && config.account_id!==env.CLOUDFLARE_ACCOUNT_ID)throw new Error('Cloudflare account environment and publication config disagree');
  if(!/^[a-f0-9]{32}$/.test(account || ''))throw new Error('Invalid search publication account');
  const token=env.CLOUDFLARE_API_TOKEN || capture(['auth','token']).token;
  if(!token)throw new Error('Use a Cloudflare API token or Wrangler OAuth login');
  return {account,token};
}
export async function createSearchDatabase(config,{local=false,persistTo=path.join(ROOT,'.wrangler/state'),fetcher=fetch,credentials=searchCredentials}={}){
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
  const {account,token}=credentials(config),base='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+binding.database_id;
  const request=async body=>{
    let response,data;
    try{response=await fetcher(base+(body?'/query':''),{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
    catch{throw new Error('D1 search request did not complete; the publication pointer has not been advanced. Retry staging to resume.');}
    try{data=await response.json();}catch{throw new Error('Invalid D1 search response (HTTP '+response.status+')');}
    if(!response.ok || data.success===false || (Array.isArray(data.result) && data.result.some(r=>r.success===false)))throw new Error('D1 search request failed (HTTP '+response.status+'; codes '+(data.errors || []).map(e=>Number(e.code)).join(',')+')');
    return data.result;
  };
  const info=await request();
  if(info?.name!==binding.database_name || info?.uuid!==binding.database_id)throw new Error('D1 identity does not match the search publication destination');
  return {identity:account+':'+binding.database_id,query:statements=>request({batch:statements}),close:async()=>{}};
}
