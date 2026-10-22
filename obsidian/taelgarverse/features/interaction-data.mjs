import {ContentStore,authoredBody} from '../../../src/content-store.mjs';
import {buildBacklinkCampaigns} from '../../../src/campaign-ownership.mjs';
import {compileInteractionIndex,campaignIdentities,campaignInteractions,interactionDate,interactionReferenceType} from '../../../src/campaign-interactions.mjs';
import {parseSessionRecap} from '../../../src/recap-parser.mjs';
import {Contexts} from '../../../src/contexts.mjs';
import {codeRanges,filterComments} from '../../../src/comments.mjs';
import {bioDate} from './headers.mjs';

const list=value=>Array.isArray(value)?value:value==null?[]:[value];
export const hasKnownTo=metadata=>list(metadata?.knownTo).some(value=>String(value).trim());
export function hasInteractionsBlock(source) {
  return codeRanges(source).some(([start,end])=>/^ {0,3}(?:`{3,}|~{3,})taelgar-interactions\s*(?:\n|$)/i.test(source.slice(start,end)));
}
async function readFiles(files,read) {
  const values=new Array(files.length);let next=0;
  await Promise.all(Array.from({length:Math.min(8,files.length)},async()=>{
    while(next<files.length){const index=next++;values[index]=await read(files[index]);}
  }));return values;
}
export async function obsidianInteractions(app) {
  const registry=JSON.parse(await app.vault.adapter.read('_scripts/session_note_campaigns.json'));
  const files=app.vault.getMarkdownFiles().filter(file=>!file.path.split('/').some(part=>part.startsWith('.'))).sort((a,b)=>a.path.localeCompare(b.path));
  const byPath=new Map(),entries=files.filter(file=>!file.path.split('/').some(part=>part.startsWith('_'))).map(file=>{
    // Obsidian owns local access. Website publication exclusions must not hide
    // the author's local notes, and knownTo pages need not carry a person tag.
    const metadata={...(app.metadataCache.getFileCache(file)?.frontmatter || {})};delete metadata.excludePublish;
    if(hasKnownTo(metadata))metadata.tags=[...new Set([...list(metadata.tags),'person'])];
    const entry={id:file.path,slug:file.path,target:file.path,name:file.basename,title:metadata.name || file.basename,note:{metadata},file};
    byPath.set(file.path,entry);return entry;
  });
  const store=new ContentStore(entries),lookup=store.lookup.bind(store);
  store.lookup=raw=>{
    const file=app.metadataCache.getFirstLinkpathDest(raw,'');
    return file && byPath.has(file.path) ? {status:'found',entry:byPath.get(file.path)} : lookup(raw);
  };
  const roots=Object.values(registry.campaigns || {}).map(campaign=>String(campaign.campaignRoot || '').replace(/\/+$/,'')).filter(Boolean);
  const references=entries.filter(entry=>roots.some(root=>entry.id.startsWith(root+'/')) &&
    interactionReferenceType(app.metadataCache.getFileCache(entry.file)?.frontmatter) &&
    !list(entry.note.metadata.tags).includes('session-note') && entry.note.metadata.sessionNumber==null);
  const incoming=new Map(),warnings=[];
  await readFiles(references,async entry=>{
    const source=await app.vault.cachedRead(entry.file);
    // Cache positions refer to the original text. Preserve CRLF while removing
    // frontmatter/header slots so native link offsets remain exact on Windows.
    const frontmatter=/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
    const body=authoredBody({metadata:entry.note.metadata,body:source.slice(frontmatter?.[0].length || 0)});
    const start=source.length-body.length,cache=app.metadataCache.getFileCache(entry.file),targets=new Map();
    const seen=new Set();
    const links=[...(cache?.links || []),...(cache?.embeds || [])].filter(link=>{
      const from=link.position?.start?.offset,to=link.position?.end?.offset,key=from+':'+to;
      if(!(from>=start && to>from && to<=source.length) || seen.has(key) || (link.original && source.slice(from,to)!==link.original))return false;
      seen.add(key);return true;
    }).sort((a,b)=>b.position.start.offset-a.position.start.offset);
    let marked=body;
    for(const [i,link] of links.entries()) {
      const target=app.metadataCache.getFirstLinkpathDest(link.link.split('#')[0],entry.id)?.path;
      if(!byPath.has(target) || target===entry.id)continue;
      const marker='TAELGAR_INTERACTION_LINK_'+i+'Z',markers=targets.get(target) || [];
      marked=marked.slice(0,link.position.start.offset-start)+marker+marked.slice(link.position.end.offset-start);
      markers.push(marker);targets.set(target,markers);
    }
    try{filterComments(marked,{date:'0001-01-01'});}catch(error){warnings.push(entry.id+': '+error.message);return;}
    for(const [target,markers] of targets){const records=incoming.get(target) || [];records.push({source:entry.slug,marked,markers});incoming.set(target,records);}
  });
  const recaps=files.filter(file=>/^_sessions\/[^/]+\/[^/]+\/cleaned\/[^/]+-session-recap\.md$/.test(file.path));
  const bundles=[],transcriptPaths=new Map(),identities=campaignIdentities(registry);
  await readFiles(recaps,async file=>{
    try {
      const bundle=parseSessionRecap(await app.vault.cachedRead(file),file.path);
      // Native links open the referenced polished artifact without importing or
      // rendering raw transcripts, and without using paths in Source Files.
      const campaign=identities.get(String(bundle.campaign).trim().toLowerCase());
      for(const scene of bundle.scenes) {
        if(!/^beat-transcripts\/[\w.-]+\.md$/.test(scene.transcriptPath || ''))continue;
        const target=file.path.slice(0,file.path.lastIndexOf('/')+1)+scene.transcriptPath;
        if(app.vault.getAbstractFileByPath(target)?.extension==='md')transcriptPaths.set('recap:'+campaign+':'+bundle.number+':'+scene.id,target);
      }
      bundles.push(bundle);
    } catch(error){warnings.push(file.path+': '+error.message);}
  });
  bundles.sort((a,b)=>a.key.localeCompare(b.key));
  const index=compileInteractionIndex(store,registry,null,bundles);
  for(const id of transcriptPaths.keys())index.transcripts[id]=true;
  const fallback=new Contexts(store,registry,{default_date:'1750-01-01'}).resolve().date;
  return {store,registry,index,incoming,ownership:buildBacklinkCampaigns(store,registry),transcriptPaths,fallback,warnings:[...warnings,...index.warnings]};
}
export function knownCampaigns(snapshot,metadata) {
  const identities=campaignIdentities(snapshot.registry),codes=new Set(list(metadata.knownTo).map(value=>identities.get(String(value).trim().toLowerCase())).filter(Boolean));
  return Object.values(snapshot.registry.campaigns || {}).filter(campaign=>codes.has(campaign.code));
}
export function interactionsDate(metadata,globals,fallback) {
  const value=bioDate(metadata,globals,fallback);
  if(value && typeof value==='object') {
    const date=String(value.year).padStart(4,'0')+'-'+String(Number(value.month)+1).padStart(2,'0')+'-'+String(value.day).padStart(2,'0');
    const period=interactionDate(date);if(period)return period.end;
  }
  const period=interactionDate(value);if(!period)throw new Error('The active calendar date is invalid.');return period.end;
}
export function localInteractions(snapshot,path,campaign,date,app) {
  const entry=snapshot.store.bySlug.get(path);
  const context={kind:'custom',id:'custom',campaigns:[campaign.code],date,dm:true},references=[];
  for(const reference of snapshot.incoming.get(path) || []) {
    if(!snapshot.ownership.get(reference.source)?.includes(campaign.code))continue;
    const notes=[],body=filterComments(reference.marked,{...context,notes});
    const visible=body+'\n'+notes.map(note=>note.text).join('\n');
    if(reference.markers.some(marker=>visible.includes(marker)))references.push({id:'reference:'+campaign.code+':'+reference.source,campaign:campaign.code,source:reference.source,kind:'reference',when:[{}]});
  }
  const index={...snapshot.index,byTarget:{[path]:[...(snapshot.index.byTarget[path] || []),...references]}};
  const groups=campaignInteractions(index,snapshot.store,entry,context,snapshot.registry);
  const group=groups[0] || {code:campaign.code,label:campaign.name,known:true,events:[]},links=new Map();
  const native=target=>{
    if(!target)return null;
    const url='obsidian://open?vault='+encodeURIComponent(app.vault.getName())+'&file='+encodeURIComponent(target);links.set(url,target);return url;
  };
  const fromPage=url=>url?.startsWith('/page/') ? url.slice(6).split('?')[0].split('/').map(decodeURIComponent).join('/') : null;
  return {group:{...group,events:group.events.map(event=>({...event,url:native(fromPage(event.url)),sessionUrl:native(fromPage(event.sessionUrl)),
    transcriptUrl:native(snapshot.transcriptPaths.get(event.id))}))},links};
}
