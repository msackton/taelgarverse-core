import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {readFolderExclusions} from '../src/folder-exclusions.mjs';
import {buildFingerprint,parseOptions} from '../scripts/publish-content.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {createWorker} from '../src/worker-handler.mjs';

const chats='Campaigns/Cleenseau Campaign/Chats';
function fixture(t) {
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  const directory=fs.mkdtempSync(path.join(ROOT,'.cache','folder-exclusion-test-'));
  t.after(()=>{
    assert.ok(isInside(path.join(ROOT,'.cache'),directory));
    assert.equal(path.dirname(directory),path.join(ROOT,'.cache'));
    assert.ok(path.basename(directory).startsWith('folder-exclusion-test-'));
    fs.rmSync(directory,{recursive:true});
  });
  const vault=path.join(directory,'vault'), exported=path.join(directory,'export');
  const write=(root,relative,text)=>{
    const filename=path.join(root,relative);
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    fs.writeFileSync(filename,text);return filename;
  };
  for(const root of [vault,exported]) {
    write(root,'Public.md','# Public\n\n[[Secret]]');
    write(root,chats+'/Secret.md','---\naliases: [Hidden chat alias]\n---\nCHAT_PUBLICATION_CANARY');
    write(root,chats+'/Nested/Child.md','NESTED_PUBLICATION_CANARY');
    write(root,chats+'/secret.png','not an image; packaging must never read it');
    write(root,'Campaigns/Cleenseau Campaign/Chats Archive/Public.md','# Archive');
    write(root,'Campaigns/Cleenseau Campaign/Chats-extra/Public.md','# Extra');
  }
  write(vault,'_scripts/session_note_campaigns.json','{"campaigns":{}}');
  write(vault,'.obsidian/metadata.json','{}');
  const marker=write(vault,chats+'/.nopublish','Excluded from publication.');
  const settings={vault_dir:vault,source_dir:exported,default_date:'1750-01-01',campaigns:[],home_source:null,nav_source:null};
  return {directory,vault,exported,write,marker,settings};
}

test('a folder marker excludes descendants and media in previews and exports without affecting similarly named siblings',t=>{
  const {vault,exported,settings}=fixture(t);
  assert.deepEqual(readFolderExclusions(vault),[chats]);
  assert.equal(fs.existsSync(path.join(exported,chats,'.nopublish')),false);
  for(const source_dir of [vault,exported]) {
    const store=new Store({...settings,source_dir});
    assert.equal(store.entries.some(entry=>entry.id.startsWith(chats+'/')),false);
    assert.equal(store.lookup('Hidden chat alias').status,'missing');
    assert.ok(store.bySlug.has('campaigns/cleenseau-campaign/chats-archive/public'));
    assert.ok(store.bySlug.has('campaigns/cleenseau-campaign/chats-extra/public'));
    assert.ok(store.bySlug.has('public'));
  }
});

test('source-copy markers and ancestor markers also exclude complete subtrees',t=>{
  const {vault,exported,settings,write}=fixture(t);
  write(exported,'Source Only/.nopublish','');
  write(exported,'Source Only/Secret.md','Source-only private note');
  write(vault,chats+'/Nested/.nopublish','');
  assert.deepEqual(readFolderExclusions(vault),[chats]);
  assert.equal(new Store(settings).lookup('Source Only/Secret.md').status,'missing');
  write(vault,'.nopublish','');
  assert.deepEqual(readFolderExclusions(vault),['']);
  assert.equal(new Store(settings).entries.length,0);
});

test('marker additions and removals invalidate publication fingerprints; explanatory text is not policy',t=>{
  const {settings,marker}=fixture(t),options=parseOptions([]);
  const flagged=buildFingerprint(settings,options);
  fs.writeFileSync(marker,'A different explanation.');
  assert.equal(buildFingerprint(settings,options),flagged);
  fs.unlinkSync(marker);
  const unflagged=buildFingerprint(settings,options);
  assert.notEqual(unflagged,flagged);
  assert.ok(new Store(settings).lookup('Hidden chat alias').entry);
  fs.writeFileSync(marker,'');
  assert.equal(buildFingerprint(settings,options),flagged);
});

test('publication omits flagged note bodies, metadata, search documents and media; Worker APIs cannot retrieve them',async t=>{
  const {directory,settings}=fixture(t);
  const report=await prepareContent(settings,path.join(directory,'package'),{commit:'a'.repeat(40),dirty:false});
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  assert.equal(index.entries.some(entry=>entry.id.startsWith(chats+'/')),false);
  assert.doesNotMatch(JSON.stringify(index),/Hidden chat alias|CHAT_PUBLICATION_CANARY|NESTED_PUBLICATION_CANARY/);
  assert.doesNotMatch(fs.readFileSync(report.searchFile,'utf8'),/Hidden chat alias|CHAT_PUBLICATION_CANARY|NESTED_PUBLICATION_CANARY/);
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  for(const upload of uploads) assert.doesNotMatch(fs.readFileSync(upload.file,'utf8'),/Hidden chat alias|CHAT_PUBLICATION_CANARY|NESTED_PUBLICATION_CANARY/);
  assert.equal(uploads.some(upload=>upload.key.startsWith('assets/')),false);
  const objects=new Map(uploads.map(upload=>[upload.key,upload.file]));
  objects.set('published/current.json',report.pointerFile);
  const env={CONTENT:{async get(key){const file=objects.get(key);return file?{json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))}:null;}}};
  const worker=createWorker();
  for(const url of ['/api/page?page=Hidden%20chat%20alias&dm=1','/page/campaigns/cleenseau-campaign/chats/secret?context=modern&dm=1','/assets/campaigns/cleenseau-campaign/chats/secret.png','/api/page?page=Campaigns%2FCleenseau%20Campaign%2FChats%2FNested%2FChild.md']) {
    const response=await worker.fetch(new Request('https://example.test'+url),env);
    assert.equal(response.status,404,url);
    assert.doesNotMatch(await response.text(),/CHAT_PUBLICATION_CANARY|NESTED_PUBLICATION_CANARY/);
  }
});
