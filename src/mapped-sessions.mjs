// Node-only ingestion. Publish a small session projection, never source or review artifacts.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import YAML from 'yaml';

const sha=value=>createHash('sha256').update(value).digest('hex');
const requireValue=(value,message)=>{if(!value)throw new Error(message);};
const line=value=>typeof value==='string' && value.trim() && !/[\r\n]/.test(value);
const canonical=value=>JSON.stringify(value && typeof value==='object' ?
  Array.isArray(value) ? value.map(item=>JSON.parse(canonical(item))) :
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])) : value);

function read(root,key) {
  requireValue(line(key) && !key.includes('\\') && !path.posix.isAbsolute(key) && !key.split('/').some(part=>!part || part==='.' || part==='..'),'Invalid artifact path');
  let filename=root;
  for(const part of key.split('/')) {
    filename=path.join(filename,part);
    requireValue(!fs.lstatSync(filename).isSymbolicLink(),'Symlink artifact is unsupported');
  }
  const stat=fs.statSync(filename);
  requireValue(stat.isFile() && stat.size<=16*1024*1024,'Artifact is not a bounded file');
  return fs.readFileSync(filename);
}
export function readMappedSession(settings,key,recap) {
  const root=settings.vault_dir,mapBytes=read(root,key),map=JSON.parse(mapBytes);
  const manifestKey=key.replace(/-entity-map\.json$/,'-session.yaml');
  requireValue(map.schemaVersion===4 && map.sessionYaml===manifestKey && Array.isArray(map.entities),'Expected a v4 entity map for this session');
  const metadata=YAML.parse(read(root,manifestKey).toString('utf8'));
  requireValue(line(metadata.campaign) && /^\d+(?:\.\d+)?$/.test(String(metadata.sessionNumber)),'Missing campaign/session identity');
  const {interactionExtraction,...fingerprinted}=metadata;
  requireValue(map.inputs?.sessionInputs?.sessionYamlDigest===sha(canonical(fingerprinted)),'Entity map has stale session metadata');
  const sessionRoot=path.posix.dirname(path.posix.dirname(key));
  const sourceHash=id=>{
    const artifact=id==='preparedSourcePath' ? {path:metadata.preparedSourcePath} : metadata.transcriptProcessing?.artifacts?.[id.split('.').at(-1)];
    requireValue(line(artifact?.path),'Missing registered source '+id);
    let relative=artifact.path;
    // Legacy narrative manifests contain another machine's absolute vault prefix.
    if(id==='preparedSourcePath' && relative.startsWith('/')) {
      const suffix=sessionRoot.split('/').at(-1)+'/cleaned/'+path.posix.basename(manifestKey).replace(/-session.yaml$/,'-source-prepared.md');
      requireValue(relative.endsWith('/'+suffix),'Unexpected narrative source path');
      relative='cleaned/'+path.posix.basename(relative);
    }
    requireValue(relative.startsWith('cleaned/'),'Source must belong to the session cleaned directory');
    return sha(read(root,sessionRoot+'/'+relative));
  };
  const sources=map.inputs.sessionInputs.sources;
  requireValue(sources && Object.keys(sources).length,'Missing entity source hashes');
  const required=metadata.sourceType==='narrative' ? ['preparedSourcePath'] :
    ['transcriptProcessing.artifacts.polishedMarkdown',...(metadata.transcriptProcessing?.artifacts?.cleaned ? ['transcriptProcessing.artifacts.cleaned'] : [])];
  requireValue(required.every(id=>Object.hasOwn(sources,id)) && Object.keys(sources).every(id=>required.includes(id)),'Unexpected entity source hash set');
  for(const [id,hash] of Object.entries(sources))requireValue(hash===sourceHash(id),'Entity map has stale source '+id);
  const entities=new Map();
  for(const row of map.entities) {
    requireValue(line(row.id) && !entities.has(row.id) && ['npc','divine','item','organization'].includes(row.kind) &&
      line(row.label) && ['star','supporting','cameo'].includes(row.importance),'Invalid or duplicate mapped entity');
    if(row.note!=null)requireValue(line(row.note) && row.note.endsWith('.md') && !row.note.includes('\\') &&
      !row.note.split('/').some(part=>!part || part.startsWith('.') || part.startsWith('_')),'Invalid entity note path');
    entities.set(row.id,{id:row.id,note:row.note || null,label:row.label,importance:row.importance,
      ...(row.examinedInMirrorOfPast===true ? {examinedInMirrorOfPast:true} : {}),exchanges:[]});
  }
  const interactionKey=key.replace(/-entity-map.json$/,'-interactions.json');
  if(fs.existsSync(path.join(root,interactionKey))) {
    const document=JSON.parse(read(root,interactionKey));
    requireValue(document.schemaVersion===1 && document.sessionYaml===manifestKey && Array.isArray(document.interactions),'Expected interactions v1 for this session');
    requireValue(document.inputs?.entityMap?.path===key && document.inputs.entityMap.sha256===sha(mapBytes),'Interactions have a stale entity map');
    requireValue(document.inputs?.transcript?.sourceId==='transcriptProcessing.artifacts.polishedMarkdown' &&
      document.inputs.transcript.sha256===sourceHash(document.inputs.transcript.sourceId),'Interactions have a stale transcript');
    const ids=new Set();
    for(const [order,exchange] of document.interactions.entries()) {
      requireValue(line(exchange.id) && !ids.has(exchange.id) && line(exchange.title) && Array.isArray(exchange.entities) &&
        exchange.entities.some(row=>row.role==='star') && Array.isArray(exchange.lines) && exchange.lines.some(text=>text.trim()) &&
        exchange.lines.every(text=>typeof text==='string' && !/[\r\n]/.test(text)),'Malformed exchange');
      ids.add(exchange.id);const participants=new Set();
      for(const row of exchange.entities) {
        requireValue(entities.has(row.id) && !participants.has(row.id) && ['star','supporting','cameo'].includes(row.role) &&
          ['interacted','observed','present','mentioned'].includes(row.action),'Invalid exchange participation');
        participants.add(row.id);
        entities.get(row.id).exchanges.push({id:exchange.id,order,title:exchange.title,role:row.role,action:row.action,
          passage:exchange.lines.join('\n').replace(/%%[\s\S]*?%%/g,comment=>comment.startsWith('%%^') ? comment : '').trim()});
      }
    }
  }
  return {key,mapped:true,campaign:metadata.campaign,number:String(metadata.sessionNumber),
    date:metadata.drStart ?? null,end:metadata.drEnd ?? null,
    title:recap?.title || 'Session '+metadata.sessionNumber,tagline:recap?.tagline || '',entities:[...entities.values()]};
}
