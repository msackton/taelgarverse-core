import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {publicationExclusions} from '../src/content-store.mjs';
import {scanFencedCodeBlocks,applyReplacements,prefixMarkdownLines} from '../src/markdown-fences.mjs';
import {DATAVIEW_EXPORT_VERSION,validateMaterializationReport} from '../src/dataview-export.mjs';

const writeJSON=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n');

export function dataviewEval(request) {
  return `(async()=>{const plugin=app.plugins.plugins.taelgarverse?.materializer;
if(plugin?.dataviewExportVersion!==${DATAVIEW_EXPORT_VERSION} || typeof plugin.exportDataview!=='function')throw new Error('Install and reload the current Taelgarverse materializer to export website Dataview queries.');
await plugin.exportDataview(${JSON.stringify(request)});return 'Taelgarverse Dataview export finished';})()`;
}

async function waitForResult(resultPath,progressPath,request,started) {
  // Some desktop CLI versions return before the async eval finishes. Progress
  // proves the request reached the plugin; a missing/outdated plugin fails fast.
  const deadline=started+150000+request.queries.length*request.blockTimeoutMs;
  while(Date.now()<deadline) {
    try{return JSON.parse(await fs.readFile(resultPath,'utf8'));}
    catch(error){if(error.code!=='ENOENT' && !(error instanceof SyntaxError))throw error;}
    if(Date.now()-started>10000) {
      try{const progress=JSON.parse(await fs.readFile(progressPath,'utf8'));if(progress.id!==request.id)throw new Error('Stale Dataview export progress.');}
      catch(error){
        if(error.code==='ENOENT')throw new Error('Taelgarverse did not start the export. Install and reload the current plugin in the selected Obsidian vault.');
        if(!(error instanceof SyntaxError))throw error;
      }
    }
    await pause(100);
  }
  throw new Error('Timed out waiting for the Taelgarverse Dataview export.');
}

// Called on raw working copies before website conversion, image discovery,
// backlinks, search or runtime compilation. Only DQL crosses the desktop boundary.
export async function exportDataview(store,{directory,vaultPath,obsidianCommand,obsidianVault,noStrict=false,blockTimeoutMs=30000},
    {run,log=()=>{}}={}) {
  await fs.mkdir(directory,{recursive:true});
  const queries=[],blocks=new Map(),issues=[];
  const issue=(entry,block,message,kind='error')=>issues.push({file:entry.id,line:block.startLine,kind,message});
  for(const entry of store.entries) {
    if(!entry.note || publicationExclusions(entry.note.metadata).includes('all'))continue;
    for(const block of scanFencedCodeBlocks(entry.note.body)) {
      if(block.language!=='dataview')continue;
      if(!block.closed){issue(entry,block,'Unclosed '+block.language+' fence.');continue;}
      // Preserve the legacy materializer's unsupported-query boundary.
      if(/\bfile\.lists\b/i.test(block.body) && /\bthis\.file\.name\b/i.test(block.body)) {
        issue(entry,block,'Unsupported query: scans all file lists for the current page name.','unsupported');continue;
      }
      const id='q'+queries.length;
      queries.push({id,sourcePath:entry.id,query:block.body});blocks.set(id,{entry,block});
    }
  }
  const request={schemaVersion:DATAVIEW_EXPORT_VERSION,id:randomUUID(),vaultPath,blockTimeoutMs,queries};
  const requestPath=path.join(directory,'dataview-request-'+request.id+'.json'),resultPath=path.join(directory,'dataview-results-'+request.id+'.json'),progressPath=path.join(directory,'dataview-progress-'+request.id+'.json');
  const changes=new Map();let engine;
  if(queries.length) {
    await writeJSON(requestPath,request);
    const started=Date.now();
    const progressTimer=setInterval(()=>{
      fs.readFile(progressPath,'utf8').then(source=>{
        const progress=JSON.parse(source);
        if(progress.id===request.id)log('Dataview: '+progress.completed+'/'+progress.total+' queries | '+(progress.currentFile || progress.phase));
      }).catch(()=>{});
    },5000);
    progressTimer.unref();
    try {
      const args=['vault='+(obsidianVault || path.basename(vaultPath)),'eval','code='+dataviewEval({requestPath,resultPath,progressPath})];
      const cli=await run(obsidianCommand,args,{cwd:vaultPath});
      if(/command line interface is not enabled/i.test((cli?.stdout || '')+'\n'+(cli?.stderr || ''))) {
        throw new Error('Enable Obsidian Settings > General > Advanced > Command line interface before exporting Dataview queries.');
      }
      const result=await waitForResult(resultPath,progressPath,request,started);
      validateMaterializationReport(result,request);
      engine=result.engine;
      for(const value of result.results) {
        const {entry,block}=blocks.get(value.id);
        if(value.status==='error'){issue(entry,block,value.message);continue;}
        const replacements=changes.get(entry) || [];
        const markdown=value.markdown.replace(/\r\n?/g,'\n').trimEnd();
        replacements.push({start:block.start,end:block.end,text:prefixMarkdownLines(markdown,block.quotePrefix)+'\n'});
        changes.set(entry,replacements);
      }
    } finally {clearInterval(progressTimer);}
  }
  const report={schemaVersion:DATAVIEW_EXPORT_VERSION,id:request.id,backend:'obsidian',engine,publicationPolicy:'context-v1',materializationOnly:true,
    status:issues.length && !noStrict ? 'failed' : 'ok',outputComplete:!(issues.length && !noStrict),
    counts:{queries:queries.length,materialized:[...changes.values()].reduce((n,list)=>n+list.length,0),
      errors:issues.filter(item=>item.kind==='error').length,unsupported:issues.filter(item=>item.kind==='unsupported').length},issues};
  const reportFile=path.join(directory,'.dataview-materialization-report.json');
  await writeJSON(reportFile,report);
  for(const item of issues)log(item.file+':'+item.line+': '+item.message);
  if(report.status!=='ok')throw new Error('Dataview materialization failed; inspect '+reportFile+' or use --no-strict for partial output.');
  for(const [entry,replacements] of changes) {
    const note=entry.note,body=applyReplacements(note.body,replacements);
    entry.note={...note,body,source:note.source.slice(0,note.source.length-note.body.length)+body};
  }
  log('Dataview: '+report.counts.materialized+' queries materialized; '+issues.length+' issues.');
  return {...report,reportFile};
}
