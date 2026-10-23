import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {encode,evaluate} from './protocol.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');

// Bundled into a temporary CJS file for Obsidian eval/devtools. It calls the
// actual Dataview plugin API; it never loads the Node shim or changes notes.
export async function capture(app,requestPath) {
  const request=JSON.parse(await fs.readFile(requestPath,'utf8'));
  const vault=await fs.realpath(app.vault.adapter.getBasePath());
  if(request.schemaVersion!==1 || vault!==await fs.realpath(request.vault))throw new Error('Wrong harness schema or Obsidian vault.');
  const output=await fs.realpath(path.dirname(requestPath));
  const relative=path.relative(vault,output);
  if(!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative)))throw new Error('Harness output must be outside the vault.');
  try{await fs.access(path.join(output,'plugin.json'));throw new Error('Baseline already exists; prepare a new run directory.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const plugin=app.plugins.plugins.dataview,api=plugin?.api,index=plugin?.index;
  if(!index?.initialized || !api?.tryQuery)throw new Error('Wait for the Dataview index to initialize.');
  const source=await fs.readFile(path.join(vault,app.vault.configDir,'plugins/dataview/main.js'),'utf8');
  if(plugin.manifest.version!==request.engine.version || hash(source)!==request.engine.sha256)throw new Error('Dataview bundle changed; prepare a fresh harness run.');
  const revision=index.revision;
  const expected=request.files.map(f=>f.path),actual=app.vault.getMarkdownFiles().map(f=>f.path).sort();
  if(JSON.stringify(expected.filter(p=>/\.md$/i.test(p)))!==JSON.stringify(actual))throw new Error('Obsidian and the prepared vault file inventory differ; prepare a fresh run.');
  for(const file of request.files.filter(f=>/\.md$/i.test(f.path))) {
    if(hash(await fs.readFile(path.join(vault,file.path)))!==file.sha256)throw new Error('Vault changed: '+file.path);
    const page=index.pages.get(file.path);
    if(!page || Math.abs(page.mtime.toMillis()-file.stat.mtime)>1)throw new Error('Dataview index is missing or stale: '+file.path);
  }
  const pages=[...index.pages.values()].map(encode);
  // Preserve the actual forward AND inverse maps and their iteration order.
  // Rebuilding these from pages would hide host cache inconsistencies and
  // change tie ordering, defeating the purpose of an identical-input replay.
  const indexTables=encode({tags:index.tags.delegate,etags:index.etags.delegate,links:index.links});
  const resolvedLinks=JSON.parse(JSON.stringify(app.metadataCache.resolvedLinks));
  const starred=[...index.pages.keys()].filter(p=>index.starred.starred(p));
  const settings=encode(api.settings),resolutions=new Map();
  const cache=app.metadataCache,original=cache.getFirstLinkpathDest;
  const luxon=api.luxon.Settings,oldNow=luxon.now,oldZone=luxon.defaultZone,oldLocale=luxon.defaultLocale;
  let results;
  cache.getFirstLinkpathDest=function(target,origin='') {
    const dest=original.call(this,target,origin);
    resolutions.set(JSON.stringify([origin,target]),[origin,target,dest?.path ?? null]);return dest;
  };
  try {
    luxon.now=()=>request.environment.now;luxon.defaultZone=request.environment.zone;luxon.defaultLocale=request.environment.locale;
    results=await evaluate(api,request.queries);
  } finally {
    cache.getFirstLinkpathDest=original;luxon.now=oldNow;luxon.defaultZone=oldZone;luxon.defaultLocale=oldLocale;
  }
  if(index.revision!==revision)throw new Error('Dataview index changed during capture; retry.');
  for(const file of request.files.filter(f=>/\.md$/i.test(f.path)))if(hash(await fs.readFile(path.join(vault,file.path)))!==file.sha256)throw new Error('Vault changed during capture: '+file.path);
  const report={schemaVersion:1,id:request.id,corpusHash:request.corpusHash,inputFingerprint:request.inputFingerprint,
    engine:request.engine,environment:request.environment,settings,host:'obsidian',indexRevision:revision,
    results,pages,indexTables,resolvedLinks,starred,resolutions:[...resolutions.values()]};
  await fs.writeFile(path.join(output,'plugin.json'),JSON.stringify(report)+'\n',{flag:'wx'});
  return {queries:results.length,errors:results.filter(r=>r.status==='error').length,indexedPages:pages.length,output:path.join(output,'plugin.json')};
}
