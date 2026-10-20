import test from 'node:test';
import assert from 'node:assert/strict';
import {activationPointer,validatePublicationUploads,prunePublication,rollbackPublication,createRetentionStorage,POINTER_KEY} from '../scripts/content-retention.mjs';
import {publishContent} from '../scripts/publish-content.mjs';

const rev=letter=>letter.repeat(64),asset=letter=>'assets/'+rev(letter),key=letter=>`revisions/${rev(letter)}/index.json`;
test('every publication path restricts uploads to immutable keys from its own revision',()=>{
  assert.doesNotThrow(()=>validatePublicationUploads(rev('a'),[{key:key('a')},{key:asset('b')} ]));
  for(const uploads of [[],null,[null],[{key:POINTER_KEY}],[{key:key('b')}],[{key:'revisions/'+rev('a')+'/../index.json'}]])assert.throws(()=>validatePublicationUploads(rev('a'),uploads),/unexpected object keys/);
  assert.throws(()=>validatePublicationUploads('.*',[{key:key('a')}]),/unexpected object keys/);
});
test('only successful distinct activations rotate the one rollback snapshot; same revision and rollback preserve it',()=>{
  const a={revision:rev('a')},b=activationPointer(a,{revision:rev('b')});
  assert.deepEqual(b.previous,a);
  const c=activationPointer(b,{revision:rev('c')});assert.equal(c.previous.revision,rev('b'));assert.equal(c.previous.previous,undefined);
  assert.deepEqual(activationPointer(c,{revision:rev('c')}).previous,c.previous);
  const rollback=activationPointer(c,{revision:rev('b')});assert.equal(rollback.previous.revision,rev('c'));
  assert.equal(activationPointer(null,a).previous,undefined);
});
function fixture(){
  const pointer=activationPointer({revision:rev('b')},{revision:rev('c')});
  const objects=new Map([[POINTER_KEY,pointer],[key('a'),{}],['revisions/'+rev('a')+'/notes/01.json',{}],
    [key('b'),{schemaVersion:1,revision:rev('b'),entries:[{objectKey:asset('a')},{objectKey:asset('b')},{note:{shard:'01'}}]}],
    [`revisions/${rev('b')}/notes/01.json`,{}],
    [key('c'),{schemaVersion:1,revision:rev('c'),entries:[{objectKey:asset('a')},{objectKey:asset('c')}]}],
    [asset('a'),{}],[asset('b'),{}],[asset('c'),{}],[asset('d'),{}],['assets/unmanaged',{}],['revisions/manual.json',{}]]);
  const deleted=[],pruned=[];
  return {pointer,objects,deleted,pruned,index:{prune:async keep=>pruned.push(keep),verify:async()=>{}},storage:{
    getJSON:async key=>objects.get(key) ?? null,
    list:async prefix=>[...objects.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key,size:10})),
    delete:async keys=>{deleted.push(...keys);keys.forEach(key=>objects.delete(key));},
  }};
}
test('R2 sweep deletes old snapshots and orphaned assets, preserving shared assets, previous-only assets and unrelated keys',async()=>{
  const f=fixture();const result=await prunePublication(f.storage,f.index,f.pointer);
  assert.deepEqual(f.pruned,[[rev('c'),rev('b')]]);
  assert.deepEqual(new Set(f.deleted),new Set([key('a'),'revisions/'+rev('a')+'/notes/01.json',asset('d')]));
  assert.equal(result.deletedBytes,30);assert.ok(f.objects.has(asset('b')));
  assert.equal((await prunePublication(f.storage,f.index,f.pointer)).deletedObjects,0);
});
test('dry-run does not delete anything; rollback verifies before swapping the two good snapshots',async()=>{
  const f=fixture();const plan=await prunePublication(f.storage,f.index,f.pointer,{dryRun:true});assert.equal(plan.deletedObjects,3);assert.equal(f.pruned.length,0);assert.equal(f.deleted.length,0);
  f.index.withPublicationLock=action=>action();f.storage.putPointer=async pointer=>f.objects.set(POINTER_KEY,pointer);
  const restored=await rollbackPublication(f.storage,f.index);assert.equal(restored.revision,rev('b'));assert.equal(restored.previous.revision,rev('c'));
  f.objects.delete(asset('c'));const before=f.objects.get(POINTER_KEY);
  await assert.rejects(rollbackPublication(f.storage,f.index),/missing/);assert.deepEqual(f.objects.get(POINTER_KEY),before);
});
test('missing retained content, D1 readiness failures and changed pointers stop deletion; legacy history is never guessed',async()=>{
  for(const mode of ['missing-index','missing-asset','missing-shard','search','changed','legacy']){
    const f=fixture();
    if(mode==='missing-index')f.objects.delete(key('b'));
    if(mode==='missing-asset')f.objects.delete(asset('b'));
    if(mode==='missing-shard')f.objects.delete(`revisions/${rev('b')}/notes/01.json`);
    if(mode==='search'){f.objects.get(key('b')).search={};f.index.verify=async()=>{throw new Error('not ready');};}
    if(mode==='changed')f.storage.getJSON=async k=>k===POINTER_KEY?{revision:rev('d')}:f.objects.get(k);
    if(mode==='legacy')delete f.pointer.retentionVersion;
    await assert.rejects(prunePublication(f.storage,f.index,f.pointer));assert.equal(f.deleted.length,0);assert.equal(f.pruned.length,0);
  }
});
test('post-activation cleanup failure retries on an unchanged publish without rebuilding or rotating rollback',async()=>{
  let current=activationPointer({revision:rev('a')},{revision:rev('b')}),builds=0,fail=true,prunes=0;
  const state={repository:'github.com/test/vault',commit:'a'.repeat(40),dirty:false},fingerprint=rev('f');
  const deps={repositoryState:async()=>state,readCheckpoint:async()=>current,readPointer:async()=>current,log:()=>{},recordBuild:async()=>{},
    build:async()=>{builds++;return {revision:rev('c')};},upload:async()=>{},writeCheckpoint:async value=>{current=value;},
    prune:async()=>{prunes++;if(fail)throw new Error('network failure');}};
  await assert.rejects(publishContent({fingerprint},deps),/Content is published, but retention cleanup failed/);
  assert.equal(current.revision,rev('c'));assert.equal(current.previous.revision,rev('b'));
  fail=false;assert.equal((await publishContent({fingerprint},deps)).skipped,true);assert.equal(builds,1);assert.equal(prunes,2);assert.equal(current.previous.revision,rev('b'));
  deps.upload=async()=>{throw new Error('upload failed');};await assert.rejects(publishContent({fingerprint,force:true},deps),/upload failed/);assert.equal(prunes,2);
});
test('remote R2 retention lists every cursor page, rejects incomplete listings, and keeps credentials out of errors',async()=>{
  const config={r2_buckets:[{binding:'CONTENT',bucket_name:'test-content'}]},calls=[];
  let broken=false;
  const storage=await createRetentionStorage(config,{credentials:()=>({account:'a'.repeat(32),token:'private-token'}),fetcher:async(url,options)=>{
    calls.push({url,method:options.method});assert.equal(options.headers.Authorization,'Bearer private-token');
    if(options.method==='DELETE')return new Response('{}');
    if(!url.includes('?'))return Response.json({revision:rev('c')});
    const cursor=new URL(url).searchParams.get('cursor');
    return Response.json({success:true,result:[{key:'assets/'+(cursor?rev('b'):rev('a'))}],result_info:{is_truncated:!cursor,...(!broken?{cursor:'next'}:{})}});
  }});
  assert.equal((await storage.list('assets/')).length,2);assert.match(calls[1].url,/cursor=next/);
  await storage.delete([asset('a')]);assert.equal(calls[2].method,'DELETE');
  broken=true;await assert.rejects(storage.list('assets/'),/pagination/);
  const bad=await createRetentionStorage(config,{credentials:()=>({account:'a'.repeat(32),token:'private-token'}),fetcher:async()=>{throw new Error('private-token');}});
  await assert.rejects(bad.list('assets/'),error=>!error.message.includes('private-token'));
});
test('R2 deployments without cursor metadata walk start_after through an empty page and refuse non-progress',async()=>{
  let broken=false;const queries=[],rows=[{key:asset('a')},{key:asset('b')}];
  const config={r2_buckets:[{binding:'CONTENT',bucket_name:'test-content'}]};
  const storage=await createRetentionStorage(config,{credentials:()=>({account:rev('a').slice(0,32),token:'secret'}),fetcher:async url=>{
    const start=new URL(url).searchParams.get('start_after');queries.push(start);
    return Response.json({success:true,result:broken?rows:rows.filter(r=>!start || r.key>start).slice(0,1)});
  }});
  assert.equal((await storage.list('assets/')).length,2);assert.deepEqual(queries,[null,asset('a'),asset('b')]);
  broken=true;await assert.rejects(storage.list('assets/'),/pagination/);
});
test('R2 object-404 only means missing content when the configured bucket still exists',async()=>{
  let bucketExists=true;
  const storage=await createRetentionStorage({r2_buckets:[{binding:'CONTENT',bucket_name:'test-content'}]},
    {credentials:()=>({account:'a'.repeat(32),token:'secret'}),fetcher:async url=>url.endsWith('/test-content')?
      Response.json({success:bucketExists,result:{name:'test-content'}}):new Response('NoSuchKey',{status:404})});
  assert.equal(await storage.getJSON(POINTER_KEY),null);bucketExists=false;
  await assert.rejects(storage.getJSON(POINTER_KEY),/HTTP 404/);
});
