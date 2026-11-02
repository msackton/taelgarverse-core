import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {createWorker} from '../src/worker-handler.mjs';

test('noPublish notes and stubs are absent from local/export stores, publication payloads and Worker APIs',async t=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  const directory=fs.mkdtempSync(path.join(ROOT,'.cache','stub-publication-'));
  t.after(()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));fs.rmSync(directory,{recursive:true});});
  const vault=path.join(directory,'vault'),exported=path.join(directory,'export');
  const write=(root,relative,source)=>{
    const filename=path.join(root,relative);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,source);
  };
  const sources={
    'Public.md':'---\ntags: [status/wip]\n---\n# Public\n\n[[Stub]]',
    'Stub.md':'---\nnoPublish: false\ntags: [person, status/stub]\naliases: [Stub alias canary]\nmapPath: {source: _maps/missing.json}\n---\nSTUB_BODY_CANARY\n\n```dataview\nINVALID STUB QUERY\n```',
    'Scalar.md':'---\ntags: "#STATUS/STUB"\n---\nSCALAR_STUB_CANARY',
    'NoPublish.md':'---\nnoPublish: true\naliases: [NoPublish alias canary]\nmapPath: {source: _maps/missing.json}\n---\nNO_PUBLISH_BODY_CANARY\n\n```dataview\nINVALID UNPUBLISHED QUERY\n```',
    'Kept.md':'---\nnoPublish: false\ntags: [status/stubbed]\n---\nA different tag remains published.',
    'String.md':'---\nnoPublish: "true"\n---\nA string is not a boolean.',
  };
  for(const root of [vault,exported])for(const [relative,source] of Object.entries(sources))write(root,relative,source);
  write(vault,'_scripts/session_note_campaigns.json','{"campaigns":{}}');write(vault,'.obsidian/metadata.json','{}');
  const settings={vault_dir:vault,source_dir:exported,default_date:'1750-01-01',campaigns:[],home_source:null,nav_source:null};
  for(const source_dir of [vault,exported]){
    const store=new Store({...settings,source_dir});
    assert.deepEqual([...store.bySlug.keys()],['kept','public','string']);
    assert.equal(store.lookup('Stub alias canary').status,'missing');assert.equal(store.mapPathFiles.size,0);
    assert.equal(store.lookup('NoPublish alias canary').status,'missing');
  }
  const report=await prepareContent(settings,path.join(directory,'package'),{commit:'a'.repeat(40),dirty:false},{},undefined,undefined,{
    materialize:store=>{assert.deepEqual([...store.bySlug.keys()],['kept','public','string']);},
  });
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  assert.deepEqual(index.entries.filter(e=>e.note).map(e=>e.id),['Kept.md','Public.md','String.md']);
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  for(const file of [report.searchFile,...uploads.map(u=>u.file)])
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/Stub alias canary|STUB_BODY_CANARY|SCALAR_STUB_CANARY|NoPublish alias canary|NO_PUBLISH_BODY_CANARY/);
  const objects=new Map(uploads.map(u=>[u.key,u.file]));objects.set('published/current.json',report.pointerFile);
  const env={CONTENT:{async get(key){const file=objects.get(key);return file?{json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))}:null;}}};
  const worker=createWorker();
  for(const url of ['/api/page?page=Stub&dm=1','/page/stub?context=modern&dm=1','/api/page?page=Stub%20alias%20canary',
    '/api/page?page=NoPublish&dm=1','/page/nopublish?context=modern&dm=1','/api/page?page=NoPublish%20alias%20canary'])
    assert.equal((await worker.fetch(new Request('https://example.test'+url),env)).status,404,url);
  for(const [relative,source] of Object.entries(sources))assert.equal(fs.readFileSync(path.join(vault,relative),'utf8'),source);
});
