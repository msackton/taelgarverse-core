import {writeCampaignIndex} from './helpers/write-campaign-index.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {testSettings} from './helpers/test-settings.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {openSnapshot} from '../src/runtime-snapshot.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {Engine} from '../src/engine.mjs';
import {parseNote} from '../src/content-store.mjs';
import {copyWorkingVault} from '../scripts/website-working-vault.mjs';

const yaml='---\nheaderVersion: 2023.11.25\ntags: [person]\nspecies: human\nborn: 1700-01-01\n---\n';
const forms={
 callout:'# Authored title\n*(Authored pronunciation)*\n> [!taelgar-header]\n> Stale fallback.\n',
 codeblock:'```taelgar-header\n```\n',
 configured:'```taelgar-header\nkeep\n```\n',
 marker:'<!-- taelgar:header -->\n',
 saved:'# Old title\n>[!info] Saved details\n> Saved human\n',
};
test('publication preserves header source and Node, R2 and the compiled Worker render only native headers',async t=>{
 await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
 const directory=await fs.mkdtemp(path.join(ROOT,'.cache/header-callout-'));
 t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));await fs.rm(directory,{recursive:true});});
 const vault=path.join(directory,'vault');await fs.mkdir(path.join(vault,'.obsidian'),{recursive:true});await fs.mkdir(path.join(vault,'_scripts'));
 const settings=testSettings();
 writeCampaignIndex(vault);
 for(const file of ['.obsidian/metadata.json'])await fs.copyFile(path.join(settings.vault_dir,file),path.join(vault,file));
 for(const [name,header] of Object.entries(forms))await fs.writeFile(path.join(vault,name+'.md'),yaml+header+'\nAuthored prose.\n');
 const working=path.join(directory,'working');await copyWorkingVault(vault,working);
 const config={...settings,vault_dir:vault,source_dir:working,nav_source:null,home_source:null};
 const local=new Engine(config),report=await prepareContent(config,path.join(directory,'package'),{commit:'a'.repeat(40),dirty:false},{},undefined,undefined,{writePreparedNotes:true});
 await assert.rejects(fs.access(path.join(directory,'package','header-conversion-report.json')),{code:'ENOENT'});
 const manifest=JSON.parse(await fs.readFile(report.manifestFile,'utf8')),objects=new Map(manifest.map(item=>[item.key,item.file]));
 const bucket={get:async key=>objects.has(key)?{json:async()=>JSON.parse(await fs.readFile(objects.get(key),'utf8'))}:null};
 const compiled=await openSnapshot(bucket,report.revision),worker=createWorker();
 objects.set('published/current.json',report.pointerFile);
 for(const [name,header] of Object.entries(forms)) {
   const remote=await compiled.renderer();
   const entry=remote.store.resolve(name),packed=await remote.store.getNote(entry);
   const original=yaml+header+'\nAuthored prose.\n';
   if(['codeblock','configured'].includes(name))assert.equal(packed.body.trim(),'Authored prose.');
   else assert.equal(packed.body,parseNote(original).body);
   assert.equal(packed.metadata.headerVersion,'2023.11.25');
   assert.equal(await fs.readFile(path.join(vault,name+'.md'),'utf8'),original);
   assert.equal(await fs.readFile(path.join(working,name+'.md'),'utf8'),yaml+packed.body);
   const actual=await remote.engine.renderAsync(name,'1720-01-01',undefined,false,undefined,e=>remote.store.getNote(e));
   assert.equal(actual.html,local.render(name,'1720-01-01').html);
   const response=await worker.fetch(new Request('https://taelgar.org/api/page?page='+name+'&date=1720-01-01'),{CONTENT:bucket});
   assert.equal(response.status,200);assert.equal((await response.json()).html,actual.html);
   if(name==='callout'){for(const value of ['Authored title','Authored pronunciation','20 years old'])assert.ok(actual.html.includes(value));assert.doesNotMatch(actual.html,/Stale fallback/);}
   else assert.doesNotMatch(actual.html,/20 years old/);
 }
});
