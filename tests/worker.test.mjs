import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,loadSettings,isInside} from '../src/config.mjs';
import {Engine} from '../src/engine.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {loadSnapshot} from '../src/snapshot.mjs';
import {instantiate,headerRevision} from '../.generated/headers.mjs';

let directory,report,bucket,engine,worker,env;
class LocalBucket {
  constructor(uploads) {this.objects=new Map(uploads.map(item=>[item.key,item.file]));this.calls=new Map();this.missing=new Set();}
  async get(key,options={}) {
    this.calls.set(key,(this.calls.get(key)||0)+1);
    if (this.missing.has(key) || !this.objects.has(key)) return null;
    const data=fs.readFileSync(this.objects.get(key)),range=options.range;
    return {size:data.length,json:async()=>JSON.parse(data.toString()),body:new Blob([range ? data.subarray(range.offset,range.offset+range.length) : data]).stream()};
  }
}
const request = (url,options)=>worker.fetch(new Request('https://example.test'+url,options),env);
before(async()=>{
  directory=fs.mkdtempSync(path.join(ROOT,'.cache','worker-test-'));
  const source=path.join(directory,'notes');fs.mkdirSync(source);
  const notes=JSON.parse(fs.readFileSync(new URL('./fixtures/notes.json',import.meta.url),'utf8'));
  for (const [relative,text] of Object.entries(notes)) {
    const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);
  }
  fs.writeFileSync(path.join(source,'tiny.png'),'fixture asset');
  fs.writeFileSync(path.join(source,'_ignore.txt'),'Ignored/\n');
  fs.writeFileSync(path.join(source,'_nav.md'),'- [Home](index.md)\n- People\n    - {glob: people/}\n- Places\n    - {glob: places/}\n');
  const settings={...loadSettings(),source_dir:source,ignore_file:path.join(source,'_ignore.txt'),nav_source:path.join(source,'_nav.md')};
  report=await prepareContent(settings,path.join(directory,'package'));
  bucket=new LocalBucket(JSON.parse(fs.readFileSync(report.manifestFile,'utf8')));
  env={CONTENT:bucket,CONTENT_REVISION:report.revision,ASSETS:{fetch:async()=>new Response('theme')}};
  engine=new Engine(settings);worker=createWorker(instantiate,headerRevision);
});
after(()=>{if(directory && isInside(path.join(ROOT,'.cache'),directory))fs.rmSync(directory,{recursive:true});});

test('packaged snapshot has no machine paths or raw note bodies in the metadata index',()=>{
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  assert.equal(index.entries.filter(e=>e.note).length,engine.store.bySlug.size);
  assert.equal(index.entries.some(e=>e.id.startsWith('_') || e.id==='Hidden.md'),false);
  assert.doesNotMatch(JSON.stringify(index),/source_dir|runtime_dir|Fixture biography|private ordinary comment/);
  assert.equal(index.entries.every(e=>!('filename' in e)),true);
});

test('Worker renders the same article as the VM reference and isolates request preferences',async()=>{
  const settings=[['1720-01-01',false],['1730-01-01',true],['1720-01-01',true],['1730-01-01',false]];
  const results=await Promise.all(settings.map(async([date,dm])=>{
    const response=await request('/api/page?'+new URLSearchParams({page:'Example',date,dm:String(dm)}));
    assert.equal(response.status,200);
    const result=await response.json();
    assert.deepEqual(result,engine.render('Example',date,undefined,dm));
    return result;
  }));
  assert.doesNotMatch(results[0].html,/private ordinary comment|secret body/);
  assert.match(results[1].html,/private ordinary comment|secret body/);
  const key='revisions/'+report.revision+'/index.json';assert.equal(bucket.calls.get(key),1);
  const entry=engine.store.resolve('Example');
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  const shard=index.entries.find(e=>e.id===entry.id).note.shard;
  assert.equal(bucket.calls.get('revisions/'+report.revision+'/notes/'+shard+'.json'),1);
});

test('Worker serves HTML/navigation, assets with ranges/ETags, HEAD, and normal errors',async()=>{
  const html=await(await request('/page/people/example?date=1720-01-01&dm=1')).text();
  assert.match(html,/Site navigation|Breadcrumb/);assert.match(html,/See Behind the Curtain/);
  const asset=await request('/assets/tiny.png',{headers:{Range:'bytes=0-6'}});
  assert.equal(asset.status,206);assert.equal(await asset.text(),'fixture');
  assert.equal(asset.headers.get('content-range'),'bytes 0-6/13');
  const cached=await request('/assets/tiny.png',{headers:{'If-None-Match':asset.headers.get('etag')}});
  assert.equal(cached.status,304);
  assert.equal((await request('/assets/tiny.png',{headers:{Range:'bytes=99-100'}})).status,416);
  assert.equal(await(await request('/api/page?page=Example&date=1720-01-01',{method:'HEAD'})).text(),'');
  for (const [url,status] of [['/api/page?page=Hidden',404],['/api/page?page=Broken',422],['/api/page?page=Example&date=bad',400],['/assets/missing.png',404],['/api/navigation?branch=missing',404]]) {
    assert.equal((await request(url)).status,status,url);
  }
  assert.equal((await request('/health',{method:'POST'})).status,405);
  assert.equal((await(await request('/health')).json()).runtime,'cloudflare-worker');
});

test('snapshot load failures can recover and mismatched runtime revisions fail clearly',async()=>{
  await assert.rejects(loadSnapshot(bucket,report.revision,instantiate,'different'),{status:503});
  const failing=new LocalBucket(JSON.parse(fs.readFileSync(report.manifestFile,'utf8'))), key='revisions/'+report.revision+'/index.json';
  failing.missing.add(key);
  const retry=createWorker(instantiate,headerRevision), retryEnv={...env,CONTENT:failing};
  assert.equal((await retry.fetch(new Request('https://example.test/health'),retryEnv)).status,503);
  failing.missing.delete(key);
  assert.equal((await retry.fetch(new Request('https://example.test/health'),retryEnv)).status,200);
});
