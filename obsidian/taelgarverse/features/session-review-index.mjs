import fs from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'yaml';

// Discovery hints only. Guarded Python inspection validates a chosen review.
// Do not follow symlinks/junctions while browsing the local session inventory.
export async function discoverSessionReviews(vault){
  const root=path.resolve(vault),sessions=[];
  const relative=file=>path.relative(root,file).split(path.sep).join('/');
  async function entries(folder){
    try{return await fs.readdir(folder,{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
  }
  async function plain(file){
    const parts=path.relative(root,file).split(path.sep);
    let current=root;
    for(const part of parts){
      current=path.join(current,part);
      const info=await fs.lstat(current);
      if(info.isSymbolicLink())throw new Error('Session discovery does not follow linked files or folders');
    }
    return fs.readFile(file,'utf8');
  }
  async function inspect(file){
    const row={sessionYaml:relative(file),stage:'not mapped'};
    try{
      const data=parse(await plain(file));
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Expected a session YAML object');
      row.campaign=String(data.campaign??'');row.number=data.sessionNumber;
      const folder=path.dirname(file),files=await entries(folder);
      const reports=files.filter(item=>item.name.endsWith('-transcript-review.md'));
      if(reports.length>1)throw new Error('Multiple transcript reviews; select the intended bundle');
      if(reports.length){
        const text=await plain(path.join(folder,reports[0].name));
        const header=text.match(/^%% transcript-review:v1 (.+) %%\r?$/m);
        if(!header){row.transcriptStage='legacy review';row.transcriptPending=null;}
        else{
          const meta=JSON.parse(header[1]);
          row.transcriptStage=meta.qualityComplete===true?'reviewable':'quality pending';
          row.transcriptPending=[...text.matchAll(/^%% transcript-issue:v1 (.+) %%\r?$/gm)].length;
        }
      }else{
        try{await plain(path.join(folder,'transcript-work/state.json'));row.transcriptStage='cleaning in progress';row.transcriptPending=null;}
        catch(error){if(error.code!=='ENOENT')throw error;row.transcriptStage=data.transcriptProcessing?.status??'not processed';row.transcriptPending=0;}
      }
      const entity=path.join(folder,path.basename(file).replace(/-session\.yaml$/,'-entity-map.json'));
      try{
        const doc=JSON.parse(await plain(entity));
        if(!Array.isArray(doc.entities)||doc.entities.some(item=>!item?.review))throw new Error('Invalid entity inventory');
        Object.assign(row,{stage:'reviewable',entities:doc.entities.length,
          pending:doc.entities.filter(item=>item.review.status==='unreviewed'||item.review.confidence!=='high').length,
          human:doc.entities.filter(item=>item.review.status==='humanReviewed').length,deferred:doc.reviewState?.deferred?.length??0});
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }catch(error){row.stage='error';row.error=error.message;}
    sessions.push(row);
  }
  async function visit(folder){
    for(const item of (await entries(folder)).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=path.join(folder,item.name);
      if(item.isDirectory()){
        if((await fs.lstat(file)).isSymbolicLink())continue;
        await visit(file);
      }else if(item.name.endsWith('-session.yaml'))await inspect(file);
    }
  }
  const start=path.join(root,'_sessions');
  try{if((await fs.lstat(start)).isSymbolicLink())throw new Error('Session discovery does not follow a linked _sessions folder');}
  catch(error){if(error.code==='ENOENT')return {sessions,countsAreUnvalidated:true};throw error;}
  await visit(start);
  return {sessions,countsAreUnvalidated:true};
}
