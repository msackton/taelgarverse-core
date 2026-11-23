import fs from 'node:fs';
import path from 'node:path';
import {compileRuntime} from '../../scripts/compile-runtime.mjs';
import {ContentStore,parseNote} from '../../src/content-store.mjs';
import {buildBacklinkIndex} from '../../src/backlinks.mjs';

export function preparedPart(report,name) {
  const manifest=JSON.parse(fs.readFileSync(report.runtimeFile,'utf8'));
  const descriptor=manifest.parts[name] ?? manifest.assets[name];
  return JSON.parse(fs.readFileSync(path.join(path.dirname(report.runtimeFile),descriptor.file),'utf8'));
}

export function compiledObjects(revision,store,inputs={},options={}) {
  const index={entries:store.entries,warnings:[],settings:{default_date:'1748-01-01'},registry:{campaigns:{}},
    coreMeta:{},interactions:{version:2,byTarget:{}},backlinks:buildBacklinkIndex(store),...inputs};
  const compiled=compileRuntime(index,store,options),prefix='revisions/'+revision+'/';
  return new Map([[prefix+'runtime.json',{...compiled.manifest,revision}],
    ...[...compiled.objects].map(([file,json])=>[prefix+file,JSON.parse(json)])]);
}

export function retentionObjects(revision,assetKeys,search) {
  const entries=[{id:'One.md',name:'One',title:'One',slug:'one',target:'one.md',extension:'.md',note:parseNote('One')},
    ...assetKeys.map((objectKey,i)=>({id:i+'.png',target:i+'.png',extension:'.png',objectKey}))];
  return compiledObjects(revision,new ContentStore(entries),{search});
}
