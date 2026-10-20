import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflareClient} from '../scripts/cloudflare-client.mjs';
import {createSearchDatabase} from '../scripts/search-database.mjs';

const account='a'.repeat(32),credentials=()=>({account,token:'secret'});
const fast={credentials,intervalMs:0,wait:async()=>{}};
test('transient requests retry with backoff and respect Retry-After',async()=>{
  const delays=[];let calls=0;
  const client=await createCloudflareClient({}, {...fast,wait:async ms=>delays.push(ms),fetcher:async()=>{
    calls++;
    if(calls===1)throw new TypeError('fetch failed secret');
    if(calls===2)return new Response('',{status:429,headers:{'Retry-After':'7'}});
    if(calls===3)return new Response('',{status:503});
    return new Response('ok');
  }});
  assert.equal(await (await client.request('/r2/buckets/test',undefined,{retry:true})).text(),'ok');
  assert.deepEqual(delays,[1000,7000,4000]);
});
test('retries are bounded, permanent errors stop, and uncertain D1 writes are never replayed',async()=>{
  for(const status of ['network',400,403,500]){
    let calls=0;
    const client=await createCloudflareClient({}, {...fast,fetcher:async()=>{
      calls++;if(status==='network')throw new Error('secret');return new Response('secret',{status});
    }});
    if(status==='network' || status===403)await assert.rejects(client.request('/r2/buckets/test',undefined,{retry:true}),e=>!e.message.includes('secret'));
    else assert.equal((await client.request('/r2/buckets/test',undefined,{retry:true})).status,status);
    assert.equal(calls,status==='network' || status===500?5:1);
  }
  let calls=0;
  const client=await createCloudflareClient({}, {...fast,fetcher:async()=>{calls++;throw Error('connection lost after commit');}});
  await assert.rejects(client.request('/d1/database/test/query',()=>({method:'POST',body:'sql'})),/outcome may be unknown/);
  assert.equal(calls,1);
});
test('concurrent 401s share credential refresh and recreate each request body',async()=>{
  let reads=0,bodies=0;
  const client=await createCloudflareClient({}, {...fast,credentials:async()=>({account,token:++reads===1?'expired':'fresh'}),fetcher:async(_url,init)=>{
    assert.equal(init.redirect,'error');
    return new Response('ok',{status:init.headers.Authorization==='Bearer fresh'?200:401});
  }});
  const results=await Promise.all([1,2,3].map(()=>client.request('/r2/buckets/test',()=>{bodies++;return {method:'PUT',body:'bytes'};},{retry:true})));
  assert.ok(results.every(r=>r.ok));assert.equal(reads,2);assert.equal(bodies,6);
});
test('credentials refresh during long sessions, cannot retarget the account, and repeated 401 stops',async()=>{
  let clock=0,reads=0,badAccount=false,calls=0;
  const client=await createCloudflareClient({}, {...fast,now:()=>clock,credentials:()=>({account:badAccount?'b'.repeat(32):account,token:'token-'+(++reads)}),fetcher:async(_url,init)=>{
    calls++;assert.equal(init.headers.Authorization,'Bearer token-'+reads);return new Response('ok');
  }});
  await client.request('/r2/buckets/test');clock=61000;await client.request('/r2/buckets/test');assert.equal(reads,2);
  badAccount=true;clock=122000;await assert.rejects(client.request('/r2/buckets/test'),/account changed/);assert.equal(calls,2);
  let rejected=0;
  const denied=await createCloudflareClient({}, {...fast,fetcher:async()=>{rejected++;return new Response('secret',{status:401});}});
  await assert.rejects(denied.request('/r2/buckets/test',undefined,{retry:true}),/npx wrangler login/);assert.equal(rejected,2);
});
test('D1 lock release gets refreshed credentials after a long upload',async()=>{
  let time=0,reads=0;
  const id='11111111-1111-4111-8111-111111111111';
  const client=await createCloudflareClient({}, {...fast,now:()=>time,credentials:()=>({account,token:++reads===1?'old':'new'}),fetcher:async(_url,init)=>{
    if(init.method==='GET')return Response.json({success:true,result:{name:'taelgarverse-search',uuid:id}});
    assert.equal(init.headers.Authorization,'Bearer new');
    return Response.json({success:true,result:[{success:true,results:[]}]});
  }});
  const db=await createSearchDatabase({d1_databases:[{binding:'SEARCH_DB',database_name:'taelgarverse-search',database_id:id}]},{client});
  time=3600000;
  await db.query([{sql:'DELETE FROM tv_search_publish_lock WHERE owner=?',params:['owner']}]);assert.equal(reads,2);
});
