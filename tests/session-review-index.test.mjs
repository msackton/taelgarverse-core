import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {discoverSessionReviews} from '../obsidian/taelgarverse/features/session-review-index.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'taelgar-index-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const campaignDirectory=path.join(root,'_sessions/demo');
  const folder=path.join(campaignDirectory,'demo-001','cleaned');await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(root,'_sessions/campaign-registry.json'),'{"demo":"Index.md"}');
  await fs.writeFile(path.join(root,'Index.md'),'---\nname: Demo\nsessionBundleDirectory: _sessions/demo\n---\n');
  const write=(name,text)=>fs.writeFile(path.join(folder,name),text);
  await write('demo-session.yaml','campaign: Demo\nsessionNumber: 1\ntranscriptProcessing:\n  status: complete\n');
  return {root,campaignDirectory,folder,write};
}

test('native discovery reads portable questions and entity review counts without changing any files',async t=>{
  const {root,folder,write}=await fixture(t);
  await write('demo-transcript-review.md','%% transcript-review:v1 {"qualityComplete":true} %%\n%% transcript-issue:v1 {"id":"one"} %%\n');
  await write('demo-entity-map.json',JSON.stringify({entities:[{review:{status:'humanReviewed',confidence:'high'}},{review:{status:'unreviewed',confidence:'medium'}}],reviewState:{deferred:['e2']}}));
  const before=await Promise.all((await fs.readdir(folder)).map(async file=>[file,await fs.readFile(path.join(folder,file),'utf8')]));
  const result=await discoverSessionReviews(root),row=result.sessions[0];
  assert.equal(result.countsAreUnvalidated,true);assert.equal(result.sessions.length,1);
  assert.equal(row.sessionYaml,'_sessions/demo/demo-001/cleaned/demo-session.yaml');assert.equal(row.transcriptPending,undefined);
  assert.equal(row.entities,2);assert.equal(row.pending,1);assert.equal(row.human,1);assert.equal(row.deferred,undefined);
  assert.equal(row.transcriptStage,undefined);
  for(const [file,text] of before)assert.equal(await fs.readFile(path.join(folder,file),'utf8'),text);
});

test('malformed inventories are visible and do not hide other sessions',async t=>{
  const {root,campaignDirectory}=await fixture(t);
  const broken=path.join(campaignDirectory,'demo-002','cleaned');
  await fs.mkdir(broken,{recursive:true});
  await fs.writeFile(path.join(broken,'broken-session.yaml'),'[not a manifest]');
  await fs.writeFile(path.join(broken,'ignored-session.yml'),'campaign: Ignored');
  const result=await discoverSessionReviews(root);
  assert.equal(result.sessions.length,2);assert.equal(result.sessions.find(row=>row.number==='1').stage,'not mapped');
  const error=result.sessions.find(row=>row.number==='2');
  assert.equal(error.stage,'error');
  assert.equal(error.campaign,'Demo');
  assert.match(error.error,/session YAML object/);
});

test('legacy transcript reports are ignored and an empty vault remains browseable',async t=>{
  const {root,write}=await fixture(t);await write('one-transcript-review.md','legacy');await write('two-transcript-review.md','legacy');
  assert.equal((await discoverSessionReviews(root)).sessions[0].stage,'not mapped');
  await fs.rename(path.join(root,'_sessions'),path.join(root,'elsewhere'));
  assert.deepEqual((await discoverSessionReviews(root)).sessions,[]);
});

test('only registered bundles and their immediate cleaned files are discovered',async t=>{
  const {root,campaignDirectory,folder}=await fixture(t);
  for(const outside of [path.join(root,'_sessions/to-process/demo-002/cleaned'),
    path.join(campaignDirectory,'unnumbered/cleaned'),path.join(folder,'nested')]){
    await fs.mkdir(outside,{recursive:true});
    await fs.writeFile(path.join(outside,'loose-session.yaml'),'campaign: Demo\nsessionNumber: 2');
    await fs.writeFile(path.join(outside,'loose-entity-map.json'),'{"entities":[]}');
    await fs.writeFile(path.join(outside,'broken-session.yaml'),'[not a manifest]');
  }
  const result=await discoverSessionReviews(root);
  assert.deepEqual(result.sessions.map(row=>[row.number,row.stage]),[['1','not mapped']]);
});

test('a registered bundle with multiple manifests surfaces a discovery error',async t=>{
  const {root,write}=await fixture(t);
  await write('second-session.yaml','campaign: Demo\nsessionNumber: 1');
  const {sessions}=await discoverSessionReviews(root);
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].stage,'error');
  assert.match(sessions[0].error,/Multiple session manifests: demo-session\.yaml, second-session\.yaml/);
});

test('discovery skips a linked cleaned directory',async t=>{
  const {root,campaignDirectory,folder}=await fixture(t);
  const linkedBundle=path.join(campaignDirectory,'demo-002');
  await fs.mkdir(linkedBundle);
  await fs.symlink(folder,path.join(linkedBundle,'cleaned'),'junction');
  const {sessions}=await discoverSessionReviews(root);
  assert.deepEqual(sessions.map(row=>row.number),['1']);
});

test('high-confidence automated reviews keep a session pending',async t=>{
  const {root,write}=await fixture(t);
  await write('demo-entity-map.json',JSON.stringify({entities:[{review:{status:'automatedReviewed',confidence:'high'}},{review:{status:'humanReviewed',confidence:'low'}}]}));
  const row=(await discoverSessionReviews(root)).sessions[0];assert.equal(row.pending,1);assert.equal(row.human,1);
});


test('registered bundle names supply review identity even with conflicting or missing YAML values', async t => {
  const {root}=await fixture(t);
  await fs.writeFile(path.join(root,'_sessions/campaign-registry.json'),JSON.stringify({clee:'Index.md'}));
  await fs.writeFile(path.join(root,'Index.md'),'---\nname: Cleenseau Campaign\nsessionBundleDirectory: _sessions/cleenseau\n---\n');
  for (const [number,yaml] of [['012.1','campaign: dufr\nsessionNumber: 8'],['012.10','sourceType: narrative']]) {
    const folder=path.join(root,'_sessions/cleenseau','cleenseau-'+number,'cleaned');
    await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(path.join(folder,'historical-spelling-session.yaml'),yaml);
  }
  const {sessions}=await discoverSessionReviews(root);
  assert.deepEqual(sessions.filter(row=>row.campaign==='Cleenseau Campaign').map(row=>row.number),['12.1','12.10']);
  await fs.mkdir(path.join(root,'_sessions/cleenseau/duplicate-012.10'));
  await assert.rejects(discoverSessionReviews(root),/Duplicate bundles for session clee:12\.10:.*cleenseau-012\.10.*duplicate-012\.10/);
});
