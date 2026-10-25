import {validCampaignHost} from '../src/campaign-sites.mjs';
import {supportedRuntimeVersion} from '../src/runtime-format.mjs';

// Match the inventoried production destination, never a preview/alternate account.
// The WAF rule is provisioned separately; publishing does not enable protection.
export const HOSTNAME_POLICY=Object.freeze({
  account:'2328f3621c0a639572c74f537c5854c4',
  zone:'f32f02403c20a34cae5a18f9a04e131d',
  domain:'taelgar.org',worker:'taelgarverse',bucket:'taelgarverse-content',
  ref:'block_unconfigured_taelgar_hosts',
});
const revisionPattern=/^[a-f0-9]{64}$/;
const hostnamePattern=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*taelgar\.org$/;
const expressionFor=hosts=>'not (lower(http.host) in {'+[...hosts].sort().map(host=>JSON.stringify(host)).join(' ')+'})';

function ruleHosts(rule){
  // Only edit the known allowlist shape. Stop on manual policy changes instead
  // of guessing their meaning or overwriting unrelated security conditions.
  const match=/^not \(lower\(http\.host\) in \{((?:\s*"[a-z0-9.-]+"\s*)+)\}\)$/.exec(rule.expression || '');
  if(rule.action!=='block' || !match)throw new Error('Hostname firewall rule has an unexpected policy; inspect it before publishing');
  const hosts=[...match[1].matchAll(/"([a-z0-9.-]+)"/g)].map(value=>value[1]);
  if(hosts.some(host=>!hostnamePattern.test(host)))throw new Error('Hostname firewall allowlist contains an invalid Taelgar hostname');
  return new Set(hosts);
}

async function campaignHosts(storage,revision){
  if(!revisionPattern.test(revision || ''))throw new Error('Invalid hostname publication revision');
  const runtime=await storage.getJSON(`revisions/${revision}/runtime.json`);
  let labels;
  if(runtime!==null){
    if(runtime.revision!==revision || !supportedRuntimeVersion(runtime.version) || !Array.isArray(runtime.sites) ||
      runtime.sites.some(site=>!Array.isArray(site) || site.length!==2 || !site[1] || typeof site[1]!=='object'))throw new Error('Invalid published campaign host manifest');
    labels=runtime.sites.map(site=>site[0]);
  }else{
    const index=await storage.getJSON(`revisions/${revision}/index.json`);
    if(index?.revision!==revision || index.schemaVersion!==1 || (index.campaignHomes!==undefined &&
      (!index.campaignHomes || typeof index.campaignHomes!=='object' || Array.isArray(index.campaignHomes))))throw new Error('Invalid legacy campaign host manifest');
    labels=Object.keys(index.campaignHomes || {});
  }
  if(labels.some(label=>typeof label!=='string' || !validCampaignHost(label)))throw new Error('Invalid campaign hostname in publication');
  return labels.map(label=>label+'.'+HOSTNAME_POLICY.domain);
}

export async function syncPublicationHosts(config,client,storage,pointer,{log=()=>{}}={}){
  const policy=HOSTNAME_POLICY;
  if(config.name!==policy.worker || client.account!==policy.account ||
    config.r2_buckets?.find(binding=>binding.binding==='CONTENT')?.bucket_name!==policy.bucket)return {skipped:'different destination'};
  const entrypoint='/rulesets/phases/http_request_firewall_custom/entrypoint';
  const read=async()=>{
    const response=await client.zoneRequest(policy.zone,entrypoint,undefined,{retry:true});
    if(response.status===404){await response.body?.cancel();return null;}
    if(!response.ok){await response.body?.cancel();throw new Error('Could not read hostname firewall (HTTP '+response.status+'); content was not activated');}
    const data=await response.json(),ruleset=data.result;
    if(data.success!==true || !/^[a-f0-9]{32}$/.test(ruleset?.id || '') || ruleset.kind!=='zone' ||
      ruleset.phase!=='http_request_firewall_custom' || !Array.isArray(ruleset.rules))throw new Error('Invalid hostname firewall entrypoint');
    const matches=ruleset.rules.filter(rule=>rule.ref===policy.ref);
    if(matches.length>1)throw new Error('Duplicate hostname firewall rule; inspect it before publishing');
    const rule=matches[0];
    if(rule && !/^[a-f0-9]{32}$/.test(rule.id || ''))throw new Error('Invalid hostname firewall rule ID');
    return rule?{ruleset,rule}:null;
  };
  let state=await read();
  if(!state || state.rule.enabled!==true){
    log('Hostname firewall: no enabled managed rule; leaving edge settings unchanged.');
    return {skipped:'rule not enabled'};
  }
  ruleHosts(state.rule);
  const required=new Set(['taelgar.org','www.taelgar.org','characters.taelgar.org']);
  for(const revision of new Set([pointer.revision,pointer.previous?.revision].filter(Boolean))){
    for(const host of await campaignHosts(storage,revision))required.add(host);
  }
  // Refresh after R2 reads so a concurrent dashboard addition is preserved.
  const fresh=await read();
  if(!fresh || fresh.rule.enabled!==true || fresh.rule.id!==state.rule.id || fresh.ruleset.id!==state.ruleset.id)throw new Error('Hostname firewall changed during publication; rerun before activating content');
  state=fresh;
  const hosts=ruleHosts(state.rule),added=[...required].filter(host=>!hosts.has(host)).sort();
  if(!added.length)return {added:[]};
  for(const host of added)hosts.add(host);
  const response=await client.zoneRequest(policy.zone,`/rulesets/${state.ruleset.id}/rules/${state.rule.id}`,
    ()=>({method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({expression:expressionFor(hosts)})}));
  if(!response.ok){await response.body?.cancel();throw new Error('Could not update hostname firewall (HTTP '+response.status+'); content was not activated');}
  const data=await response.json();
  if(data.success!==true)throw new Error('Hostname firewall update was rejected; content was not activated');
  const confirmed=await read();
  if(!confirmed || confirmed.ruleset.id!==state.ruleset.id || confirmed.rule.id!==state.rule.id || confirmed.rule.enabled!==true ||
    [...hosts].some(host=>!ruleHosts(confirmed.rule).has(host)))throw new Error('Hostname firewall update could not be verified; content was not activated');
  log('Hostname firewall: allowed '+added.join(', ')+'.');
  return {added};
}
