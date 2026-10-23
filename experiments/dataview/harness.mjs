import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'esbuild';
import {ROOT,loadSettings,isInside} from '../../src/config.mjs';
import {Store,publicationExclusions} from '../../src/store.mjs';
import {scanFencedCodeBlocks} from '../../src/markdown-fences.mjs';
import {bundleIdentity,loadEngine,sha256} from './engine.mjs';
import {cachedMetadata,createIndex,restoreIndexTables} from './index.mjs';
import {encode,decode,evaluate,compareResults} from './protocol.mjs';

const runFile=promisify(execFile);
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const writeJSON=async(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n');

export function queryCategory(query) {
  if(/\bfile\.lists\b/i.test(query) && /\bevents?\.(?:text|DR)\b/i.test(query))return 'timeline';
  if(/affiliations/i.test(query))return 'membership';
  if(/pcOwner/i.test(query))return 'inventory';
  if(/file\.(inlinks|outlinks)/i.test(query))return /Northern Sentinels|Worldbuilding\/Staging/i.test(query)?'maintenance':'connections';
  if(/session-note|sessionNumber/i.test(query))return 'sessions';
  return 'other';
}

export function collectQueries(files,selected) {
  const queries=[],skipped=[];
  for(const file of files) {
    if(!file.source || !selected.has(file.path))continue;
    for(const block of scanFencedCodeBlocks(file.source)) {
      if(block.language!=='dataview')continue;
      const category=queryCategory(block.body),item={sourcePath:file.path,line:block.startLine,query:block.body,category};
      if(category==='timeline'){skipped.push({...item,reason:'timeline queries excluded'});continue;}
      if(!block.closed){skipped.push({...item,reason:'unclosed fence'});continue;}
      queries.push({id:sha256(JSON.stringify([file.path,block.startLine,block.body])).slice(0,24),...item});
    }
  }
  return {queries,skipped};
}

async function inventory(vault) {
  const files=[];
  async function walk(folder) {
    for(const file of await fs.readdir(path.join(vault,folder),{withFileTypes:true})) {
      if(file.name.startsWith('.') || file.isSymbolicLink())continue;
      const relative=folder?folder+'/'+file.name:file.name;
      if(file.isDirectory()){await walk(relative);continue;}
      if(!file.isFile())continue;
      // Asset names affect link resolution; media bytes are not query inputs.
      if(!/\.md$/i.test(file.name)){files.push({path:relative});continue;}
      const absolute=path.join(vault,relative),bytes=await fs.readFile(absolute),stat=await fs.stat(absolute);
      files.push({path:relative,source:bytes.toString('utf8'),sha256:sha256(bytes),stat:{ctime:stat.birthtimeMs,mtime:stat.mtimeMs,size:stat.size}});
    }
  }
  await walk('');return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}

function assertReport(request,report) {
  for(const key of ['schemaVersion','id','corpusHash','inputFingerprint'])if(report[key]!==request[key])throw new Error('Incompatible or stale report: '+key);
  for(const key of ['engine','environment'])if(JSON.stringify(report[key])!==JSON.stringify(request[key]))throw new Error('Different '+key+' in report.');
}

export async function prepare({vault,out,scope='website',dataview}={}) {
  const settings=loadSettings(undefined,{vault,liveVault:true});vault=settings.vault_dir;
  dataview=path.resolve(dataview || path.join(vault,'.obsidian/plugins/dataview'));
  out=path.resolve(out || path.join(ROOT,'.cache/dataview-harness',new Date().toISOString().replace(/[:.]/g,'-')));
  if(isInside(vault,out) || !isInside(ROOT,out) || out===ROOT)throw new Error('Harness output must be a new directory inside core and outside the vault.');
  await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
  const {identity}=await bundleIdentity(dataview),files=await inventory(vault);
  let selected;
  if(scope==='website')selected=new Set(new Store(settings).entries.filter(e=>e.note && !publicationExclusions(e.note.metadata).includes('all')).map(e=>e.id));
  else if(scope==='vault')selected=new Set(files.filter(f=>f.source!==undefined).map(f=>f.path));
  else throw new Error('Scope must be website or vault.');
  const corpus=collectQueries(files,selected);
  const {engine}=await loadEngine(dataview);
  let saved={};try{saved=await readJSON(path.join(dataview,'data.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const request={schemaVersion:1,id:randomUUID(),vault,dataview,scope,engine:identity,
    environment:{now:Date.now(),zone:Intl.DateTimeFormat().resolvedOptions().timeZone,locale:'en-US'},
    settings:encode({...engine.DEFAULT_SETTINGS,...saved}),
    files:files.map(({source,...file})=>file),...corpus};
  request.corpusHash=sha256(JSON.stringify(corpus.queries));request.inputFingerprint=sha256(JSON.stringify(request.files));
  await writeJSON(path.join(out,'sources.json'),files.filter(f=>f.source!==undefined).map(f=>({path:f.path,source:f.source})));
  await writeJSON(path.join(out,'request.json'),request);
  await build({entryPoints:[path.join(ROOT,'experiments/dataview/capture.mjs')],outfile:path.join(out,'capture.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'silent'});
  const code=`require(${JSON.stringify(path.join(out,'capture.cjs'))}).capture(app,${JSON.stringify(path.join(out,'request.json'))})`;
  await fs.writeFile(path.join(out,'capture-code.txt'),code+'\n');
  return {directory:out,queries:request.queries.length,skipped:request.skipped.length,indexedFiles:files.filter(f=>f.source!==undefined).length};
}

export async function runNode(out,{indexMode='filesystem'}={}) {
  const request=await readJSON(path.join(out,'request.json'));
  let captured;
  try{captured=await readJSON(path.join(out,'plugin.json'));assertReport(request,captured);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(indexMode==='captured' && !captured)throw new Error('Capture the Obsidian baseline before replaying its index.');
  if(!['filesystem','captured'].includes(indexMode))throw new Error('Index must be filesystem or captured.');
  const {engine,identity}=await loadEngine(request.dataview,request.environment);
  if(JSON.stringify(identity)!==JSON.stringify(request.engine))throw new Error('Dataview bundle changed; prepare a fresh run.');
  const started=performance.now();
  const runtime=createIndex(engine,request.files,indexMode==='captured'?{strict:true,resolutions:captured.resolutions,resolvedLinks:captured.resolvedLinks,starred:captured.starred}:{});
  const settings=captured?.settings ?? request.settings;
  Object.assign(runtime.api.settings,decode(settings,engine));
  const indexErrors=[];
  if(indexMode==='captured') {
    if(!captured.indexTables)throw new Error('Baseline predates exact index-table capture; capture a new run.');
    for(const page of captured.pages)runtime.add(decode(page,engine));
    restoreIndexTables(runtime.index,decode(captured.indexTables,engine));
  }
  else {
    const sources=await readJSON(path.join(out,'sources.json'));
    const stats=new Map(request.files.map(f=>[f.path,f]));
    for(const file of sources) {
      const expected=stats.get(file.path);
      if(!expected || sha256(file.source)!==expected.sha256)throw new Error('Frozen source changed: '+file.path);
      try{runtime.add(engine.parsePage(file.path,file.source,expected.stat,cachedMetadata(file.source)),{canonicalize:true});}
      catch(error){indexErrors.push({file:file.path,message:error.message});}
    }
    if(sources.length!==request.files.filter(f=>/\.md$/i.test(f.path)).length)throw new Error('Frozen source inventory is incomplete.');
  }
  const indexMs=performance.now()-started,results=await evaluate(runtime.api,request.queries);
  const report={schemaVersion:1,id:request.id,corpusHash:request.corpusHash,inputFingerprint:request.inputFingerprint,
    engine:identity,environment:request.environment,settings,host:'node',indexMode,indexedPages:runtime.index.pages.size,indexMs,
    indexErrors,ambiguousLinks:[...runtime.links.ambiguities.values()],results};
  await writeJSON(path.join(out,'node-'+indexMode+'.json'),report);
  return {queries:results.length,errors:results.filter(r=>r.status==='error').length,empty:results.filter(r=>r.rows===0).length,
    indexedPages:report.indexedPages,indexErrors:indexErrors.length,indexMs:Math.round(indexMs),output:path.join(out,'node-'+indexMode+'.json')};
}

export async function capturePlugin(out,{obsidian='obsidian',vault}={}) {
  try{await fs.access(path.join(out,'plugin.json'));throw new Error('Baseline already exists; prepare a new run directory.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const request=await readJSON(path.join(out,'request.json'));
  const code=(await fs.readFile(path.join(out,'capture-code.txt'),'utf8')).trim();
  const result=await runFile(obsidian,['vault='+(vault || path.basename(request.vault)),'eval','code='+code],{timeout:180000,windowsHide:true,maxBuffer:1024*1024});
  if(/command line interface is not enabled/i.test(result.stdout+'\n'+result.stderr))throw new Error('Obsidian CLI is disabled. Enable Settings > General > Advanced > Command line interface, or run capture-code.txt in its developer console.');
  // Some versions return before async eval completes. Only a complete JSON
  // baseline written by the capture script counts as successful capture.
  let plugin;
  for(let retry=0;retry<100;retry++) {
    try{plugin=await readJSON(path.join(out,'plugin.json'));break;}
    catch(error){if(error.code!=='ENOENT' && !(error instanceof SyntaxError))throw error;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!plugin)throw new Error('Obsidian did not write a baseline. CLI output: '+result.stdout+' '+result.stderr);
  assertReport(request,plugin);return {queries:plugin.results.length,indexedPages:plugin.pages.length};
}

export async function compare(out,{indexMode='filesystem'}={}) {
  const request=await readJSON(path.join(out,'request.json'));
  const plugin=await readJSON(path.join(out,'plugin.json')),node=await readJSON(path.join(out,'node-'+indexMode+'.json'));
  assertReport(request,plugin);assertReport(request,node);
  if(JSON.stringify(plugin.settings)!==JSON.stringify(node.settings))throw new Error('Dataview settings differ; rerun Node after capture.');
  const queries=compareResults(request.queries,plugin.results,node.results);
  const counts={};for(const q of queries)counts[q.outcome]=(counts[q.outcome] || 0)+1;
  const report={schemaVersion:1,id:request.id,indexMode,counts,indexErrors:node.indexErrors,queries};
  report.status=counts.different || node.indexErrors.length?'different':'match';
  await writeJSON(path.join(out,'comparison-'+indexMode+'.json'),report);
  const lines=['# Dataview comparison','',`Index: ${indexMode}. Engine: ${node.engine.version}. Timelines excluded.`,
    '',JSON.stringify(counts),'',...queries.map(q=>`- ${q.outcome}${q.difference?.kind?' ('+q.difference.kind+')':''}: ${q.sourcePath}:${q.line}${q.difference?' — '+q.difference.at:''}`)];
  await fs.writeFile(path.join(out,'comparison-'+indexMode+'.md'),lines.join('\n')+'\n');
  return report;
}

export async function main(args=process.argv.slice(2)) {
  const [command,...rest]=args,options={};
  for(let i=0;i<rest.length;i+=2) {
    if(!['--vault','--out','--scope','--dataview','--run','--index','--obsidian'].includes(rest[i]) || !rest[i+1] || rest[i+1].startsWith('--'))throw new Error('Unknown or incomplete option: '+rest[i]);
    options[rest[i].slice(2)]=rest[i+1];
  }
  if(command==='prepare')return prepare(options);
  if(!options.run || !isInside(ROOT,path.resolve(options.run)) || path.resolve(options.run)===ROOT)throw new Error('Use --run with a harness directory inside core.');
  const out=path.resolve(options.run),indexMode=options.index || 'filesystem';
  if(command==='node')return runNode(out,{indexMode});
  if(command==='capture')return capturePlugin(out,options);
  if(command==='compare'){const report=await compare(out,{indexMode});if(report.status!=='match')process.exitCode=1;return {status:report.status,counts:report.counts};}
  throw new Error('Use prepare, node, capture, or compare. See experiments/dataview/README.md.');
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
