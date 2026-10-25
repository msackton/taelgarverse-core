import test from 'node:test';
import assert from 'node:assert/strict';
import {HOSTNAME_POLICY as policy} from '../scripts/hostname-firewall.mjs';
import {createRetentionStorage,POINTER_KEY} from '../scripts/content-retention.mjs';
import {createCloudflareClient} from '../scripts/cloudflare-client.mjs';
import {publishContent} from '../scripts/publish-content.mjs';

const revision='a'.repeat(64),previous='b'.repeat(64),rulesetID='c'.repeat(32),ruleID='d'.repeat(32);
const config={name:policy.worker,r2_buckets:[{binding:'CONTENT',bucket_name:policy.bucket}]};
const pointer={revision,previous:{revision:previous}};
const expression=hosts=>'not (lower(http.host) in {'+hosts.map(host=>JSON.stringify(host)).join(' ')+'})';
const initial=['taelgar.org','www.taelgar.org','characters.taelgar.org','cleenseau.taelgar.org','old-service.taelgar.org'];

async function fixture(options={}){
  const calls=[],writes=[],messages=[];let reads=0,stored=null;
  const rule={id:ruleID,ref:policy.ref,action:'block',enabled:true,expression:expression(initial),...options.rule};
  const unrelated={id:'e'.repeat(32),ref:'unrelated',action:'block',enabled:true,expression:'http.host eq "bad.taelgar.org"'};
  const ruleset={id:rulesetID,kind:'zone',phase:'http_request_firewall_custom',rules:[unrelated,rule]};
  const manifests={
    [`revisions/${revision}/runtime.json`]:{version:2,revision,sites:[['new-campaign',{}],['cleenseau',{}]]},
    [`revisions/${previous}/runtime.json`]:{version:1,revision:previous,sites:[['rollback-campaign',{}]]},
    ...options.manifests,
  };
  const client=await createCloudflareClient({}, {intervalMs:0,wait:async()=>{},credentials:()=>({account:options.account || policy.account,token:'test-secret'}),fetcher:async(url,init)=>{
    const path=new URL(url).pathname;calls.push({path,method:init.method || 'GET'});
    if(path.includes('/zones/')){
      assert.ok(path.startsWith(`/client/v4/zones/${policy.zone}/`));
      if(init.method==='PATCH'){
        assert.equal(path,`/client/v4/zones/${policy.zone}/rulesets/${rulesetID}/rules/${ruleID}`);
        writes.push(JSON.parse(init.body));
        if(options.denied)return new Response('sensitive upstream text',{status:403});
        if(!options.ignoreUpdate)rule.expression=JSON.parse(init.body).expression;
        return Response.json({success:true,result:ruleset});
      }
      reads++;
      if(options.readDenied)return new Response('sensitive upstream text',{status:403});
      if(options.absent)return new Response('',{status:404});
      if(reads===2 && options.concurrentHost)rule.expression=expression([...initial,options.concurrentHost]);
      return Response.json({success:true,result:ruleset});
    }
    const key=decodeURIComponent(path.split('/objects/')[1] || '');
    if(init.method==='PUT'){
      assert.equal(key,POINTER_KEY);stored=JSON.parse(init.body);return new Response('');
    }
    if(key===POINTER_KEY)return stored?Response.json(stored):new Response('',{status:404});
    if(Object.hasOwn(manifests,key))return manifests[key]===null?new Response('',{status:404}):Response.json(manifests[key]);
    if(path.endsWith('/'+policy.bucket))return Response.json({success:true,result:{name:policy.bucket}});
    throw new Error('Unexpected test request: '+path);
  }});
  const storage=await createRetentionStorage(options.config || config,{client,log:message=>messages.push(message)});
  return {storage,calls,writes,messages,rule,unrelated,get stored(){return stored;}};
}

test('new and rollback campaign hosts are added and verified before the live pointer; service and concurrent additions survive',async()=>{
  const f=await fixture({concurrentHost:'another-service.taelgar.org'});
  const untouched=structuredClone(f.unrelated);
  await f.storage.putPointer(pointer);
  assert.deepEqual(f.stored,pointer);
  assert.equal(f.writes.length,1);assert.deepEqual(Object.keys(f.writes[0]),['expression']);
  for(const host of [...initial,'new-campaign.taelgar.org','rollback-campaign.taelgar.org','another-service.taelgar.org'])assert.ok(f.rule.expression.includes('"'+host+'"'));
  assert.deepEqual(f.unrelated,untouched);
  const patch=f.calls.findIndex(call=>call.method==='PATCH'),put=f.calls.findIndex(call=>call.method==='PUT');
  assert.ok(patch>0 && put>patch);
  assert.ok(f.calls.slice(patch+1,put).some(call=>call.path.includes('/entrypoint')));
  await f.storage.putPointer({revision:previous,previous:{revision}}); // rollback uses the same guard
  assert.equal(f.writes.length,1); // no update when every required host is already allowed
  assert.deepEqual(f.stored,{revision:previous,previous:{revision}});
});

test('permission failures, invalid manifests/policies and unverified updates stop pointer activation',async()=>{
  for(const [options,message] of [
    [{denied:true},/authentication\/permission/],
    [{readDenied:true},/authentication\/permission/],
    [{ignoreUpdate:true},/could not be verified/],
    [{rule:{expression:'true'}},/unexpected policy/],
    [{rule:{action:'skip'}},/unexpected policy/],
    [{manifests:{[`revisions/${revision}/runtime.json`]:{version:2,revision,sites:[['bad.example',{}]]}}},/Invalid campaign hostname/],
    [{manifests:{[`revisions/${revision}/runtime.json`]:{version:99,revision,sites:[]}}},/Invalid published/],
  ]){
    const f=await fixture(options);
    await assert.rejects(f.storage.putPointer(pointer),error=>message.test(error.message) && !error.message.includes('sensitive upstream text') && !error.message.includes('test-secret'));
    assert.equal(f.stored,null);assert.ok(!f.calls.some(call=>call.method==='PUT'));
    if(options.denied)assert.equal(f.writes.length,1); // uncertain writes are never automatically replayed
  }
});

test('unprovisioned/disabled rules and alternate destinations do not change edge settings',async()=>{
  for(const options of [{absent:true},{rule:{enabled:false}},{account:'f'.repeat(32)},{config:{...config,name:'preview'}}]){
    const f=await fixture(options);
    await f.storage.putPointer(pointer);
    assert.deepEqual(f.stored,pointer);assert.equal(f.writes.length,0);
    assert.ok(!f.calls.some(call=>call.path.endsWith('/runtime.json')));
    if(options.account || options.config)assert.ok(!f.calls.some(call=>call.path.includes('/zones/')));
  }
});

test('legacy snapshots derive campaign hosts from their index; malformed legacy data stops activation',async()=>{
  const key=`revisions/${revision}/index.json`;
  const f=await fixture({manifests:{[`revisions/${revision}/runtime.json`]:null,[key]:{schemaVersion:1,revision,campaignHomes:{'legacy-campaign':'---\ncampaigns: all\n---'}}}});
  await f.storage.putPointer(pointer);assert.ok(f.rule.expression.includes('"legacy-campaign.taelgar.org"'));
  const broken=await fixture({manifests:{[`revisions/${revision}/runtime.json`]:null,[key]:{schemaVersion:1,revision,campaignHomes:[]}}});
  await assert.rejects(broken.storage.putPointer(pointer),/Invalid legacy/);assert.equal(broken.stored,null);
});

test('unchanged publication repairs the host allowlist without rebuilding or activating content',async()=>{
  const f=await fixture();
  const checkpoint={...pointer,schemaVersion:1,repository:'github.com/example/taelgar',commit:'a'.repeat(40),dirty:false,fingerprint:'f'.repeat(64)};
  const result=await publishContent({fingerprint:checkpoint.fingerprint},{
    repositoryState:async()=>({repository:checkpoint.repository,commit:checkpoint.commit,dirty:false}),
    readCheckpoint:async()=>checkpoint,ensureHosts:value=>f.storage.ensureHosts(value),log:()=>{},
    build:async()=>{throw new Error('must skip build');},
  });
  assert.equal(result.skipped,true);assert.equal(f.writes.length,1);assert.equal(f.stored,null);
});
