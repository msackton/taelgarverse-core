import {preparedPart} from './helpers/compiled-publication.mjs';
import {writeCampaignIndex} from './helpers/write-campaign-index.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {copyWorkingVault} from '../scripts/website-working-vault.mjs';
import {createWorker} from '../src/worker-handler.mjs';

test('publication filters whole-note exclusions and secret spans from stores, snapshots and Worker APIs',async t=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  const directory=fs.mkdtempSync(path.join(ROOT,'.cache','stub-publication-'));
  t.after(()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));fs.rmSync(directory,{recursive:true});});
  const vault=path.join(directory,'vault'),exported=path.join(directory,'export');
  const write=(root,relative,source)=>{
    const filename=path.join(root,relative);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,source);
  };
  const sources={
    'Public.md':'---\r\ntags: [status/wip]\r\naliases: [SECRET_YAML_CANARY] ##secret\r\n---\r\n# Public\r\n\r\n[[Stub]]\r\n\r\n'+
      '%%SECRET\r\nSECRET_BODY_CANARY\r\n%%\r\n%%SECRET[42]%%\r\n'+
      '%% Ordinary aside %%\r\n%%^Campaign:none%%\r\nCampaign aside.\r\n%%^End%%\r\n',
    'Stub.md':'---\nnoPublish: false\ntags: [person, status/stub]\naliases: [Stub alias canary]\nmapPath: {source: _maps/missing.json}\n---\nSTUB_BODY_CANARY\n\n```dataview\nINVALID STUB QUERY\n```',
    'Scalar.md':'---\ntags: "#STATUS/STUB"\n---\nSCALAR_STUB_CANARY',
    'NoPublish.md':'---\nnoPublish: true ##secret\naliases: [NoPublish alias canary]\nmapPath: {source: _maps/missing.json}\n---\nNO_PUBLISH_BODY_CANARY\n\n```dataview\nINVALID UNPUBLISHED QUERY\n```',
    'Kept.md':'---\nnoPublish: false\ntags: [status/stubbed]\n---\nA different tag remains published.',
    'String.md':'---\nnoPublish: "true"\n---\nA string is not a boolean.',
  };
  for(const [relative,source] of Object.entries(sources))write(vault,relative,source);
  writeCampaignIndex(vault);write(vault,'.obsidian/metadata.json','{}');
  write(vault,'_website/home.md','# Homepage\n\n%%SECRET SECRET_HOME_CANARY %%\n');
  write(vault,'_website/navigation.md','- [[Public]]\n%%SECRET SECRET_NAV_CANARY %%\n');
  write(vault,'_website/test-campaign.md','---\ncampaigns: []\n---\n# Campaign home\n\n%%SECRET SECRET_CAMPAIGN_HOME_CANARY %%\n');
  await copyWorkingVault(vault,exported);
  assert.doesNotMatch(fs.readFileSync(path.join(exported,'Public.md'),'utf8'),/SECRET_/);
  assert.equal(fs.existsSync(path.join(exported,'NoPublish.md')),false);
  const settings={vault_dir:vault,source_dir:exported,default_date:'1750-01-01',campaigns:[],
    home_source:path.join(vault,'_website/home.md'),nav_source:path.join(vault,'_website/navigation.md')};
  for(const source_dir of [vault,exported]){
    const store=new Store({...settings,source_dir});
    assert.deepEqual([...store.bySlug.keys()],['kept','public','string']);
    assert.equal(store.lookup('Stub alias canary').status,'missing');assert.equal(store.mapPathFiles.size,0);
    assert.equal(store.lookup('NoPublish alias canary').status,'missing');
    assert.equal(store.lookup('SECRET_YAML_CANARY').status,'missing');
    assert.doesNotMatch(store.bySlug.get('public').note.source,/SECRET_/);
  }
  const report=await prepareContent(settings,path.join(directory,'package'),{commit:'a'.repeat(40),dirty:false},{},undefined,undefined,{
    materialize:store=>{
      assert.deepEqual([...store.bySlug.keys()],['kept','public','string']);
      assert.doesNotMatch(store.bySlug.get('public').note.source,/SECRET_/);
    },
  });
  const index=preparedPart(report,'render');
  assert.deepEqual(index.entries.filter(e=>e.note).map(e=>e.id),['Kept.md','Public.md','String.md']);
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  for(const file of [report.searchFile,...uploads.map(u=>u.file)])
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/Stub alias canary|STUB_BODY_CANARY|SCALAR_STUB_CANARY|NoPublish alias canary|NO_PUBLISH_BODY_CANARY|SECRET_.*CANARY/);
  const objects=new Map(uploads.map(u=>[u.key,u.file]));objects.set('published/current.json',report.pointerFile);
  const env={CONTENT:{async get(key){const file=objects.get(key);return file?{json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))}:null;}}};
  const worker=createWorker();
  for(const url of ['/api/page?page=Stub&dm=1','/page/stub?context=modern&dm=1','/api/page?page=Stub%20alias%20canary',
    '/api/page?page=NoPublish&dm=1','/page/nopublish?context=modern&dm=1','/api/page?page=NoPublish%20alias%20canary'])
    assert.equal((await worker.fetch(new Request('https://example.test'+url),env)).status,404,url);
  const page=await worker.fetch(new Request('https://example.test/api/page?page=Public&dm=1'),env);
  assert.equal(page.status,200);
  const output=await page.text();
  assert.match(output,/Ordinary aside/);
  assert.match(output,/Campaign aside/);
  assert.doesNotMatch(output,/SECRET_/);
  for(const [relative,source] of Object.entries(sources))assert.equal(fs.readFileSync(path.join(vault,relative),'utf8'),source);
});

test('malformed secret markup fails closed before a Markdown file can be copied or served',async t=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  const dir=fs.mkdtempSync(path.join(ROOT,'.cache','malformed-secret-'));
  t.after(()=>{assert.ok(isInside(path.join(ROOT,'.cache'),dir));fs.rmSync(dir,{recursive:true});});
  const vault=path.join(dir,'vault');
  fs.mkdirSync(vault);
  const source=path.join(vault,'Broken.md');
  for(const [name,text,message] of [
    ['block','# Public\n%%SECRET SECRET_CANARY','unclosed SECRET block'],
    ['scalar','---\nspoiler: | ##secret\n  SECRET_CANARY\n---\n','secret frontmatter must be on one line'],
    ['sequence','---\nspoiler: ##secret\n- SECRET_CANARY\n---\n','secret frontmatter must be on one line'],
  ]){
    fs.writeFileSync(source,text);
    const pattern=new RegExp('Broken\\.md: '+message+' at line 2');
    const check=error=>pattern.test(error.message) && !error.message.includes('SECRET_CANARY');
    const working=path.join(dir,name);
    await assert.rejects(copyWorkingVault(vault,working),check);
    assert.throws(()=>new Store({vault_dir:vault,source_dir:vault}),check);
    assert.equal(fs.existsSync(path.join(working,'Broken.md')),false);
    assert.equal(fs.readFileSync(source,'utf8'),text);
  }
});
