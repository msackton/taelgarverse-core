import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from '../src/config.mjs';
import {releaseObsidian,distributionRepo,sourceRepo} from '../scripts/release-obsidian.mjs';

async function fixture(t,{failUpload=false,existing=false}={}){
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const output=await fs.mkdtemp(path.join(ROOT,'.cache','obsidian-release-test-'));
  t.after(()=>fs.rm(output,{recursive:true,force:true}));
  const manifest={id:'taelgarverse',version:'0.1.0'};
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest));
  for(const file of ['main.js','styles.css','LICENSE','versions.json'])await fs.writeFile(path.join(output,file),'fixture');
  const calls=[],commit='a'.repeat(40),url='https://github.com/'+distributionRepo+'/releases/tag/0.1.0';
  const dependencies={build:async()=>output,verify:async()=>commit,test:()=>{},request:async(endpoint,options={})=>{
    calls.push({endpoint,...options});
    if(endpoint.includes('/releases?'))return existing?[{tag_name:'0.1.0'}]:[];
    if(options.method==='POST' && endpoint.endsWith('/releases'))return {id:42,html_url:'https://github.com/'+distributionRepo+'/releases/tag/untagged-fixture',upload_url:'https://uploads.github.com/repos/'+distributionRepo+'/releases/42/assets{?name,label}'};
    if(options.method==='PATCH')return {html_url:url};
    if(failUpload && endpoint.includes('name=main.js'))throw new Error('Upload failed');
    return {};
  }};
  return {dependencies,calls,commit,output};
}

test('BRAT release is published only after every asset uploads and records the exact source commit',async t=>{
  const f=await fixture(t);
  const result=await releaseObsidian({notes:'Maps only',publish:true},f.dependencies);
  assert.equal(result.published,true);
  assert.equal(result.url,'https://github.com/'+distributionRepo+'/releases/tag/0.1.0');
  assert.equal(f.calls[0].endpoint,'/repos/'+sourceRepo+'/commits/'+f.commit);
  const created=f.calls.find(call=>call.endpoint.endsWith('/releases') && call.method==='POST');
  assert.equal(created.body.draft,true);assert.equal(created.body.tag_name,'0.1.0');
  assert.match(created.body.body,new RegExp(f.commit));
  const uploaded=f.calls.filter(call=>call.endpoint.startsWith('https://uploads.github.com'));
  assert.deepEqual(uploaded.map(call=>new URL(call.endpoint).searchParams.get('name')),['main.js','manifest.json','styles.css','versions.json','LICENSE','release.json']);
  assert.equal(JSON.parse(uploaded.at(-1).bytes.toString()).sourceCommit,f.commit);
  assert.equal(f.calls.at(-1).method,'PATCH');assert.equal(f.calls.at(-1).body.draft,false);
});

test('failed upload leaves an unpublished draft; default release also stays a draft',async t=>{
  const failed=await fixture(t,{failUpload:true});
  await assert.rejects(releaseObsidian({notes:'Maps',publish:true},failed.dependencies),/incomplete draft remains/);
  assert.ok(!failed.calls.some(call=>call.method==='PATCH'));
  const draft=await fixture(t);await releaseObsidian({notes:'Maps'},draft.dependencies);
  assert.ok(!draft.calls.some(call=>call.method==='PATCH'));
});

test('existing plugin releases are never overwritten, and uncommitted source cannot reach GitHub',async t=>{
  const f=await fixture(t,{existing:true});
  await assert.rejects(releaseObsidian({notes:'Maps'},f.dependencies),/already exists/);
  assert.ok(!f.calls.some(call=>call.method==='POST'));
  const dirty=await fixture(t);
  dirty.dependencies.verify=async()=>{throw new Error('Commit the reviewed source changes');};
  await assert.rejects(releaseObsidian({notes:'Maps'},dirty.dependencies),/Commit the reviewed/);
  assert.equal(dirty.calls.length,0);
  const changed=await fixture(t);let checks=0;
  changed.dependencies.verify=async()=>++checks===1?changed.commit:'b'.repeat(40);
  await assert.rejects(releaseObsidian({notes:'Maps'},changed.dependencies),/Source revision changed/);
  assert.equal(changed.calls.length,0);
});

test('a release tag must match the plugin version before any GitHub mutation',async t=>{
  const f=await fixture(t);
  await assert.rejects(releaseObsidian({notes:'Maps',tag:'obsidian/9.9.9'},f.dependencies),/tag must match/);
  assert.equal(f.calls.length,0);
  await releaseObsidian({notes:'Maps',tag:'obsidian/0.1.0'},f.dependencies);
});
