import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/worker-handler.mjs';
import {openSnapshot} from '../src/runtime-snapshot.mjs';
import {bucketText} from '../src/runtime-io.mjs';
import {readSnapshotPart} from '../src/snapshot-cache.mjs';
import {runtimeHash} from '../src/runtime-format.mjs';
import {coreRelease,publication,Bucket,PageCache} from './helpers/page-cache-fixture.mjs';

const never=()=>new Promise(()=>{}),quiet=()=>{};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const request=(worker,bucket,path='/api/page?page=Person',env={})=>worker.fetch(new Request(new URL(path,'https://taelgar.org')),{CONTENT:bucket,...env});
const manifestOf=bucket=>JSON.parse(bucket.objects.get('revisions/'+'a'.repeat(64)+'/runtime.json'));
const options={cache:null,snapshotCache:null,log:quiet};

test('fresh Workers reuse verified snapshot bytes while contexts, publication and the pointer stay fresh',async()=>{
  const bucket=new Bucket(publication().objects),cache=new PageCache();
  const worker=()=>createWorker(coreRelease,{...options,snapshotCache:cache});
  const first=await request(worker(),bucket);assert.equal(first.status,200);
  assert.doesNotMatch((await first.json()).html,/secret detail/);
  assert.ok(cache.values.size>=5);
  bucket.calls.length=0;
  const second=await request(worker(),bucket,'https://www.taelgar.org/api/page?page=Person&dm=1');
  assert.match((await second.json()).html,/secret detail/);
  assert.deepEqual(bucket.calls,['published/current.json','revisions/'+'a'.repeat(64)+'/runtime.json']);
  const next=publication({revision:'b'.repeat(64),text:'New publication.'});
  for(const [key,value] of next.objects)bucket.objects.set(key,value);
  assert.match((await (await request(worker(),bucket)).json()).html,/New publication/);
  // Internal Cache API entries cannot be fetched as public routes.
  const privateUrl=[...cache.values.keys()][0];
  assert.equal((await request(worker(),bucket,privateUrl)).status,404);
  bucket.objects.delete('published/current.json');
  assert.equal((await request(worker(),bucket)).status,503);
});

test('corrupt edge entries recover from R2 and invalid R2 bytes never enter either cache',async()=>{
  const bucket=new Bucket(publication().objects),cache=new PageCache(),manifest=manifestOf(bucket),descriptor=manifest.parts.search;
  const opts={cache,log:quiet};
  const expected=await readSnapshotPart(bucket,manifest.revision,descriptor,opts);
  const key=[...cache.values.keys()][0];cache.values.get(key).body='[]';
  assert.deepEqual(await readSnapshotPart(bucket,manifest.revision,descriptor,opts),expected);
  cache.values.clear();
  const file='revisions/'+manifest.revision+'/'+descriptor.file,original=bucket.objects.get(file);
  bucket.objects.set(file,'[]');
  const snapshot=await openSnapshot(bucket,manifest.revision,opts);
  await assert.rejects(snapshot.searchStore(),{status:503});
  assert.equal(cache.values.size,0);assert.equal(snapshot.cache.size,0);assert.equal(snapshot.pending.size,0);
  bucket.objects.set(file,original);
  assert.equal((await snapshot.searchStore()).entries.length,expected.length);
  // Even a reused filename is separated by its manifest hash.
  const other='[]';bucket.objects.set(file,other);
  assert.deepEqual(await readSnapshotPart(bucket,manifest.revision,{...descriptor,sha256:runtimeHash(other)},opts),[]);
});

test('a stalled shared shard releases all waiters and a late response cannot clear or replace a retry',async()=>{
  const bucket=new Bucket(publication().objects),manifest=manifestOf(bucket),get=bucket.get.bind(bucket),old=deferred(),retry=deferred();
  const file='revisions/'+manifest.revision+'/'+manifest.parts.search.file;
  let calls=0,cancelled=false;
  bucket.get=key=>key===file ? (++calls===1?old.promise:retry.promise) : get(key);
  const snapshot=await openSnapshot(bucket,manifest.revision,{cache:null,timeoutMs:20,log:quiet});
  const first=await Promise.allSettled([snapshot.searchStore(),snapshot.searchStore()]);
  assert.ok(first.every(result=>result.status==='rejected' && result.reason.status===503));
  assert.equal(calls,1);assert.equal(snapshot.pending.size,0);assert.equal(snapshot.parts.size,0);
  const next=snapshot.searchStore();
  await new Promise(resolve=>setImmediate(resolve));
  old.resolve({body:new ReadableStream({cancel(){cancelled=true;}})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelled,true);assert.equal(snapshot.pending.size,1);assert.equal(snapshot.cache.size,0);
  retry.resolve(await get(file));
  assert.ok((await next).entries.length);assert.equal(calls,2);
  assert.equal(snapshot.pending.size,0);assert.equal(snapshot.cache.size,1);
});

test('storage deadlines cancel a stalled body and permit a later read',async()=>{
  let cancelled=false;
  const bucket={get:async()=>({body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}})})};
  await assert.rejects(bucketText(bucket,'fixture',10),{name:'RequestTimeout'});
  assert.equal(cancelled,true);
  bucket.get=async()=>new Response('{"ok":true}');
  assert.equal(await bucketText(bucket,'fixture',10),'{"ok":true}');
});

test('pointer and manifest deadlines fail promptly and the same Worker recovers',async()=>{
  for(const suffix of ['published/current.json','/runtime.json']){
    const bucket=new Bucket(publication().objects),get=bucket.get.bind(bucket);let stalled=true;
    bucket.get=key=>stalled && key.endsWith(suffix)?never():get(key);
    const worker=createWorker(coreRelease,{...options,timeoutMs:10});
    const failed=await request(worker,bucket);
    assert.equal(failed.status,503);assert.equal(failed.headers.get('Cache-Control'),'no-store');
    assert.equal(failed.headers.get('Retry-After'),'1');
    stalled=false;assert.equal((await request(worker,bucket)).status,200);
  }
});

test('cache stalls are bounded, late cache responses are discarded, and writes cannot block rendering',async()=>{
  const bucket=new Bucket(publication().objects),late=deferred(),cache={match:()=>late.promise,put:never};
  const worker=createWorker(coreRelease,{cache,snapshotCache:cache,cacheMs:5,log:quiet});
  const response=await request(worker,bucket,'/page/person');assert.equal(response.status,200);
  assert.match(await response.text(),/Original biography/);
  let discarded=0;
  late.resolve({body:{cancel:async()=>{discarded++;}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(discarded>=5);
});

test('request deadline records the pending phase and cannot cache a late page',async()=>{
  const bucket=new Bucket(publication().objects),get=bucket.get.bind(bucket),late=deferred(),logs=[],cache=new PageCache();
  bucket.get=key=>key==='published/current.json'?late.promise:get(key);
  const worker=createWorker(coreRelease,{cache,timeoutMs:100,requestTimeoutMs:10,log:record=>logs.push(record)});
  const response=await request(worker,bucket,'/page/person?dm=1');assert.equal(response.status,503);
  assert.deepEqual(logs[0].pending,['pointer']);
  late.resolve(await get('published/current.json'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cache.values.size,0);
});

test('a joining request deadline evicts stuck shared initialization without letting it replace a fresh snapshot',async()=>{
  const bucket=new Bucket(publication().objects),get=bucket.get.bind(bucket),late=deferred();let stalled=true;
  bucket.get=key=>stalled && key.endsWith('/search-metadata.json')?late.promise:get(key);
  const worker=createWorker(coreRelease,{...options,timeoutMs:1000,requestTimeoutMs:20});
  assert.equal((await request(worker,bucket,'/api/search?q=Person')).status,503);
  stalled=false;
  assert.equal((await request(worker,bucket,'/api/search?q=Person')).status,200);
  const manifest=manifestOf(bucket);
  late.resolve(await get('revisions/'+manifest.revision+'/'+manifest.parts.search.file));
  await new Promise(resolve=>setImmediate(resolve));
  bucket.calls.length=0;
  assert.equal((await request(worker,bucket,'/api/search?q=Person')).status,200);
  assert.deepEqual(bucket.calls,['published/current.json']);
});

test('navigation starts both immutable reads together and timings omit query, headers and content',async()=>{
  const bucket=new Bucket(publication().objects),get=bucket.get.bind(bucket),held=deferred(),started=[];
  bucket.get=key=>{
    started.push(key);
    if(key.endsWith('/search-metadata.json'))return held.promise.then(()=>get(key));
    return get(key);
  };
  const logs=[],worker=createWorker(coreRelease,{...options,log:record=>logs.push(record)});
  const pending=request(worker,bucket,'/?q=private-search-text&dm=1');
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(started.some(key=>key.endsWith('/navigation.json')));
  held.resolve();assert.equal((await pending).status,200);
  const summary=logs.find(record=>record.event==='request-timing');
  assert.equal(summary.route,'search');assert.equal(summary.status,200);
  assert.ok(Object.hasOwn(summary.phases,'pointer'));assert.ok(Object.hasOwn(summary.phases,'route-init'));
  assert.doesNotMatch(JSON.stringify(logs),/private-search-text|secret detail|Person|dm=|https:/);
});

test('stalled D1 returns visible page-name matches and subsequent searches can recover',async()=>{
  const bucket=new Bucket(publication().objects),manifest=manifestOf(bucket);
  manifest.search={version:1,digest:'e'.repeat(64),documents:1,rules:1};
  bucket.objects.set('revisions/'+manifest.revision+'/runtime.json',JSON.stringify(manifest));
  let stalled=true,calls=0;const logs=[];
  const db={prepare:()=>({bind:()=>({})}),batch:()=>{calls++;return stalled?never():Promise.resolve([
    {success:true,results:[{revision:manifest.revision}]},
    {success:true,results:[{page:'person',title:'Person',marked:'Safe result.'}]},
  ]);}};
  const worker=createWorker(coreRelease,{...options,queryTimeoutMs:10,log:record=>logs.push(record)});
  const first=await request(worker,bucket,'/api/search?q=Person',{SEARCH_DB:db});
  const fallback=await first.json();assert.equal(fallback.fallback,true);assert.equal(fallback.results[0].title,'Person');
  stalled=false;
  const second=await request(worker,bucket,'/api/search?q=Person',{SEARCH_DB:db});
  assert.equal((await second.json()).source,'full-text');assert.equal(calls,2);
  assert.ok(logs.some(record=>Object.hasOwn(record.phases || {},'d1')));
});
