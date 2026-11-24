import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {collectEventSources,eventMetadataKeys,extractEventSource} from '../src/event-sources.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const extractorVersion=()=>sha(['../src/event-sources.mjs','../src/event-dates.mjs','../src/header-core/dates.mjs',
  '../src/header-core/metadata.mjs','../src/common.mjs','../src/comments.mjs','../src/markdown-fences.mjs','../src/markdown-blocks.cjs',
  '../src/content-store.mjs','../src/header-callout.mjs','../package-lock.json']
  .map(file=>fs.readFileSync(new URL(file,import.meta.url),'utf8')).join('\0'));

export function compileEvents(store,cacheFile) {
  if(!cacheFile)return collectEventSources(store.entries);
  const version=extractorVersion();
  let previous=new Map();
  try {
    const cached=JSON.parse(fs.readFileSync(cacheFile,'utf8'));
    if(cached.version===version)previous=new Map(cached.notes);
  } catch {
    // The extraction cache is derived from the current publication inputs.
  }
  const notes=[];
  const result=collectEventSources(store.entries,(id,note)=>{
    const key=sha(JSON.stringify([note.source ? note.source.length-note.body.length : 0,note.body,eventMetadataKeys.map(field=>[Object.hasOwn(note.metadata,field),note.metadata[field]])]));
    const cached=previous.get(id);
    const record=cached?.key===key && Array.isArray(cached.record?.rows) && Array.isArray(cached.record.warnings) ?
      cached.record : extractEventSource(id,note);
    notes.push([id,{key,record}]);
    return record;
  });
  fs.mkdirSync(path.dirname(cacheFile),{recursive:true});
  const temporary=cacheFile+'.'+randomUUID()+'.tmp';
  try {
    fs.writeFileSync(temporary,JSON.stringify({version,notes}));
    fs.renameSync(temporary,cacheFile);
  } finally {
    fs.rmSync(temporary,{force:true});
  }
  return result;
}
