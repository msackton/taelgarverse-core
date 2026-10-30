import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {discoverSessionReviews} from '../obsidian/taelgarverse/features/session-review-index.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'taelgar-index-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const folder=path.join(root,'_sessions/demo/cleaned');await fs.mkdir(folder,{recursive:true});
  const write=(name,text)=>fs.writeFile(path.join(folder,name),text);
  await write('demo-session.yaml','campaign: Demo\nsessionNumber: 1\ntranscriptProcessing:\n  status: complete\n');
  return {root,folder,write};
}

test('native discovery reads portable questions and entity review counts without changing any files',async t=>{
  const {root,folder,write}=await fixture(t);
  await write('demo-transcript-review.md','%% transcript-review:v1 {"qualityComplete":true} %%\n%% transcript-issue:v1 {"id":"one"} %%\n');
  await write('demo-entity-map.json',JSON.stringify({entities:[{review:{status:'humanReviewed',confidence:'high'}},{review:{status:'unreviewed',confidence:'medium'}}],reviewState:{deferred:['e2']}}));
  const before=await Promise.all((await fs.readdir(folder)).map(async file=>[file,await fs.readFile(path.join(folder,file),'utf8')]));
  const result=await discoverSessionReviews(root),row=result.sessions[0];
  assert.equal(result.countsAreUnvalidated,true);assert.equal(result.sessions.length,1);
  assert.equal(row.sessionYaml,'_sessions/demo/cleaned/demo-session.yaml');assert.equal(row.transcriptPending,1);
  assert.equal(row.entities,2);assert.equal(row.pending,1);assert.equal(row.human,1);assert.equal(row.deferred,1);
  assert.equal(row.transcriptStage,'reviewable');
  for(const [file,text] of before)assert.equal(await fs.readFile(path.join(folder,file),'utf8'),text);
});

test('malformed inventories are visible and do not hide other sessions',async t=>{
  const {root,write}=await fixture(t);await write('broken-session.yaml','[not a manifest]');
  await write('ignored-session.yml','campaign: Ignored');
  const result=await discoverSessionReviews(root);
  assert.equal(result.sessions.length,2);assert.equal(result.sessions.find(row=>row.number===1).transcriptStage,'complete');
  assert.match(result.sessions.find(row=>row.stage==='error').error,/session YAML object/);
});

test('multiple review reports surface an error and an empty vault remains browseable',async t=>{
  const {root,write}=await fixture(t);await write('one-transcript-review.md','legacy');await write('two-transcript-review.md','legacy');
  assert.match((await discoverSessionReviews(root)).sessions[0].error,/Multiple transcript reviews/);
  await fs.rename(path.join(root,'_sessions'),path.join(root,'elsewhere'));
  assert.deepEqual((await discoverSessionReviews(root)).sessions,[]);
});

test('unprocessed manifests remain discoverable alongside cleaned session bundles',async t=>{
  const {root}=await fixture(t);const folder=path.join(root,'_sessions/to-process/demo');await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'second-session.yaml'),'campaign: Demo\nsessionNumber: 2');
  const result=await discoverSessionReviews(root);assert.equal(result.sessions.length,2);
  assert.equal(result.sessions.find(row=>row.number===2).transcriptStage,'not processed');
});
