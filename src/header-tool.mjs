import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {headerSourceEligibility,rewriteHeader} from './header-rewrite.mjs';

export const headerToolUsage=`Taelgarverse header tool
  node header-tool.cjs --file "People/Fausto.md" [--add] [--write]
  node header-tool.cjs --all [--add] [--write] [--report FILE]
  --vault PATH overrides the vault inferred from the installed plugin directory.
  Without --write, show a preview and change no notes.
  --all scans Markdown outside dot directories, node_modules, _scripts and _sessions.
  Untagged notes and session-note/meta/background/source/story tags are skipped,
  including descendant tags, even with --add or an existing header.
  Stdout shows one status line per file and a summary, without header contents.
  --report FILE saves the detailed JSON preview/result; JSON is not printed.
  --errors shows only errors and ambiguous/unsupported headers; normal skips are hidden.
  --check changes no notes and exits 0 if current, 1 if changes or problems remain.
  --check and --write cannot be combined. --errors and --report work with either mode.
  Close notes with unsaved edits before using --write; the tool edits saved files.
`;

export function formatHeaderToolStatus(report) {
  if(report.help)return report.help;
  const line=value=>String(value ?? '').split(/\r?\n/,1)[0].replace(/\s+/g,' ').trim();
  const operations={converted:'CONVERT',regenerated:'REGENERATE',added:'ADD'};
  const isProblem=file=>file.status==='error' || file.problem || (!report.dryRun && file.status==='changed' && !file.written);
  const lines=report.files.filter(file=>!report.errorsOnly || isProblem(file)).map(file=>{
    let status=file.status.toUpperCase(),reason=file.reason;
    if(report.errorsOnly && file.status==='skipped' && file.problem)status='PROBLEM';
    if(file.status==='changed') {
      if(report.dryRun)status='WOULD '+(operations[file.kind] || 'CHANGE');
      else if(file.written)status=file.kind?.toUpperCase() || 'CHANGED';
      else {status='NOT WRITTEN';reason='Run contains errors or stopped before this file was written.';}
    }
    return status+' '+line(file.file)+(reason?' — '+line(reason):'');
  });
  if(report.errorsOnly)return lines.join('\n');
  const {changed,unchanged,skipped,error}=report.counts;
  const count=(value,noun)=>value+' '+noun+(value===1?'':'s');
  lines.push(`${report.dryRun?'Preview':'Result'}: ${count(changed,'change')}, ${unchanged} unchanged, ${skipped} skipped, ${count(error,'error')}; ${count(report.written,'file')} written.`);
  return lines.join('\n');
}

export function headerToolExitCode(report) {
  if(report.help)return 0;
  return report.counts.error>0 || report.check && (report.counts.changed>0 || report.files.some(file=>file.problem)) ? 1 : 0;
}

function parseArgs(args) {
  const options={};
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(['--all','--add','--write','--help','--errors','--check'].includes(key))options[key.slice(2)]=true;
    else if(['--vault','--file','--report'].includes(key) && args[i+1] && !args[i+1].startsWith('--'))options[key.slice(2)]=args[++i];
    else throw new Error('Unknown or incomplete option: '+key);
  }
  if(!options.help && (!!options.file===!!options.all))throw new Error('Choose exactly one of --file or --all.');
  if(!options.help && options.check && options.write)throw new Error('--check is read-only and cannot be combined with --write.');
  return options;
}

const inside=(root,target)=>{const relative=path.relative(root,target);return relative!=='' && relative!=='..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative);};

async function inferredVault(scriptPath) {
  const directory=path.dirname(path.resolve(scriptPath || 'header-tool.cjs'));
  if(path.basename(path.dirname(directory))!=='plugins')throw new Error('Use --vault PATH when running outside the installed plugin folder.');
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  if(manifest.id!=='taelgarverse')throw new Error('Cannot infer the vault from this plugin folder.');
  return path.resolve(directory,'../../..');
}

async function markdownFiles(root) {
  const files=[];
  async function visit(directory) {
    for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(entry.isSymbolicLink() || entry.name.startsWith('.'))continue;
      const file=path.join(directory,entry.name);
      if(entry.isDirectory() && !['node_modules','_scripts','_sessions'].includes(entry.name))await visit(file);
      else if(entry.isFile() && /\.md$/i.test(entry.name))files.push(file);
    }
  }
  await visit(root);return files;
}

async function checkedFile(root,file) {
  const absolute=path.resolve(root,file);
  if(!inside(root,absolute) || !/\.md$/i.test(absolute))throw new Error('The note must be a Markdown file inside the vault.');
  const real=await fs.realpath(absolute),stat=await fs.lstat(absolute);
  if(!inside(root,real) || stat.isSymbolicLink() || !stat.isFile())throw new Error('Refusing a note symlink or path outside the vault.');
  return absolute;
}

async function writePlan(file,source,updated) {
  const stat=await fs.stat(file),temporary=file+'.taelgar-header-'+randomUUID()+'.tmp';
  try {
    await fs.writeFile(temporary,updated,{encoding:'utf8',flag:'wx',mode:stat.mode});
    if(await fs.readFile(file,'utf8')!==source)throw new Error('The note changed after preview; rerun the command.');
    await fs.rename(temporary,file);
  } finally {await fs.rm(temporary,{force:true});}
}

export async function runHeaderTool(args,{cwd=process.cwd(),scriptPath=process.argv[1]}={}) {
  const options=parseArgs(args);
  if(options.help)return {help:headerToolUsage};
  const root=await fs.realpath(options.vault?path.resolve(cwd,options.vault):await inferredVault(scriptPath));
  const files=options.all?await markdownFiles(root):[await checkedFile(root,options.file)];
  const reportPath=options.report?path.resolve(cwd,options.report):null;
  if(reportPath) {
    if(path.extname(reportPath).toLowerCase()!=='.json')throw new Error('The report must use a .json filename.');
    try{if((await fs.lstat(reportPath)).isSymbolicLink())throw new Error('Refusing to overwrite a report symlink.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(reportPath && files.some(file=>path.resolve(file).toLowerCase()===reportPath.toLowerCase()))throw new Error('The report cannot overwrite a source note.');
  const results=[],plans=[];
  let nameRules;
  const loadNameRules=()=>nameRules ??= (async()=>{
    // Infer a non-default Obsidian config directory when running its installed
    // tool; an explicit different --vault uses that vault's normal .obsidian.
    const scriptDirectory=path.dirname(path.resolve(scriptPath || 'header-tool.cjs'));
    const config=path.basename(path.dirname(scriptDirectory))==='plugins' && path.resolve(scriptDirectory,'../../..')===root ?
      path.resolve(scriptDirectory,'../..') : path.join(root,'.obsidian');
    let source;
    try{source=await fs.readFile(path.join(config,'metadata.json'),'utf8');}
    catch(error){if(error.code==='ENOENT')return undefined;throw error;}
    const rules=JSON.parse(source);
    if(!rules || typeof rules!=='object' || Array.isArray(rules))throw new Error('metadata.json must contain a mapping.');
    return rules;
  })();
  for(const candidate of files) {
    const relative=path.relative(root,candidate).replace(/\\/g,'/');
    try {
      const file=await checkedFile(root,candidate),source=await fs.readFile(file,'utf8');
      const eligibility=headerSourceEligibility(source);
      const result=eligibility.eligible ? rewriteHeader(source,{filename:relative,add:options.add,coreMeta:await loadNameRules()}) :
        {status:'skipped',reason:eligibility.reason};
      const {source:updated,...details}=result;
      results.push({file:relative,...details});
      if(result.status==='changed')plans.push({file,source,updated,result:results.at(-1)});
    } catch(error) {results.push({file:relative,status:'error',reason:error.message});}
  }
  // Plan the entire run first. Never write a partial batch with parse/path errors.
  if(options.write && !results.some(result=>result.status==='error'))for(const plan of plans) {
    try {await writePlan(plan.file,plan.source,plan.updated);plan.result.written=true;}
    catch(error){plan.result.status='error';plan.result.reason=error.message;break;}
  }
  const counts=Object.fromEntries(['changed','unchanged','skipped','error'].map(status=>[status,results.filter(result=>result.status===status).length]));
  const report={vault:root,dryRun:!options.write,check:!!options.check,errorsOnly:!!options.errors,
    written:results.filter(result=>result.written).length,counts,files:results};
  if(reportPath)await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  return report;
}
