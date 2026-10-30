import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {isBuiltin} from 'node:module';
import {tokenizer} from 'acorn';
import {ROOT} from '../src/config.mjs';
import {formatHeaderToolStatus,headerToolExitCode,runHeaderTool} from '../src/header-tool.mjs';
import {buildHeaderTool} from '../scripts/build-obsidian.mjs';
import {installHeaderTool} from '../obsidian/taelgarverse/header-tool.mjs';

async function fixture(t) {
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const root=await fs.mkdtemp(path.join(ROOT,'.cache/header-tool-'));
  t.after(()=>fs.rm(root,{recursive:true}));
  await fs.mkdir(path.join(root,'.obsidian/plugins/taelgarverse'),{recursive:true});
  return root;
}
const source='---\nname: Fausto\ntags: [person]\nspecies: human\n---\n# Old\n> [!info]+ Bio\n> Old\n\nAuthored biography.\n';

test('console output contains one concise status per file, no header bodies, and accurate preview/write summaries',()=>{
  const files=[{file:'Convert.md',status:'changed',kind:'converted',before:'Private old header',after:'Private new header'},
    {file:'Add.md',status:'changed',kind:'added'},{file:'Regenerate.md',status:'changed',kind:'regenerated'},
    {file:'Current.md',status:'unchanged'},{file:'Skipped.md',status:'skipped',reason:'Header ineligible: no tags.'},
    {file:'Broken.md',status:'error',reason:'Invalid YAML\nSensitive source excerpt'}];
  const report={dryRun:true,written:0,counts:{changed:3,unchanged:1,skipped:1,error:1},files};
  const preview=formatHeaderToolStatus(report);
  assert.deepEqual(preview.split('\n'),['WOULD CONVERT Convert.md','WOULD ADD Add.md','WOULD REGENERATE Regenerate.md',
    'UNCHANGED Current.md','SKIPPED Skipped.md — Header ineligible: no tags.','ERROR Broken.md — Invalid YAML',
    'Preview: 3 changes, 1 unchanged, 1 skipped, 1 error; 0 files written.']);
  assert.doesNotMatch(preview,/Private|Sensitive/);
  const stopped=formatHeaderToolStatus({...report,dryRun:false});assert.match(stopped,/^NOT WRITTEN Convert.md/m);
  const written=formatHeaderToolStatus({...report,dryRun:false,written:1,files:[{...files[0],written:true},...files.slice(1)]});
  assert.match(written,/^CONVERTED Convert.md/m);assert.match(written,/1 file written\.$/);
});

test('--errors hides ordinary statuses and normal skips while retaining errors, unsafe header skips and unapplied writes',()=>{
  const report={dryRun:true,errorsOnly:true,written:0,counts:{changed:1,unchanged:1,skipped:3,error:1},files:[
    {file:'Changed.md',status:'changed',kind:'regenerated'}, {file:'Current.md',status:'unchanged'},
    {file:'Ineligible.md',status:'skipped',reason:'Header ineligible: no tags.'},
    {file:'Unmarked.md',status:'skipped',reason:'No recognized header.'},
    {file:'Ambiguous.md',status:'skipped',problem:true,reason:'Unexpected content before the first header callout.'},
    {file:'Broken.md',status:'error',reason:'Invalid YAML\nSensitive source excerpt'}]};
  assert.equal(formatHeaderToolStatus(report),
    'PROBLEM Ambiguous.md — Unexpected content before the first header callout.\nERROR Broken.md — Invalid YAML');
  assert.match(formatHeaderToolStatus({...report,dryRun:false}),/^NOT WRITTEN Changed.md/m);
  assert.equal(formatHeaderToolStatus({...report,files:report.files.slice(0,4)}),'','a clean problem-only run is completely silent');
});

test('--check exits nonzero for planned changes and problems, but not normal eligibility/unmarked skips',async t=>{
  const root=await fixture(t),file=path.join(root,'Fausto.md');await fs.writeFile(file,source);
  let report=await runHeaderTool(['--vault',root,'--file','Fausto.md','--check','--errors']);
  assert.equal(report.check,true);assert.equal(report.dryRun,true);assert.equal(report.written,0);
  assert.equal(headerToolExitCode(report),1);assert.equal(formatHeaderToolStatus(report),'','planned changes alone are hidden by --errors');
  assert.equal(await fs.readFile(file,'utf8'),source,'--check never applies a change');
  await assert.rejects(runHeaderTool(['--vault',root,'--file','Fausto.md','--check','--write']),/cannot be combined/);
  await runHeaderTool(['--vault',root,'--file','Fausto.md','--write']);
  report=await runHeaderTool(['--vault',root,'--file','Fausto.md','--check']);assert.equal(headerToolExitCode(report),0);
  for(const content of ['---\ntags: [person]\n---\nAn unmarked note.','---\ntags: [session-note]\n---\n> [!taelgar-header]\n']) {
    await fs.writeFile(file,content);report=await runHeaderTool(['--vault',root,'--file','Fausto.md','--check']);assert.equal(headerToolExitCode(report),0);
  }
  for(const content of ['---\ntags: [person]\n---\nIntro.\n\n> [!taelgar-header]\n',
    '---\ntags: [person]\n---\n```taelgar-header\n```\n','---\ninvalid: [\n---\n']) {
    await fs.writeFile(file,content);report=await runHeaderTool(['--vault',root,'--file','Fausto.md','--check']);
    assert.equal(headerToolExitCode(report),1);assert.ok(report.files[0].problem || report.files[0].status==='error');
  }
});

test('CLI previews, writes a specific note, supports --add and is idempotent',async t=>{
  const root=await fixture(t),file=path.join(root,'Fausto.md');await fs.writeFile(file,source);
  let report=await runHeaderTool(['--vault',root,'--file','Fausto.md']);
  assert.equal(report.dryRun,true);assert.equal(report.counts.changed,1);assert.equal(report.written,0);
  assert.match(report.files[0].before,/> Old/);assert.match(report.files[0].after,/\(human\)/);assert.equal(await fs.readFile(file,'utf8'),source);
  report=await runHeaderTool(['--vault',root,'--file','Fausto.md','--write']);assert.equal(report.written,1);
  report=await runHeaderTool(['--vault',root,'--file','Fausto.md','--write']);assert.equal(report.counts.unchanged,1);assert.equal(report.written,0);
  const prose='---\ntags: [person]\n---\nOpening paragraph.\n';await fs.writeFile(file,prose);
  report=await runHeaderTool(['--vault',root,'--file','Fausto.md','--add','--write']);
  assert.equal(report.files[0].kind,'added');assert.ok((await fs.readFile(file,'utf8')).endsWith('Opening paragraph.\n'));
});

test('CLI loads vault naming defaults while allowing explicit per-note article overrides',async t=>{
  const root=await fixture(t),file=path.join(root,'Fausto.md');await fs.writeFile(file,source);
  await fs.writeFile(path.join(root,'.obsidian/metadata.json'),JSON.stringify({typeDisplayDefaults:{person:{defArt:'the'}}}));
  let report=await runHeaderTool(['--vault',root,'--file','Fausto.md']);
  assert.match(report.files[0].after,/^# The Fausto\n/);
  await fs.writeFile(file,source.replace('species: human','species: human\ndisplayDefaults: {defArt: ""}'));
  report=await runHeaderTool(['--vault',root,'--file','Fausto.md']);assert.match(report.files[0].after,/^# Fausto\n/);
  await fs.writeFile(path.join(root,'.obsidian/metadata.json'),'invalid JSON');
  await fs.writeFile(file,'---\ntags: [session-note]\n---\n> [!taelgar-header]\n');
  report=await runHeaderTool(['--vault',root,'--file','Fausto.md']);
  assert.match(report.files[0].reason,/Header ineligible/,'ineligible notes never need naming rules or header detection');
});

test('bulk mode skips infrastructure and unmarked notes, reports ambiguity, and does not write a batch with parse errors',async t=>{
  const root=await fixture(t);
  for(const [file,body] of Object.entries({'Fausto.md':source,'Unmarked.md':'Authored.','Ambiguous.md':'Authored.\n\n> [!taelgar-header]\n',
    '.hidden/Hidden.md':source,'_scripts/Script.md':source,'_sessions/Session.md':source,'_DM_/Local.md':source})) {
    await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),body);
  }
  let report=await runHeaderTool(['--vault',root,'--all']);
  assert.equal(report.files.length,4);assert.equal(report.counts.changed,2);assert.equal(report.counts.skipped,2);
  await fs.writeFile(path.join(root,'Broken.md'),'---\ninvalid: [\n---\n> [!taelgar-header]\n');
  report=await runHeaderTool(['--vault',root,'--all','--write']);assert.equal(report.counts.error,1);assert.equal(report.written,0);
  assert.equal(await fs.readFile(path.join(root,'Fausto.md'),'utf8'),source);
  await assert.rejects(runHeaderTool(['--vault',root,'--file','../outside.md']),/inside the vault/);
  await assert.rejects(runHeaderTool(['--vault',root,'--file','Fausto.md','--report',path.join(root,'Fausto.md')]),/report/i);
});

test('single and bulk writes skip ineligible notes even when --add is requested or header markers already exist',async t=>{
  const root=await fixture(t),originals=new Map();
  for(const [name,tags,header] of [
    ['No tags',null,'# Old\n> [!info]+ Bio\n> Keep\n'],
    ['No tags native',[], '> [!taelgar-header]\n> Keep\n'],
    ...['session-note','meta','background','source','story'].map(tag=>[tag,['person',tag],'> [!taelgar-header]\n> Keep\n'])]) {
    const content='---\n'+(tags===null?'':'tags: '+JSON.stringify(tags)+'\n')+'headerVersion: old\n---\n'+header+'\nArticle.\n';
    const file=name+'.md';originals.set(file,content);await fs.writeFile(path.join(root,file),content);
    for(const add of [[],['--add']]) {
      const report=await runHeaderTool(['--vault',root,'--file',file,'--write',...add]);
      assert.equal(report.written,0);assert.match(report.files[0].reason,/Header ineligible/);assert.equal(report.files[0].before,undefined);
    }
  }
  await fs.writeFile(path.join(root,'Eligible.md'),source);
  const report=await runHeaderTool(['--vault',root,'--all','--add','--write']);
  assert.equal(report.written,1);assert.equal(report.counts.skipped,originals.size);
  for(const [file,content] of originals)assert.equal(await fs.readFile(path.join(root,file),'utf8'),content);
});

test('installed standalone bundle runs with inferred vault and no repository imports; extraction preserves other plugin files',async t=>{
  const root=await fixture(t),directory=path.join(root,'.obsidian/plugins/taelgarverse'),bundle=await buildHeaderTool();
  await fs.writeFile(path.join(root,'Fausto.md'),source);
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({id:'taelgarverse'}));
  await fs.writeFile(path.join(directory,'data.json'),'preserve');
  const app={vault:{adapter:{getBasePath:()=>root}}},destination=await installHeaderTool(app,{id:'taelgarverse'},bundle);
  assert.equal(await fs.readFile(path.join(directory,'data.json'),'utf8'),'preserve');
  const tokens=[...tokenizer(bundle,{ecmaVersion:'latest'})];
  for(let i=0;i<tokens.length;i++)if(tokens[i].value==='require' && tokens[i+1]?.type.label==='(' && tokens[i+2]?.type.label==='string')
    assert.ok(isBuiltin(tokens[i+2].value),tokens[i+2].value);
  const run=args=>execFileSync(process.execPath,[destination,...args],{cwd:directory,encoding:'utf8',windowsHide:true});
  const output=run(['--file','Fausto.md']);
  assert.match(output,/^WOULD CONVERT Fausto.md\nPreview: 1 change, 0 unchanged, 0 skipped, 0 errors; 0 files written\.\s*$/);
  assert.doesNotMatch(output,/\(human\)|Old|"files"|"counts"/);
  assert.deepEqual((await fs.readdir(root)).sort(),['.obsidian','Fausto.md'],'no JSON file is created without --report');
  const reportFile=path.join(root,'preview.json');
  assert.equal(run(['--file','Fausto.md','--report',reportFile]),output,'--report does not add JSON to stdout');
  const report=JSON.parse(await fs.readFile(reportFile,'utf8'));
  assert.equal(report.counts.changed,1);assert.match(report.files[0].before,/> Old/);assert.match(report.files[0].after,/\(human\)/);
  assert.equal(report.written,0);assert.equal(await fs.readFile(path.join(root,'Fausto.md'),'utf8'),source);
  const check=args=>{
    try{return {code:0,stdout:run(args)};}
    catch(error){return {code:error.status,stdout:error.stdout,stderr:error.stderr};}
  };
  let checked=check(['--file','Fausto.md','--check','--errors']);
  assert.equal(checked.code,1);assert.equal(checked.stdout,'');assert.equal(await fs.readFile(path.join(root,'Fausto.md'),'utf8'),source);
  run(['--file','Fausto.md','--write']);
  checked=check(['--file','Fausto.md','--check','--errors']);assert.equal(checked.code,0);assert.equal(checked.stdout,'');
  await fs.writeFile(path.join(root,'Problem.md'),'---\ntags: [person]\n---\nIntro.\n\n> [!taelgar-header]\n');
  const filteredReport=path.join(root,'filtered.json');
  checked=check(['--all','--check','--errors','--report',filteredReport]);
  assert.equal(checked.code,1);assert.match(checked.stdout,/^PROBLEM Problem.md — /);assert.doesNotMatch(checked.stdout,/Fausto|Preview:|"files"/);
  assert.equal(JSON.parse(await fs.readFile(filteredReport,'utf8')).files.length,2,'--errors only filters stdout, not the full JSON report');
});
