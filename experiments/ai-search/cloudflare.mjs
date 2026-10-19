import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../../src/config.mjs';
import {PILOT_INSTANCE,OWNER} from './corpus.mjs';

export class CloudflareError extends Error {
  constructor(status,codes=[]){super('Cloudflare request failed: HTTP '+status+' (codes: '+codes.join(', ')+')');this.status=status;}
}
export function wranglerJSON(args,env=process.env,execute=execFileSync) {
  try{
    const stdout=execute(process.execPath,[path.join(ROOT,'node_modules/wrangler/bin/wrangler.js'),...args,'--json'],{
      cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:60000,
      env:{...env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_PATH:path.join(ROOT,'.cache/wrangler-logs')}});
    return JSON.parse(stdout);
  }catch{throw new Error('Wrangler authentication failed. Run the project-local wrangler whoami/login; credentials and raw command output have not been logged.');}
}
export function credentials(env=process.env) {
  let account=env.CLOUDFLARE_ACCOUNT_ID;
  if(!account){
    const local=path.join(ROOT,'wrangler.local.json');
    if(fs.existsSync(local))account=JSON.parse(fs.readFileSync(local,'utf8')).account_id;
  }
  if(!account){
    const info=wranglerJSON(['whoami'],env);
    if(info.accounts?.length!==1)throw new Error('Set CLOUDFLARE_ACCOUNT_ID to select the pilot account');
    account=info.accounts[0].id;
  }
  if(!/^[a-f0-9]{32}$/.test(account || ''))throw new Error('Invalid Cloudflare account ID');
  // Capture the supported Wrangler auth command in memory. Never print its
  // stdout, put the token on an argument list, or save it in pilot artifacts.
  const auth=env.CLOUDFLARE_API_TOKEN ? {token:env.CLOUDFLARE_API_TOKEN} : wranglerJSON(['auth','token'],env);
  if(!auth.token)throw new Error('Use a Cloudflare API token or Wrangler OAuth login; global API keys are unsupported');
  return {account,token:auth.token};
}

export class PilotClient {
  constructor({account,token,fetcher=fetch}) {
    if(!/^[a-f0-9]{32}$/.test(account || '') || !token)throw new Error('Missing pilot credentials');
    this.account=account;this.fetcher=fetcher;
    this.base='https://api.cloudflare.com/client/v4/accounts/'+account+'/ai-search/namespaces/default/instances';
    this.headers={Authorization:'Bearer '+token};
  }
  async request(suffix='',{method='GET',body,form,signal}={}) {
    let response;
    try{response=await this.fetcher(this.base+'/'+PILOT_INSTANCE+suffix,{method,redirect:'error',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
      headers:{...this.headers,...(!form && body ? {'Content-Type':'application/json'} : {})},body:form || (body ? JSON.stringify(body) : undefined)});}
    catch{throw new Error('Cloudflare request could not complete; remote state may be unchanged or still processing. Check status before retrying.');}
    let data;
    try{data=await response.json();}catch{throw new CloudflareError(response.status);}
    if(!response.ok || data.success===false)throw new CloudflareError(response.status,(data.errors || []).map(e=>e.code));
    return data;
  }
  async info(){return (await this.request()).result;}
  async ensure(){
    let info;
    try{info=await this.info();}catch(error){
      if(error.status!==404)throw error;
      const body={id:PILOT_INSTANCE,index_method:{vector:true,keyword:true},hybrid_search_enabled:true,fusion_method:'rrf',
        chunk_size:800,chunk_overlap:0,reranking:false,rewrite_query:false,cache:false,
        custom_metadata:['owner','run','view','sha256'].map(field_name=>({field_name,data_type:'text'}))};
      // Creation is the only collection-level write, always to the fixed pilot name.
      let response;
      try{response=await this.fetcher(this.base,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
        headers:{...this.headers,'Content-Type':'application/json'},body:JSON.stringify(body)});}
      catch{throw new Error('Pilot creation outcome unknown; check status before retrying');}
      const data=await response.json();
      if(!response.ok || data.success===false)throw new CloudflareError(response.status,(data.errors || []).map(e=>e.code));
      info=data.result;
    }
    const fields=new Set((info.custom_metadata || []).filter(f=>f.data_type==='text').map(f=>f.field_name));
    if(info.source || (info.type && info.type!=='builtin') || info.sources?.some(s=>s.type!=='builtin') ||
       !['owner','run','view','sha256'].every(f=>fields.has(f)) || Number(info.chunk_overlap)!==0 ||
       info.index_method?.vector===false || info.index_method?.keyword===false){
      throw new Error('Existing pilot instance has incompatible configuration; inspect it before uploading');
    }
    return info;
  }
  async list(){
    const items=[];
    for(let page=1;page<=200;page++){
      const data=await this.request('/items?per_page=50&page='+page+'&source=builtin');
      if(!Array.isArray(data.result))throw new Error('Unexpected Cloudflare items response');
      items.push(...data.result);
      if(data.result.length<50 || items.length>=data.result_info?.total_count)return items;
    }
    throw new Error('Pilot instance unexpectedly contains more than 10,000 items');
  }
  async upload(doc){
    const form=new FormData();form.set('file',new Blob([doc.text],{type:'text/plain'}),doc.key);
    form.set('metadata',JSON.stringify(doc.metadata));
    return (await this.request('/items',{method:'POST',form})).result;
  }
  async item(id){return (await this.request('/items/'+encodeURIComponent(id))).result;}
  async remove(item){
    if(!owned(item))throw new Error('Refusing to delete a document outside the pilot namespace');
    await this.request('/items/'+encodeURIComponent(item.id),{method:'DELETE'});
  }
  async search(body,{signal}={}){const data=await this.request('/search',{method:'POST',body,signal});return data.result ?? data;}
  async stats(){return (await this.request('/stats')).result;}
}
export const owned=item=>item.source_id==='builtin' && item.key?.startsWith('tvpilot/') && item.metadata?.owner===OWNER;
