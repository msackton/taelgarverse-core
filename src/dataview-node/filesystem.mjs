import fs from 'node:fs/promises';
import path from 'node:path';
import {loadEngine} from './engine.mjs';
import {cachedMetadata,createIndex} from './index.mjs';
import {ensureCachedDataview} from './bundle.mjs';

export async function filesystemDataview(directory,{files,dataviewDirectory,settings={},stats=new Map(),log=()=>{}}) {
  const explicit=dataviewDirectory!==undefined;
  if(!explicit)dataviewDirectory=await ensureCachedDataview({log});
  const {engine,identity}=await loadEngine(dataviewDirectory);
  const runtime=createIndex(engine,files),errors=[];
  Object.assign(runtime.api.settings,settings);
  let saved={};if(explicit)try{saved=JSON.parse(await fs.readFile(path.join(dataviewDirectory,'data.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  Object.assign(runtime.api.settings,saved);
  const markdown=files.filter(file=>/\.md$/i.test(file));
  for(const [i,file] of markdown.entries()) {
    try {
      const filename=path.join(directory,file);
      const source=await fs.readFile(filename,'utf8');
      const stat=stats.get(file) || await fs.stat(filename).then(s=>({ctime:s.birthtimeMs,mtime:s.mtimeMs,size:s.size}));
      runtime.add(engine.parsePage(file,source,stat,cachedMetadata(source)),{canonicalize:true});
    } catch(error){errors.push({file,message:error.message});}
    if((i+1)%1000===0)log('Node Dataview index: '+(i+1)+'/'+markdown.length+' notes.');
  }
  return {...runtime,identity:{...identity,source:explicit?'explicit-directory':'github-cache'},errors};
}
