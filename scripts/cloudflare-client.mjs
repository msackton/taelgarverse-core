import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {ROOT} from '../src/config.mjs';

export function searchCredentials(config,env=process.env,execute=execFileSync){
  const capture=args=>{
    try{return JSON.parse(execute(process.execPath,[path.join(ROOT,'node_modules/wrangler/bin/wrangler.js'),...args,'--json'],{
      cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:60000,
      env:{...env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}}));}
    catch{throw new Error('Cloudflare authentication failed; run npx wrangler login. Raw credential output was withheld.');}
  };
  const account=config.account_id || env.CLOUDFLARE_ACCOUNT_ID || (()=>{const info=capture(['whoami']);if(info.accounts?.length!==1)throw new Error('Select the publishing account in wrangler.local.json');return info.accounts[0].id;})();
  if(config.account_id && env.CLOUDFLARE_ACCOUNT_ID && config.account_id!==env.CLOUDFLARE_ACCOUNT_ID)throw new Error('Cloudflare account environment and publication config disagree');
  if(!/^[a-f0-9]{32}$/.test(account || ''))throw new Error('Invalid search publication account');
  const token=env.CLOUDFLARE_API_TOKEN || capture(['auth','token']).token;
  if(!token)throw new Error('Use a Cloudflare API token or Wrangler OAuth login');
  return {account,token};
}

// One session can serve R2 and D1. Never print token values or upstream bodies.
// Only replay requests explicitly marked safe; a D1 write may have committed
// even when its response was lost, so network/5xx retries are opt-in.
export async function createCloudflareClient(config,{fetcher=fetch,credentials=searchCredentials,
  wait=sleep,now=Date.now,log=()=>{},intervalMs=300}={}){
  let auth=await credentials(config),checkedAt=now(),refreshing,nextRequest=0;
  const account=auth.account;
  const refresh=async used=>{
    if(used && auth.token!==used)return;
    if(!refreshing)refreshing=(async()=>{
      const next=await credentials({...config,account_id:account});
      if(next.account!==account)throw new Error('Cloudflare account changed during publication; stopped before using the new credentials');
      auth=next;checkedAt=now();
    })().finally(()=>{refreshing=null;});
    await refreshing;
  };
  const requestScoped=async(scope,resource,makeInit=()=>({}),{retry=false,timeoutMs=30000}={})=>{
    if(!resource.startsWith('/') || resource.startsWith('//'))throw new Error('Invalid Cloudflare resource path');
    let refreshed=false;
    for(let attempt=0;;attempt++){
      // Pace all requests in the session, leaving headroom below the REST API's
      // account-wide 1,200 requests per five minutes (including retry attempts).
      const start=Math.max(now(),nextRequest);nextRequest=start+intervalMs;
      if(start>now())await wait(start-now());
      if(now()-checkedAt>=60000)await refresh();
      const token=auth.token,init=await makeInit();let response,networkError=false;
      try{response=await fetcher('https://api.cloudflare.com/client/v4/'+scope+resource,{
        ...init,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{...init.headers,Authorization:'Bearer '+token}});}
      catch{networkError=true;}
      finally{init.body?.destroy?.();}
      if(response?.status===401 && !refreshed){
        await response.body?.cancel();refreshed=true;
        log('Cloudflare login expired or was rejected; reloading credentials and retrying once.');
        await refresh(token);continue;
      }
      if(response?.status===401 || response?.status===403){
        const status=response.status;await response.body?.cancel();
        throw new Error('Cloudflare authentication/permission failure (HTTP '+status+'). Run npx wrangler login, or check the API token permissions, then rerun publication.');
      }
      if(retry && attempt<4 && (networkError || response.status===429 || response.status>=500)){
        const header=response?.headers.get('retry-after');
        const retryAfter=header===null || header===undefined?0:/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:Math.max(0,Date.parse(header)-now()) || 0;
        const delay=Math.max(1000*2**attempt,Math.min(retryAfter,300000));
        await response?.body?.cancel();
        log('Cloudflare request interrupted'+(response?' (HTTP '+response.status+')':'')+'; retrying in '+Math.ceil(delay/1000)+'s.');
        await wait(delay);continue;
      }
      if(networkError)throw new Error('Cloudflare request did not complete. Rerun publication to resume; the request outcome may be unknown.');
      return response;
    }
  };
  return {account,
    request:(...args)=>requestScoped('accounts/'+account,...args),
    zoneRequest:(zone,...args)=>{
      if(!/^[a-f0-9]{32}$/.test(zone || ''))throw new Error('Invalid Cloudflare zone');
      return requestScoped('zones/'+zone,...args);
    },
  };
}
