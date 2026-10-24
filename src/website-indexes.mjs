import path from 'node:path';
import {escapeHtml,pageUrl,RenderError} from './common.mjs';
import {availableInContext} from './content-store.mjs';
import {headerIndexesForMetadata,parseIndex,queryIndex,indexHasResults} from './indexes.mjs';
import {resolveIndex} from './index-registry.mjs';
import {indexNeedsContent,hydrateIndexItem} from './index-columns.mjs';
import {indexView,indexPopupShell,indexError} from './index-view.mjs';
import {indexImageEntry} from './index-images.mjs';
import {imageUrl,responsiveImages} from './images.mjs';
import {firstDescriptionSentence} from './index-description.mjs';
export const HEADER_INDEX_SLOT='<div class="taelgar-header-index-slot"></div>';
function indexEnvironment(env) {
  const {store,context,entry}=env;
  const entries=new Map(store.entries.filter(item=>item.note).map(item=>[item.id,item]));
  const visible=page=>availableInContext(entries.get(page.path),context,store.settings);
  const resolve=(target,source)=>{
    let found;
    if(/^\.\.?\//.test(target)) {
      const relative=path.posix.normalize(path.posix.join(path.posix.dirname(source),target));
      const matches=store.canonical.get(relative) || store.canonical.get(relative+'.md');
      if(matches?.size===1)found=[...matches][0];
    }else found=store.lookup(target).entry;
    return found?.note?{path:found.id,name:found.name,metadata:found.note.metadata}:undefined;
  };
  return {entries,query:{date:context.date,sourcePath:entry.id,resolve,visible,indexRegistry:store.indexRegistry,host:'website'}};
}
function websiteIndex(options,env,heading=false) {
  const {store,context,headers}=env,{entries,query}=indexEnvironment(env);
  const result=queryIndex(headers,options,query);
  env.warnings.push(...result.warnings);
  for(const item of result.items) {
    let firstSentence,image;
    if(indexNeedsContent(options,'firstSentence')) {
      const entry=entries.get(item.path),note=env.noteLoading?.notes.get(entry.id) || entry.note;
      if(typeof note.body!=='string')env.noteLoading?.pending.set(entry.id,entry);
      else firstSentence=firstDescriptionSentence(note,{date:context.date,campaigns:context.campaigns,dm:context.dm,source:entry.id});
    }
    if(indexNeedsContent(options,'image')) {
      const asset=indexImageEntry(store,item.imageTarget,item.path);
      if(asset)image=imageUrl(asset);
    }
    hydrateIndexItem(item,{image,firstSentence});
  }
  const link=item=>item.path?'<a class="taelgar-index-link" href="'+escapeHtml(pageUrl(entries.get(item.path).slug,context.date,context))+'">'+escapeHtml(item.name)+'</a>':escapeHtml(item.name);
  return responsiveImages(indexView(result,link,options.mode,{heading}),store,{});
}
export function renderIndexBlock(source,env) {
  if(!env.headers)return '';
  try {
    const options=parseIndex(source,env.store.indexRegistry);
    if(!options.enabled)return '';
    return websiteIndex(options,env,options.heading);
  }catch(error){env.warnings.push(error.message);return indexError(error);}
}
function headerIds(env) {
  return headerIndexesForMetadata(env.entry.note.metadata,env.store.indexRegistry,{snapshot:env.headers,date:env.context.date,sourcePath:env.entry.id});
}
export function addHeaderIndexes(html,env) {
  if(!html.includes(HEADER_INDEX_SLOT))return html;
  let output;
  try {
    const {query}=indexEnvironment(env);
    output=headerIds(env).map(index=>resolveIndex(env.store.indexRegistry,{index},{header:true})).filter(options=>options.enabled && (!options.header.hideWhenEmpty || indexHasResults(env.headers,options,query))).map(options=>{
      const url=new URL(pageUrl(env.entry.slug,env.context.date,env.context),'https://index.invalid');
      url.searchParams.set('page',env.entry.slug);url.searchParams.set('index',options.index);
      return indexPopupShell({index:options.index,label:options.label,target:env.entry.title,url:'/api/index?'+url.searchParams});
    }).join('');
  }catch(error){env.warnings.push(error.message);output=indexError(error);}
  return html.replace(HEADER_INDEX_SLOT+(output?'':'\n'),output?'<div class="taelgar-index-buttons">'+output+'</div>':'');
}
export function renderHeaderIndex(index,env) {
  if(!headerIds(env).includes(index))throw new RenderError(404,'Index is not available');
  const options=resolveIndex(env.store.indexRegistry,{index},{header:true});
  if(!options.enabled)throw new RenderError(404,'Index is not available');
  return websiteIndex(options,env);
}
