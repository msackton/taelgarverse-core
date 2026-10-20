import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/config.mjs';
import {nextVersion,validateReleaseNotes,latestPluginRelease,inspectRelease,prepareRelease,checkRelease,parseOptions} from '../scripts/prepare-obsidian-release.mjs';

async function fixture(t){
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const root=await fs.mkdtemp(path.join(ROOT,'.cache','prepare-release-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'obsidian/taelgarverse');await fs.mkdir(source,{recursive:true});
  const manifest={id:'taelgarverse',version:'0.1.0',minAppVersion:'1.8.0',name:'Taelgarverse'};
  await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
  await fs.writeFile(path.join(source,'versions.json'),JSON.stringify({'0.1.0':'1.8.0'}));
  await fs.writeFile(path.join(source,'release-notes.md'),'Taelgarverse 0.1.0\n\n- Initial maps.\n');
  await fs.writeFile(path.join(source,'main.mjs'),'// Published code\n');
  await fs.writeFile(path.join(root,'website.txt'),'Published website\n');
  const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git(['init','--initial-branch=main']);git(['add','.']);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Published source']);
  const published={version:'0.1.0',sourceCommit:git(['rev-parse','HEAD']),url:'https://example.invalid/0.1.0'};
  return {root,source,published,git,readPublished:async()=>published};
}

test('release inspection uses published provenance and includes working changes without changing Git or release files',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.source,'main.mjs'),'// New feature\n');
  await fs.writeFile(path.join(f.root,'website.txt'),'Unrelated website work\n');
  await fs.writeFile(path.join(f.source,'new-feature.mjs'),'// Untracked feature\n');
  const before=f.git(['status','--porcelain']),inspection=await inspectRelease(f);
  assert.equal(inspection.published.sourceCommit,f.published.sourceCommit);
  assert.ok(inspection.changedFiles.some(file=>file.endsWith('obsidian/taelgarverse/main.mjs')));
  assert.ok(inspection.changedFiles.some(file=>file.endsWith('website.txt')));
  assert.deepEqual(inspection.untrackedFiles,['obsidian/taelgarverse/new-feature.mjs']);
  assert.equal(f.git(['status','--porcelain']),before);
  assert.equal((await checkRelease(f)).version,'0.1.0');
});

test('preparation updates only release files, preserves compatibility history and unrelated changes, and can be repeated',async t=>{
  const f=await fixture(t),head=f.git(['rev-parse','HEAD']);
  await fs.writeFile(path.join(f.root,'website.txt'),'Unrelated edit\n');
  const notes='Taelgarverse 0.1.1\n\n- Improve tracing.\n';
  await fs.writeFile(path.join(f.root,'notes.md'),notes);
  const result=await prepareRelease({...f,bump:'patch',notesFile:'notes.md'});
  assert.equal(result.version,'0.1.1');assert.equal(result.previous.sourceCommit,f.published.sourceCommit);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.source,'versions.json'),'utf8')),{'0.1.0':'1.8.0','0.1.1':'1.8.0'});
  assert.equal(await fs.readFile(path.join(f.source,'release-notes.md'),'utf8'),notes);
  assert.equal(await fs.readFile(path.join(f.root,'website.txt'),'utf8'),'Unrelated edit\n');
  assert.equal(f.git(['rev-parse','HEAD']),head);assert.equal(f.git(['tag']),'');
  await prepareRelease({...f,bump:'patch',notesFile:'notes.md'});
  assert.equal((await checkRelease(f)).version,'0.1.1');
});

test('invalid or stale notes and non-increasing versions leave release files unchanged',async t=>{
  const f=await fixture(t),before=f.git(['status','--porcelain']);
  await assert.rejects(prepareRelease({...f,bump:'patch',notesFile:'obsidian/taelgarverse/release-notes.md'}),/must start with Taelgarverse 0.1.1/);
  await assert.rejects(prepareRelease({...f,version:'0.1.0',notesFile:'missing.md'}),/greater than/);
  await assert.rejects(prepareRelease({...f,bump:'patch',version:'0.1.1',notesFile:'missing.md'}),/exactly one/);
  assert.equal(f.git(['status','--porcelain']),before);
  const manifest=JSON.parse(await fs.readFile(path.join(f.source,'manifest.json'),'utf8'));manifest.version='0.2.0';
  await fs.writeFile(path.join(f.source,'manifest.json'),JSON.stringify(manifest));
  await fs.writeFile(path.join(f.source,'versions.json'),JSON.stringify({'0.1.0':'1.8.0','0.2.0':'1.8.0'}));
  await assert.rejects(prepareRelease({...f,bump:'patch',notesFile:'missing.md'}),/different version is already/);
});

test('missing or divergent published history fails rather than inventing a comparison point',async t=>{
  const f=await fixture(t);
  await assert.rejects(inspectRelease({...f,readPublished:async()=>({...f.published,sourceCommit:'f'.repeat(40)})}),/ancestor of HEAD/);
});

test('published comparison requires matching, clean provenance downloaded from the expected repository',async()=>{
  const urls=[],release={tag_name:'0.1.0',draft:false,prerelease:false,assets:[{name:'release.json'}]};
  const provenance={plugin:'taelgarverse',version:'0.1.0',sourceRepository:'msackton/taelgarverse-core',sourceCommit:'a'.repeat(40),sourceDirty:false};
  const request=async url=>{urls.push(url);return url.includes('api.github.com')?release:provenance;};
  assert.equal((await latestPluginRelease(request)).sourceCommit,provenance.sourceCommit);
  assert.equal(urls[1],'https://github.com/msackton/taelgarverse-obsidian/releases/download/0.1.0/release.json');
  provenance.sourceDirty=true;await assert.rejects(latestPluginRelease(request),/provenance is invalid/);
  release.assets=[];await assert.rejects(latestPluginRelease(request),/no source provenance/);
});

test('offline checks reject stale notes and inconsistent compatibility entries',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.source,'release-notes.md'),'Taelgarverse 0.2.0\n\n- Wrong notes.');
  await assert.rejects(checkRelease(f),/must start with Taelgarverse 0.1.0/);
  await fs.writeFile(path.join(f.source,'versions.json'),'{}');
  await assert.rejects(checkRelease(f),/must agree/);
});

test('version policy and CLI reject ambiguous inputs; note validation requires a matching title and body',()=>{
  assert.equal(nextVersion('0.1.9','patch'),'0.1.10');assert.equal(nextVersion('0.1.9','minor'),'0.2.0');assert.equal(nextVersion('0.1.9','major'),'1.0.0');
  assert.throws(()=>nextVersion('01.1.0','patch'),/x.y.z/);assert.throws(()=>nextVersion('0.1.0','automatic'),/Choose/);
  assert.throws(()=>validateReleaseNotes('Taelgarverse 0.1.1','0.1.1'),/description/);
  validateReleaseNotes('# Taelgarverse 0.1.1\n\n- Fix measurements.','0.1.1');
  assert.deepEqual(parseOptions(['prepare','--bump','patch','--notes-file','draft.md']),{command:'prepare',bump:'patch',notesFile:'draft.md'});
  for(const args of [['publish'],['check','--bump','patch'],['prepare','--bump'],['prepare','--bump','patch','--bump','minor']])assert.throws(()=>parseOptions(args));
});
