import path from 'node:path';
import {availableInContext} from './content-store.mjs';
import {escapeHtml,pageUrl} from './common.mjs';
import {parseIndex,queryIndex} from './indexes.mjs';
import {indexView,indexError} from './index-view.mjs';
import {indexImageEntry} from './index-images.mjs';
import {imageUrl,responsiveImages} from './images.mjs';

function indexEnvironment(env) {
  const {store,context,entry}=env;
  const entries=new Map(store.entries.filter(entry=>entry.note).map(entry=>[entry.id,entry]));
  const visible=page=>availableInContext(entries.get(page.path),context);
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
    return options.show === 'obsidian' ? '' : websiteIndex(options,env,options.heading);
  } catch (error) {env.warnings.push(error.message);return indexError(error);}
}
