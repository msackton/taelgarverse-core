import path from 'node:path';
import {load} from 'cheerio';
import {availableInContext} from './content-store.mjs';
import {escapeHtml,pageUrl,RenderError} from './common.mjs';
import {headerIndexesForMetadata,parseIndex,queryIndex,indexHasResults,indexLabels} from './indexes.mjs';
import {indexView,indexPopupShell,indexError} from './index-view.mjs';
import {indexImageEntry} from './index-images.mjs';
import {imageUrl,responsiveImages} from './images.mjs';
import {firstDescriptionSentence} from './index-description.mjs';

export const HEADER_INDEX_SLOT='<div class="taelgar-header-index-slot"></div>';

function indexEnvironment(env) {
  const {store,context,entry,headers}=env;
  const entries=new Map(store.entries.filter(entry=>entry.note).map(entry=>[entry.id,entry]));
  const visible=page=>availableInContext(entries.get(page.path),context,store.settings);
  const resolve=(target,source)=>{
    let entry;
    if (/^\.\.?\//.test(target)) {
      const relative=path.posix.normalize(path.posix.join(path.posix.dirname(source),target));
      const matches=store.canonical.get(relative) || store.canonical.get(relative+'.md');
      if(matches?.size===1)entry=[...matches][0];
    } else entry=store.lookup(target).entry;
    return entry?.note ? {path:entry.id,name:entry.name,metadata:entry.note.metadata} : undefined;
  };
  return {entries,query:{date:context.date,sourcePath:entry.id,resolve,visible}};
}

function websiteIndex(options,env,heading=false) {
  const {store,context,headers}=env,{entries,query}=indexEnvironment(env);
  const result=queryIndex(headers,options,query);
  env.warnings.push(...result.warnings);
  if(options.type==='members' && options.mode!=='table')for(const item of result.items) {
    const entry=entries.get(item.path);
    const note=env.noteLoading?.notes.get(entry.id) || entry.note;
    if(typeof note.body!=='string') {
      env.noteLoading?.pending.set(entry.id,entry);
      continue;
    }
    item.firstSentence=firstDescriptionSentence(note,{date:context.date,campaigns:context.campaigns,dm:context.dm,source:entry.id});
  }
  if(options.mode!=='table')for(const item of result.items) {
    const asset=indexImageEntry(store,item.imageTarget,item.path);
    if(asset)item.image=imageUrl(asset);
  }
  const link=item=>item.path ? '<a class="taelgar-index-link" href="'+escapeHtml(pageUrl(entries.get(item.path).slug,context.date,context))+'">'+escapeHtml(item.name)+'</a>' : escapeHtml(item.name);
  return responsiveImages(indexView(result,link,options.mode,{heading}),store,{});
}

export function renderIndexBlock(source,env) {
  // Search/backlink compilers have no header snapshot: generated rows are not
  // authored prose or authored incoming links, and must not be materialized.
  if (!env.headers) return '';
  try {
    const options=parseIndex(source);
    return options.show === 'obsidian' ? '' : websiteIndex(options,env,true);
  } catch (error) {env.warnings.push(error.message);return indexError(error);}
}

export function addHeaderIndexes(html,env) {
  const $=load(html,{},false),slot=$('.taelgar-header-index-slot').first();
  if (!slot.length) return html;
  let output;
  try {
    const {query}=indexEnvironment(env);
    output=headerIndexesForMetadata(env.entry.note.metadata).filter(type=>indexHasResults(env.headers,{type},query)).map(type=>{
      const url=new URL(pageUrl(env.entry.slug,env.context.date,env.context),'https://index.invalid');
      url.searchParams.set('page',env.entry.slug);url.searchParams.set('type',type);
      return indexPopupShell({type,label:indexLabels[type],target:env.entry.title,url:'/api/index?'+url.searchParams});
    }).join('');
  }
  catch (error) {env.warnings.push(error.message);output=indexError(error);}
  slot.replaceWith(output ? '<div class="taelgar-index-buttons">'+output+'</div>' : '');
  return $.html();
}

// The endpoint only renders index types enabled on this source page.
export function renderHeaderIndex(type,env) {
  if(!Object.hasOwn(indexLabels,type) || !headerIndexesForMetadata(env.entry.note.metadata).includes(type))throw new RenderError(404,'Index is not available');
  return websiteIndex({type},env);
}
