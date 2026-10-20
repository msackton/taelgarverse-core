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

test('real D1 staging, FTS, persisted restart and R2 activation gate preserve previous published revision',async t=>{
  const cache=path.join(ROOT,'.cache');await fs.mkdir(cache,{recursive:true});
  const directory=await fs.mkdtemp(path.join(cache,'search-d1-test-')),persistTo=path.join(directory,'state');
  let database;
  t.after(async()=>{
    await database?.close();
    const resolved=await fs.realpath(directory);assert.ok(isInside(await fs.realpath(cache),resolved));assert.ok(path.basename(resolved).startsWith('search-d1-test-'));
    await fs.rm(resolved,{recursive:true});
  });
  const configFile=path.join(directory,'wrangler.json'),config={name:'search-publication-test',compatibility_date:'2026-10-19',r2_buckets:[{binding:'CONTENT',bucket_name:'search-publication-test'}]};
  await fs.writeFile(configFile,JSON.stringify(config));
  const storage=createStorage({bucket:'search-publication-test',configFile,local:true,persistTo});
  const fixture=text=>compileSearch(new ContentStore([{id:'One.md',name:'One',title:'One',slug:'one',target:targetPath('One.md'),note:parseNote(text)}]));
  const first=fixture('oldmarker\n%% privatepopup %%'),second=fixture('newmarker\n%% privatepopup %%');
  const revision='a'.repeat(64),next='b'.repeat(64),fingerprint='c'.repeat(64),commit='d'.repeat(40);
  const file=path.join(directory,'index.json'),manifestFile=path.join(directory,'uploads.json');
  const build=async(revision,search)=>{
    await fs.writeFile(file,JSON.stringify({schemaVersion:1,revision,search}));
    await fs.writeFile(manifestFile,JSON.stringify([{key:'revisions/'+revision+'/index.json',file}]));
    return {revision,search,manifestFile};
  };
  database=await createSearchDatabase(config,{local:true,persistTo});let index=new SearchIndex(database);
  const checkpointFile=path.join(directory,'checkpoint.json'),state={repository:'github.com/example/taelgar',commit,dirty:false};
  let pending=first;
  const deps={repositoryState:async()=>state,readCheckpoint:()=>storage.readCheckpoint(checkpointFile),log:()=>{},recordBuild:async()=>{},
    build:()=>build(pending===first?revision:next,searchDescriptor(pending)),upload:r=>storage.upload(r),
    stageSearch:r=>index.stage(r.revision,pending),verifySearch:r=>index.verify(r.revision,r.search),writeCheckpoint:value=>storage.writeCheckpoint(value,checkpointFile)};
  await publishContent({fingerprint},deps);assert.equal((await storage.readCheckpoint(checkpointFile)).revision,revision);
  const rows=await database.query([{sql:"SELECT text FROM tv_search_fts WHERE tv_search_fts MATCH 'oldmarker'"}]);assert.ok(rows[0].results.length);
  const resumed=await index.stage(revision,first);assert.equal(resumed.usage.rowsWritten,0);
  await database.close();database=await createSearchDatabase(config,{local:true,persistTo});index=new SearchIndex(database);
  await index.verify(revision,searchDescriptor(first));
  pending=second;const verify=deps.verifySearch;deps.verifySearch=async()=>{throw new Error('readiness check failed');};
  await assert.rejects(publishContent({fingerprint,force:true},deps),/readiness/);
  assert.equal((await storage.readCheckpoint(checkpointFile)).revision,revision);
  deps.verifySearch=verify;await publishContent({fingerprint,force:true},deps);
  assert.equal((await storage.readCheckpoint(checkpointFile)).revision,next);
  await index.verify(revision,searchDescriptor(first));
  assert.ok((await index.stage(next,second)).resumed);
});
