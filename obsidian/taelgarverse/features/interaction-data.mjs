import {ContentStore} from '../../../src/content-store.mjs';
import {scanHeaderCallouts} from '../../../src/header-callout.mjs';
import {buildBacklinkCampaigns} from '../../../src/campaign-ownership.mjs';
import {compileInteractionIndex,campaignIdentities,campaignInteractions,interactionDate,interactionReferenceType,sessionNoteFallbacks} from '../../../src/campaign-interactions.mjs';
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
  const recaps=files.filter(file=>/^_sessions\/[^/]+\/[^/]+\/cleaned\/[^/]+-session-recap\.md$/.test(file.path));
  const bundles=[],warnings=[];
  await readFiles(recaps,async file=>{
    try {
      const bundle=parseSessionRecap(await app.vault.cachedRead(file),file.path);
      bundles.push(bundle);
    } catch(error){warnings.push(file.path+': '+error.message);bundles.push({key:file.path,invalid:true});}
  });
  bundles.sort((a,b)=>a.key.localeCompare(b.key));
  const fallbacks=sessionNoteFallbacks(store,registry,bundles);
  const roots=Object.values(registry.campaigns || {}).map(campaign=>String(campaign.campaignRoot || '').replace(/\/+$/,'')).filter(Boolean);
  const references=entries.filter(entry=>fallbacks.has(entry.slug) || (roots.some(root=>entry.id.startsWith(root+'/')) &&
    interactionReferenceType(app.metadataCache.getFileCache(entry.file)?.frontmatter) &&
    !list(entry.note.metadata.tags).includes('session-note') && entry.note.metadata.sessionNumber==null));
  const incoming=new Map();
  await readFiles(references,async entry=>{
    const source=await app.vault.cachedRead(entry.file);
    // Cache positions refer to the original text. Mask generated regions rather
    // than shortening the body, retaining exact native offsets after a callout.
    const frontmatter=/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
    const start=frontmatter?.[0].length || 0,body=source.slice(start),callouts=scanHeaderCallouts(body);
    const cache=app.metadataCache.getFileCache(entry.file),targets=new Map();
    const seen=new Set();
    const links=[...(cache?.links || []),...(cache?.embeds || [])].filter(link=>{
      const from=link.position?.start?.offset,to=link.position?.end?.offset,key=from+':'+to;
      if(!(from>=start && to>from && to<=source.length) || seen.has(key) || (link.original && source.slice(from,to)!==link.original))return false;
      if(callouts.some(callout=>from-start<callout.end && to-start>callout.start))return false;
      seen.add(key);return true;
    }).sort((a,b)=>b.position.start.offset-a.position.start.offset);
    let marked=body;
    for(const callout of [...callouts].reverse())marked=marked.slice(0,callout.start)+
      marked.slice(callout.start,callout.end).replace(/[^\r\n]/g,' ')+marked.slice(callout.end);
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
  // Native occurrence visibility is evaluated per render below; the compiled
  // fallback stores only the session identity and dates, never session prose.
  const backlinks={version:2,byTarget:Object.fromEntries([...incoming].map(([target,records])=>
    [target,records.filter(record=>fallbacks.has(record.source)).map(record=>({source:record.source,when:[{}]}))]))};
  const index=compileInteractionIndex(store,registry,backlinks,bundles);
  const fallback=new Contexts(store,registry,{default_date:'1750-01-01'}).resolve().date;
  return {store,registry,index,incoming,sessionFallbacks:fallbacks,ownership:buildBacklinkCampaigns(store,registry),fallback,warnings:[...warnings,...index.warnings]};
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
  const context={kind:'custom',id:'custom',campaigns:[campaign.code],date,dm:true},references=[],visibleSources=new Set();
  for(const reference of snapshot.incoming.get(path) || []) {
    if(!snapshot.ownership.get(reference.source)?.includes(campaign.code))continue;
    const notes=[],body=filterComments(reference.marked,{...context,notes});
    const visible=body+'\n'+notes.map(note=>note.text).join('\n');
    if(reference.markers.some(marker=>visible.includes(marker))) {
      visibleSources.add(reference.source);
      if(!snapshot.sessionFallbacks.has(reference.source))references.push({id:'reference:'+campaign.code+':'+reference.source,campaign:campaign.code,source:reference.source,kind:'reference',when:[{}]});
    }
  }
  const records=(snapshot.index.byTarget[path] || []).filter(record=>record.kind!=='session-reference' || visibleSources.has(record.source));
  const index={...snapshot.index,byTarget:{[path]:[...records,...references]}};
  const groups=campaignInteractions(index,snapshot.store,entry,context,snapshot.registry);
  const group=groups[0] || {code:campaign.code,label:campaign.name,known:true,events:[]},links=new Map();
  const native=target=>{
    if(!target)return null;
    const url='obsidian://open?vault='+encodeURIComponent(app.vault.getName())+'&file='+encodeURIComponent(target);links.set(url,target);return url;
  };
  const fromPage=url=>url?.startsWith('/page/') ? url.slice(6).split('?')[0].split('/').map(decodeURIComponent).join('/') : null;
  return {group:{...group,events:group.events.map(event=>({...event,url:native(fromPage(event.url)),sessionUrl:native(fromPage(event.sessionUrl))}))},links};
}
