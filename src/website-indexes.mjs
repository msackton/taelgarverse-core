import path from 'node:path';
import {load} from 'cheerio';
import {availableInContext} from './content-store.mjs';
import {escapeHtml,pageUrl} from './common.mjs';
import {headerIndexes,parseIndex,queryIndex} from './indexes.mjs';
import {indexView,indexPopup,indexError} from './index-view.mjs';
import {indexImageEntry} from './index-images.mjs';
import {imageUrl,responsiveImages} from './images.mjs';

export const HEADER_INDEX_SLOT='<div class="taelgar-header-index-slot"></div>';

function websiteIndex(options,env,popup=false) {
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
  const result=queryIndex(headers,options,{date:context.date,sourcePath:entry.id,resolve,visible});
  env.warnings.push(...result.warnings);
  if(popup || options.mode!=='table')for(const item of result.items) {
    const asset=indexImageEntry(store,item.imageTarget,item.path);
    if(asset)item.image=imageUrl(asset);
  }
  const link=item=>item.path ? '<a class="taelgar-index-link" href="'+escapeHtml(pageUrl(entries.get(item.path).slug,context.date,context))+'">'+escapeHtml(item.name)+'</a>' : escapeHtml(item.name);
  return responsiveImages(popup ? indexPopup(result,link) : indexView(result,link,options.mode),store,{});
}

export function renderIndexBlock(source,env) {
  // Search/backlink compilers have no header snapshot: generated rows are not
  // authored prose or authored incoming links, and must not be materialized.
  if (!env.headers) return '';
  try {
    const options=parseIndex(source);
    return options.show === 'obsidian' ? '' : websiteIndex(options,env);
  } catch (error) {env.warnings.push(error.message);return indexError(error);}
}

export function addHeaderIndexes(html,env) {
  const $=load(html,{},false),slot=$('.taelgar-header-index-slot').first();
  if (!slot.length) return html;
  let output;
  try {output=headerIndexes(env.entry.note.metadata.indexes).map(type=>websiteIndex({type},env,true)).join('');}
  catch (error) {env.warnings.push(error.message);output=indexError(error);}
  slot.replaceWith(output ? '<div class="taelgar-index-buttons">'+output+'</div>' : '');
  return $.html();
}
