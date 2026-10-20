// Explicit real D1/R2 emulator checks. No Cloudflare auth or remote writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {targetPath} from '../src/common.mjs';
import {compileSearch,searchDescriptor} from '../scripts/compile-search.mjs';
import {SearchIndex} from '../scripts/search-index.mjs';
import {createSearchDatabase} from '../scripts/search-database.mjs';
import {createStorage,publishContent} from '../scripts/publish-content.mjs';
import {createRetentionStorage,prunePublication,rollbackPublication,POINTER_KEY} from '../scripts/content-retention.mjs';
import {createIndexSearch,searchInput} from '../src/search.mjs';

test('real D1 staging, FTS, persisted restart and R2 activation gate preserve previous published revision',async t=>{
  const cache=path.join(ROOT,'.cache');await fs.mkdir(cache,{recursive:true});
  const directory=await fs.mkdtemp(path.join(cache,'search-d1-test-')),persistTo=path.join(directory,'state');
  let database,retention;
  t.after(async()=>{
    await database?.close();
    await retention?.close();
    const resolved=await fs.realpath(directory);assert.ok(isInside(await fs.realpath(cache),resolved));assert.ok(path.basename(resolved).startsWith('search-d1-test-'));
    await fs.rm(resolved,{recursive:true});
  });
  const configFile=path.join(directory,'wrangler.json'),config={name:'search-publication-test',compatibility_date:'2026-10-19',r2_buckets:[{binding:'CONTENT',bucket_name:'search-publication-test'}]};
  await fs.writeFile(configFile,JSON.stringify(config));
  const storage=createStorage({bucket:'search-publication-test',configFile,local:true,persistTo});
  const fixture=text=>compileSearch(new ContentStore([{id:'One.md',name:'One',title:'One',slug:'one',target:targetPath('One.md'),note:parseNote(text)}]));
  const first=fixture('oldmarker\n%% privatepopup %%'),second=fixture('newmarker\n%% privatepopup %%'),third=fixture('currentmarker');
  const revision='a'.repeat(64),next='b'.repeat(64),fingerprint='c'.repeat(64),commit='d'.repeat(40);
  const file=path.join(directory,'index.json'),manifestFile=path.join(directory,'uploads.json');
  const build=async(revision,search)=>{
    const assets=revision==='a'.repeat(64)?['a']:revision==='b'.repeat(64)?['b','c']:['b','d'];
    const entries=[{note:{shard:'00'}},...assets.map(a=>({objectKey:'assets/'+a.repeat(64)}))];
    await fs.writeFile(file,JSON.stringify({schemaVersion:1,revision,search,entries}));
    const uploads=[{key:'revisions/'+revision+'/index.json',file}],notes=path.join(directory,'notes.json');
    await fs.writeFile(notes,JSON.stringify({'One.md':'raw source'}));uploads.push({key:'revisions/'+revision+'/notes/00.json',file:notes});
    for(const a of assets){const assetFile=path.join(directory,a+'.bin');await fs.writeFile(assetFile,a);uploads.push({key:'assets/'+a.repeat(64),file:assetFile});}
    await fs.writeFile(manifestFile,JSON.stringify(uploads));
    return {revision,search,manifestFile};
  };
  database=await createSearchDatabase(config,{local:true,persistTo});let index=new SearchIndex(database);
  retention=await createRetentionStorage(config,{local:true,persistTo});
  const checkpointFile=path.join(directory,'checkpoint.json'),state={repository:'github.com/example/taelgar',commit,dirty:false};
  let pending=first;
  const deps={repositoryState:async()=>state,readCheckpoint:()=>storage.readCheckpoint(checkpointFile),log:()=>{},recordBuild:async()=>{},
    withPublicationLock:(action,options)=>index.withPublicationLock(action,options),readPointer:()=>retention.getJSON(POINTER_KEY),prune:pointer=>prunePublication(retention,index,pointer),
    build:()=>build(pending===first?revision:pending===second?next:'e'.repeat(64),searchDescriptor(pending)),upload:r=>storage.upload(r),
    stageSearch:r=>index.stage(r.revision,pending),verifySearch:r=>index.verify(r.revision,r.search),writeCheckpoint:value=>storage.writeCheckpoint(value,checkpointFile)};
  await index.ensure();
  await database.query([{sql:'INSERT INTO tv_search_publish_lock VALUES(1,?,?)',params:['interrupted-publisher','2026-10-20T18:19:04.423Z']}]);
  await assert.rejects(publishContent({fingerprint},deps),/--unblock/);
  await publishContent({fingerprint,unblock:true},deps);
  assert.equal((await database.query([{sql:'SELECT owner FROM tv_search_publish_lock'}]))[0].results.length,0);
  assert.equal((await storage.readCheckpoint(checkpointFile)).revision,revision);
  const rows=await database.query([{sql:"SELECT text FROM tv_search_fts WHERE tv_search_fts MATCH 'oldmarker'"}]);assert.ok(rows[0].results.length);
  const resumed=await index.stage(revision,first);assert.equal(resumed.usage.rowsWritten,0);
  const search=createIndexSearch(statements=>database.query(statements),{revision,descriptor:searchDescriptor(first),store:new ContentStore([{id:'One.md',name:'One',title:'One',slug:'one',target:targetPath('One.md'),note:parseNote('oldmarker')}])});
  const queryContext={kind:'custom',id:'custom',date:'1740-01-01',campaigns:[],dm:false};
  assert.equal((await search(searchInput('oldmarker'),queryContext)).results[0].excerpt,'oldmarker');
  assert.equal((await search(searchInput('privatepopup'),queryContext)).results.length,0);
  assert.equal((await search(searchInput('privatepopup'),{...queryContext,dm:true})).results.length,1);
  await database.close();database=await createSearchDatabase(config,{local:true,persistTo});index=new SearchIndex(database);
  await index.verify(revision,searchDescriptor(first));
  pending=second;const verify=deps.verifySearch;deps.verifySearch=async()=>{throw new Error('readiness check failed');};
  await assert.rejects(publishContent({fingerprint,force:true},deps),/readiness/);
  assert.equal((await storage.readCheckpoint(checkpointFile)).revision,revision);
  deps.verifySearch=verify;await publishContent({fingerprint,force:true},deps);
  assert.equal((await storage.readCheckpoint(checkpointFile)).revision,next);
  await index.verify(revision,searchDescriptor(first));
  assert.ok((await index.stage(next,second)).resumed);
  pending=third;await publishContent({fingerprint,force:true},deps);
  const active=await retention.getJSON(POINTER_KEY);assert.equal(active.revision,'e'.repeat(64));assert.equal(active.previous.revision,next);
  await index.verify(next,searchDescriptor(second));await assert.rejects(index.verify(revision,searchDescriptor(first)),/not ready/);
  const objects=[...await retention.list('revisions/'),...await retention.list('assets/')].map(o=>o.key);
  assert.ok(!objects.some(key=>key.startsWith('revisions/'+revision+'/')));
  assert.ok(!objects.includes('assets/'+'a'.repeat(64)));
  for(const letter of ['b','c','d'])assert.ok(objects.includes('assets/'+letter.repeat(64)));
  assert.equal((await database.query([{sql:"SELECT COUNT(*) n FROM tv_search_fts WHERE tv_search_fts MATCH 'oldmarker'"}]))[0].results[0].n,0);
  const unchanged=await publishContent({fingerprint},deps);assert.ok(unchanged.skipped);assert.equal(unchanged.previous.revision,next);
  const rollback=await rollbackPublication(retention,index);assert.equal(rollback.revision,next);assert.equal(rollback.previous.revision,'e'.repeat(64));
  await index.verify(next,searchDescriptor(second));assert.equal((await storage.readCheckpoint(checkpointFile)).revision,next);
});
