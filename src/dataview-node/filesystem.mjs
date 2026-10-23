import fs from 'node:fs/promises';
import path from 'node:path';
import {loadEngine} from './engine.mjs';
import {cachedMetadata,createIndex} from './index.mjs';
import {ensureCachedDataview} from './bundle.mjs';

export async function filesystemDataview(directory,{dataviewDirectory,settings={},stats=new Map(),log=()=>{}}={}) {
  const explicit=dataviewDirectory!==undefined;
  if(!explicit)dataviewDirectory=await ensureCachedDataview({log});
  const {engine,identity}=await loadEngine(dataviewDirectory);
  const files=[];
  async function walk(folder) {
    for(const entry of await fs.readdir(path.join(directory,folder),{withFileTypes:true})) {
      if(entry.name.startsWith('.') || entry.isSymbolicLink())continue;
      const relative=folder?folder+'/'+entry.name:entry.name;
      if(entry.isDirectory())await walk(relative);else if(entry.isFile())files.push({path:relative});
    }
  }
  await walk('');files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const runtime=createIndex(engine,files),errors=[];
  Object.assign(runtime.api.settings,settings);
  let saved={};if(explicit)try{saved=JSON.parse(await fs.readFile(path.join(dataviewDirectory,'data.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  Object.assign(runtime.api.settings,saved);
  const markdown=files.filter(f=>/\.md$/i.test(f.path));
  for(const [i,file] of markdown.entries()) {
    try {
      const source=await fs.readFile(path.join(directory,file.path),'utf8');
      const stat=stats.get(file.path) || await fs.stat(path.join(directory,file.path)).then(s=>({ctime:s.birthtimeMs,mtime:s.mtimeMs,size:s.size}));
      runtime.add(engine.parsePage(file.path,source,stat,cachedMetadata(source)),{canonicalize:true});
    } catch(error){errors.push({file:file.path,message:error.message});}
    if((i+1)%1000===0)log('Node Dataview index: '+(i+1)+'/'+markdown.length+' notes.');
  }
  return {...runtime,identity:{...identity,source:explicit?'explicit-directory':'github-cache'},errors};
}
