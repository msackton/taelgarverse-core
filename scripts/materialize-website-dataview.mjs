import fs from 'node:fs/promises';
import path from 'node:path';
import {publicationExclusions} from '../src/content-store.mjs';
import {scanFencedCodeBlocks,applyReplacements,prefixMarkdownLines} from '../src/markdown-fences.mjs';
import {filesystemDataview} from '../src/dataview-node/filesystem.mjs';

export async function materializeWebsiteDataview(store,{directory,dataviewDirectory,noStrict=false,stats},
    {log=()=>{},createRuntime=filesystemDataview}={}) {
  const queries=[],issues=[];
  for(const entry of store.entries) {
    if(!entry.note || publicationExclusions(entry.note.metadata).includes('all'))continue;
    for(const block of scanFencedCodeBlocks(entry.note.body)) {
      if(block.language!=='dataview')continue;
      if(!block.closed){issues.push({file:entry.id,line:block.startLine,kind:'error',message:'Unclosed Dataview fence.'});continue;}
      if(/\bfile\.lists\b/i.test(block.body) && /\bthis\.file\.name\b/i.test(block.body)) {
        issues.push({file:entry.id,line:block.startLine,kind:'unsupported',message:'Current-page timeline scan remains unsupported.'});continue;
      }
      queries.push({entry,block});
    }
  }
  const changes=new Map();let runtime;
  if(queries.length) {
    runtime=await createRuntime(store.settings.source_dir,{dataviewDirectory,stats,log});
    issues.push(...runtime.errors.map(error=>({...error,line:1,kind:'error',message:'Indexing failed: '+error.message})));
    for(const {entry,block} of queries) {
      try {
        const markdown=await runtime.api.tryQueryMarkdown(block.body,entry.id);
        const replacements=changes.get(entry) || [];
        replacements.push({start:block.start,end:block.end,text:prefixMarkdownLines(markdown.trimEnd(),block.quotePrefix)+'\n'});changes.set(entry,replacements);
      } catch(error){issues.push({file:entry.id,line:block.startLine,kind:'error',message:error.message});}
    }
  }
  const report={schemaVersion:1,backend:'node',status:issues.length && !noStrict?'failed':'ok',outputComplete:!(issues.length && !noStrict),
    engine:runtime?.identity,indexedPages:runtime?.index.pages.size ?? 0,ambiguousLinks:runtime?[...runtime.links.ambiguities.values()]:[],
    counts:{queries:queries.length,materialized:[...changes.values()].reduce((n,items)=>n+items.length,0),
      errors:issues.filter(i=>i.kind==='error').length,unsupported:issues.filter(i=>i.kind==='unsupported').length},issues};
  await fs.mkdir(directory,{recursive:true});
  const reportFile=path.join(directory,'.dataview-materialization-report.json');
  await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
  for(const issue of issues)log(issue.file+':'+issue.line+': '+issue.message);
  if(report.status==='failed')throw new Error('Node Dataview materialization failed; inspect '+reportFile+' or use --no-strict for partial output.');
  for(const [entry,replacements] of changes) {
    const note=entry.note,body=applyReplacements(note.body,replacements);
    entry.note={...note,body,source:note.source.slice(0,note.source.length-note.body.length)+body};
  }
  log('Node Dataview: '+report.counts.materialized+' queries materialized; '+issues.length+' issues.');
  return {...report,reportFile};
}
