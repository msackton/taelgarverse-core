import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {testSettings} from './helpers/test-settings.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {loadSnapshot} from '../src/snapshot.mjs';
import {openSnapshot} from '../src/runtime-snapshot.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {Engine} from '../src/engine.mjs';
import {convertWebsiteNote} from '../src/website-compatibility.mjs';
import {parseNote} from '../src/content-store.mjs';
import {migrateLegacyHeader} from '../src/header-rewrite.mjs';
import {convertWebsiteHeaders} from '../scripts/convert-website-headers.mjs';
import {copyWorkingVault} from '../scripts/website-working-vault.mjs';

const yaml='---\nheaderVersion: 2023.11.25\ntags: [person]\nspecies: human\nborn: 1700-01-01\n---\n';
const forms={
 callout:'# Authored title\n*(Authored pronunciation)*\n> [!taelgar-header]\n> Stale fallback.\n',
 codeblock:'```taelgar-header\n```\n',
 marker:'<!-- taelgar:header -->\n',
 saved:'# Old title\n>[!info] Saved details\n> Saved human\n',
};
for(const [name,header] of Object.entries(forms))test('website conversion preserves '+name+' without header compatibility rewrites',()=>{
 const source=yaml+header+'\nAuthored prose.\n';
 const result=convertWebsiteNote(parseNote(source));assert.equal(result.note.source,source);assert.deepEqual(result.changes,[]);
});

test('publication migrates legacy headers on its copy; Node, R2 and compiled Worker use only native callouts',async t=>{
 await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
 const directory=await fs.mkdtemp(path.join(ROOT,'.cache/header-callout-'));
 t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));await fs.rm(directory,{recursive:true});});
 const vault=path.join(directory,'vault');await fs.mkdir(path.join(vault,'.obsidian'),{recursive:true});await fs.mkdir(path.join(vault,'_scripts'));
 const settings=testSettings();
 for(const file of ['.obsidian/metadata.json','_scripts/session_note_campaigns.json'])await fs.copyFile(path.join(settings.vault_dir,file),path.join(vault,file));
 for(const [name,header] of Object.entries(forms))await fs.writeFile(path.join(vault,name+'.md'),yaml+header+'\nAuthored prose.\n');
 const working=path.join(directory,'working');await copyWorkingVault(vault,working);
 const config={...settings,vault_dir:vault,source_dir:working,nav_source:null,home_source:null};
 const local=new Engine(config),report=await prepareContent(config,path.join(directory,'package'),{commit:'a'.repeat(40),dirty:false},{},undefined,undefined,{writePreparedNotes:true});
 assert.deepEqual(report.headerConversion.counts,{changed:3,unchanged:1,skipped:0,error:0});
 assert.equal(report.headerConversion.applied,3);
 assert.deepEqual(JSON.parse(await fs.readFile(report.headerConversionReportFile,'utf8')),report.headerConversion);
 const manifest=JSON.parse(await fs.readFile(report.manifestFile,'utf8')),objects=new Map(manifest.map(item=>[item.key,item.file]));
 const bucket={get:async key=>objects.has(key)?{json:async()=>JSON.parse(await fs.readFile(objects.get(key),'utf8'))}:null};
 const remote=await loadSnapshot(bucket,report.revision);
 const compiled=await openSnapshot(bucket,report.revision),worker=createWorker();
 objects.set('published/current.json',report.pointerFile);
 for(const [name,header] of Object.entries(forms)) {
   const entry=remote.store.resolve(name),packed=await remote.store.getNote(entry);
   const original=yaml+header+'\nAuthored prose.\n';
   const migrated=migrateLegacyHeader(original,{filename:name+'.md',coreMeta:local.headers.coreMeta});
   assert.equal(packed.source,migrated.source || original);
   if(name==='callout')assert.equal(packed.metadata.headerVersion,'2023.11.25','publication preserves existing native headers');
   else assert.equal(packed.metadata.headerVersion,undefined,'publication conversions remove the legacy metadata field');
   assert.equal(await fs.readFile(path.join(vault,name+'.md'),'utf8'),original);
   assert.equal(await fs.readFile(path.join(working,name+'.md'),'utf8'),packed.source);
   local.store.resolve(name).note=parseNote(packed.source);
   const actual=await remote.engine.renderAsync(name,'1720-01-01',undefined,false,undefined,e=>remote.store.getNote(e));
   assert.equal(actual.html,local.render(name,'1720-01-01').html);
   const runtime=await compiled.forRequest(new Request('https://taelgar.org/api/page?page='+name));
   const optimized=await runtime.engine.renderAsync(name,'1720-01-01',undefined,false,undefined,e=>runtime.store.getNote(e));
   assert.equal(optimized.html,actual.html);
   const response=await worker.fetch(new Request('https://taelgar.org/api/page?page='+name+'&date=1720-01-01'),{CONTENT:bucket});
   assert.equal(response.status,200);assert.equal((await response.json()).html,actual.html);
   if(name==='callout'){for(const value of ['Authored title','Authored pronunciation','20 years old'])assert.ok(actual.html.includes(value));assert.doesNotMatch(actual.html,/Stale fallback/);}
   else {assert.match(actual.html,/20 years old/);assert.doesNotMatch(actual.html,/Saved human|Old title|language-taelgar-header/);}
 }
});

test('publication migration preserves native authored headers, unmarked notes and ineligible legacy headers',()=>{
 const native=yaml+'# A deliberate title\n*(A deliberate pronunciation)*\nIntroduction.\n\n> [!taelgar-header]\n> A deliberate fallback.\n';
 const unmarked=yaml+'# Authored\n\nProse.\n';
 const excluded=['session-note','meta','background','source','story',null].map(tag=>
   '---\n'+(tag?'tags: [person, '+tag+'/detail]\n':'')+'headerVersion: old\n---\nProse before\n> [!info]\n> Keep.\n');
 const entries=[native,unmarked,...excluded].map((source,index)=>({id:index+'.md',note:parseNote(source)}));
 const before=entries.map(entry=>entry.note.source),report=convertWebsiteHeaders({entries});
 assert.equal(report.problems.length,0);assert.equal(report.applied,0);
 assert.deepEqual(entries.map(entry=>entry.note.source),before);
 assert.equal(report.counts.unchanged,1);assert.equal(report.counts.skipped,7);
});

test('ambiguous legacy headers prevent the entire publication migration and provide per-file diagnostics',()=>{
 const sources=[yaml+forms.saved+'\nKeep.\n',yaml+'# Title\nAuthored introduction.\n\n> [!info]\n> Keep.\n',yaml+'```taelgar-header\nconfiguration: keep\n```\n'];
 const entries=sources.map((source,index)=>({id:index+'.md',note:parseNote(source)}));
 const report=convertWebsiteHeaders({entries});
 assert.equal(report.counts.changed,1);assert.equal(report.problems.length,2);assert.equal(report.applied,0);
 assert.deepEqual(entries.map(entry=>entry.note.source),sources);
 assert.deepEqual(report.problems.map(problem=>problem.file),['1.md','2.md']);
});

test('legacy fence migration requires an empty closed leading fence and is idempotent',()=>{
 const source=yaml.replaceAll('\n','\r\n')+'# Old\r\n```taelgar-header\r\n```\r\n\r\nBody.\r\n';
 const result=migrateLegacyHeader(source,{filename:'Fausto.md'});
 assert.equal(result.kind,'converted');assert.match(result.source,/# Fausto\r\n> \[!taelgar-header\]\r\n> \(human, b\. 1700\)/);
 assert.ok(result.source.endsWith('\r\nBody.\r\n'));
 assert.equal(migrateLegacyHeader(result.source).status,'unchanged');
 for(const fence of ['```taelgar-header\n','```taelgar-header\nkeep\n```\n','```taelgar-header options\n```\n'])
   assert.equal(migrateLegacyHeader(yaml+fence).problem,true);
 for(const example of ['````markdown\n```taelgar-header\n```\n````\n','> ```taelgar-header\n> ```\n','- Example\n  ```taelgar-header\n  ```\n']) {
   const literal=migrateLegacyHeader(yaml+example);
   assert.equal(literal.status,'skipped');assert.equal(literal.problem,undefined);
 }
});

test('header conversion failure writes diagnostics and stops preparation before downstream stages',async t=>{
 const directory=await fs.mkdtemp(path.join(ROOT,'.cache/header-failure-'));
 t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));await fs.rm(directory,{recursive:true});});
 const vault=path.join(directory,'vault'),settings=testSettings();await fs.mkdir(path.join(vault,'.obsidian'),{recursive:true});await fs.mkdir(path.join(vault,'_scripts'));
 for(const file of ['.obsidian/metadata.json','_scripts/session_note_campaigns.json'])await fs.copyFile(path.join(settings.vault_dir,file),path.join(vault,file));
 const source=yaml+'```taelgar-header\nkeep\n```\n';await fs.writeFile(path.join(vault,'Unsafe.md'),source);
 const output=path.join(directory,'package'),logs=[];
 await assert.rejects(prepareContent({...settings,vault_dir:vault,source_dir:vault,nav_source:null,home_source:null},output,{commit:'a'.repeat(40),dirty:false},{},undefined,undefined,{log:message=>logs.push(message)}),/Legacy header conversion needs review/);
 const report=JSON.parse(await fs.readFile(path.join(output,'header-conversion-report.json'),'utf8'));
 assert.equal(report.problems.length,1);assert.equal(report.problems[0].file,'Unsafe.md');assert.equal(report.applied,0);
 assert.ok(!logs.some(message=>message.includes('Preparing map tiles')));
 await assert.rejects(fs.access(path.join(output,'current.json')),{code:'ENOENT'});
 assert.equal(await fs.readFile(path.join(vault,'Unsafe.md'),'utf8'),source);
});
