import {Component} from 'obsidian';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DATAVIEW_EXPORT_VERSION,validateDataviewRequest} from '../../../src/dataview-export.mjs';

const inside=(root,target)=>{const relative=path.relative(root,target);return relative==='' || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative));};
const writeJSON=async(file,value)=>{
  try{if((await fs.lstat(file)).isSymbolicLink())throw new Error('Export output cannot be a symlink.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.writeFile(file,JSON.stringify(value)+'\n');
};

// The desktop boundary evaluates DQL and returns Markdown. All note selection,
// Markdown edits, asset handling and publication policy belong to Node.
export class ExporterFeature extends Component {
  constructor(plugin){super();this.app=plugin.app;this.running=false;this.disposed=false;this.pending=new Set();}

  async bounded(promise,timeout,message) {
    if(this.disposed)throw new Error('Taelgarverse exporter was unloaded.');
    let timer,cancel;
    const stopped=new Promise((_,reject)=>{
      cancel=()=>reject(new Error('Taelgarverse exporter was unloaded.'));
      timer=setTimeout(()=>reject(new Error(message)),timeout);this.pending.add(cancel);
    });
    try{return await Promise.race([promise,stopped]);}
    finally{clearTimeout(timer);this.pending.delete(cancel);}
  }

  async runtime() {
    const deadline=Date.now()+120000;
    await this.bounded(new Promise(resolve=>this.app.workspace.onLayoutReady(resolve)),120000,'Obsidian layout did not become ready.');
    const plugin=this.app.plugins.plugins.dataview;
    if(typeof plugin?.api?.tryQueryMarkdown!=='function')throw new Error('Enable Dataview before exporting website queries.');
    while(!plugin.index?.initialized) {
      if(Date.now()>=deadline)throw new Error('Dataview index did not become ready.');
      await this.bounded(new Promise(resolve=>setTimeout(resolve,100)),deadline-Date.now(),'Dataview index did not become ready.');
    }
    return plugin.api;
  }

  async runRequest({requestPath,resultPath,progressPath}) {
    if(this.running)throw new Error('A Taelgarverse Dataview export is already running.');
    this.running=true;
    let request;
    try {
      const vaultPath=await fs.realpath(this.app.vault.adapter.getBasePath());
      requestPath=await fs.realpath(requestPath);
      const directory=path.dirname(requestPath);
      if(inside(vaultPath,directory))throw new Error('Export staging must be outside the source vault.');
      for(const file of [resultPath,progressPath])if(path.dirname(path.resolve(file))!==directory || path.resolve(file)===requestPath)throw new Error('Export results must use separate files beside the request.');
      if(path.resolve(resultPath)===path.resolve(progressPath))throw new Error('Export result and progress files must differ.');
      request=JSON.parse(await fs.readFile(requestPath,'utf8'));
      validateDataviewRequest(request);
      if(await fs.realpath(request.vaultPath)!==vaultPath)throw new Error('The export request belongs to a different Obsidian vault.');
      const results=[];
      await writeJSON(progressPath,{id:request.id,phase:'waiting-for-dataview',completed:0,total:request.queries.length});
      const api=await this.runtime();
      for(const query of request.queries) {
        if(this.disposed)throw new Error('Taelgarverse exporter was unloaded.');
        await writeJSON(progressPath,{id:request.id,phase:'queries',completed:results.length,total:request.queries.length,currentFile:query.sourcePath});
        try {
          const file=this.app.vault.getAbstractFileByPath(query.sourcePath);
          if(file?.extension!=='md')throw new Error('Query source note is unavailable.');
          const markdown=await this.bounded(Promise.resolve().then(()=>api.tryQueryMarkdown(query.query,query.sourcePath)),request.blockTimeoutMs,
            'Dataview query timed out: '+query.sourcePath);
          if(typeof markdown!=='string')throw new Error('Dataview returned a non-Markdown result.');
          results.push({id:query.id,status:'ok',markdown});
        } catch(error) {
          if(this.disposed)throw error;
          results.push({id:query.id,status:'error',message:error.message});
        }
      }
      const report={schemaVersion:DATAVIEW_EXPORT_VERSION,id:request.id,status:'ok',outputComplete:true,
        engine:{version:this.app.plugins.plugins.dataview.manifest?.version ?? 'unknown'},results};
      await writeJSON(resultPath,report);
      await writeJSON(progressPath,{id:request.id,phase:'complete',completed:results.length,total:results.length});
      return report;
    } catch(error) {
      // Only write after the request and its output locations were validated.
      if(request?.id && request.schemaVersion===DATAVIEW_EXPORT_VERSION && path.dirname(path.resolve(resultPath))===path.dirname(requestPath)) {
        await writeJSON(resultPath,{schemaVersion:DATAVIEW_EXPORT_VERSION,id:request.id,status:'failed',outputComplete:false,error:error.message});
      }
      throw error;
    } finally {this.running=false;}
  }

  onunload(){this.disposed=true;for(const cancel of this.pending)cancel();}
}
