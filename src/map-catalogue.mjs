import {createHash} from 'node:crypto';
import {parse} from 'yaml';
import {scanFencedCodeBlocks} from './markdown-fences.mjs';
import {filterComments} from './comments.mjs';
import {availableInContext} from './content-store.mjs';
import {resolveMap} from './maps.mjs';
import {RenderError,pageUrl} from './common.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fences=body=>scanFencedCodeBlocks(body).filter(block=>['taelgar-map','leaflet'].includes(block.language));

// Optional publication optimization. Keep the original body so comment/date/
// campaign filtering happens for each request, before any definition is exposed.
export function compileMapSources(store) {
  return store.entries.filter(entry=>entry.note && typeof entry.note.body==='string' && fences(entry.note.body).length)
    .map(entry=>({id:entry.id,body:entry.note.body}));
}

async function mapSources(engine) {
  if(engine.loadMapSources)return engine.loadMapSources();
  return compileMapSources(engine.store);
}

function absoluteConfig(config,origin) {
  const result=structuredClone(config),absolute=value=>new URL(value,origin).href;
  result.image=absolute(result.image);
  if(result.tile)result.tile.baseUrl=absolute(result.tile.baseUrl);
  for(const layer of result.detailLayers??[])if(layer.image)layer.image=absolute(layer.image);
  for(const path of result.mapPaths??[])if(path.href)path.href=absolute(path.href);
  if(result.regionLinks)for(const key of Object.keys(result.regionLinks))result.regionLinks[key]=absolute(result.regionLinks[key]);
  return result;
}

export async function mapCatalogue(engine,{context,origin,revision=null,siteHost,page,id,limit=50,offset=0}={}) {
  if(!context?.date)throw new RenderError(400,'A map context is required');
  let selected;
  if(page){selected=engine.store.resolve(page);if(!availableInContext(selected,context))throw new RenderError(404,'Page is not available in this context');}
  const sources=await mapSources(engine),authors=[];
  for(const source of sources){
    const entry=engine.store.entries.find(entry=>entry.id===source.id);
    if(entry?.note && (!selected || entry===selected) && availableInContext(entry,context))authors.push({entry,body:source.body});
  }
  const home=siteHost?engine.campaignSites.byHost.get(siteHost)?.note:engine.home;
  if(!selected && home)authors.push({entry:{id:'_website/'+(siteHost||'home')+'.md',title:home.metadata.title||'Home',home:true},body:home.body});
  const maps=[],warnings=[];
  for(const {entry:author,body} of authors){
    let blocks;
    try{blocks=fences(filterComments(body,{...context,source:author.id}));}
    catch(error){if(error.status!==422)throw error;warnings.push('Maps omitted from '+author.id+': invalid comment syntax');continue;}
    const seen=new Set(),duplicates=new Set(),resolved=[];
    for(const block of blocks){
      try{
        const data=parse(block.body.replace(/^(\s*image:\s*)(!?(?:\[{2,})[^\n]*?\]{2,})\s*$/gm,(_,prefix,value)=>prefix+JSON.stringify(value)),{maxAliasCount:0});
        const blockId=typeof data?.id==='string' && data.id.trim()?data.id.trim():null;
        const key=blockId?'id:'+blockId:'definition:'+hash(block.body.trim());
        const mapId='map-'+hash(author.id+'\0'+key).slice(0,32);
        if(seen.has(mapId)){duplicates.add(mapId);warnings.push('Duplicate map identity in '+author.id+'; assign unique block IDs');continue;}
        seen.add(mapId);
        const {entry,config,manifest}=resolveMap(block.body,{store:engine.store,entry:author,context,date:context.date,warnings});
        const sourceRevision=hash(JSON.stringify({config,imageHash:entry.sha256??null,manifest:manifest??null}));
        resolved.push({id:mapId,blockId,title:typeof data.title==='string'?data.title:author.title||author.name||author.id,
          page:{id:author.id,title:author.title||author.name||'Home',url:author.home?new URL('/',origin).href:new URL(pageUrl(author.slug,context.date,context),origin).href},
          sourceRevision,preview:new URL(config.image,origin).href,
          coordinates:{frame:config.version===2?'photoshop-pixels':'leaflet',...(config.version===2?{sourceOffset:manifest.sourceOffset}:{}),unit:config.measurement?.unit??null},
          config:absoluteConfig(config,origin)});
      }catch(error){warnings.push('Map unavailable in '+author.id+': '+error.message);}
    }
    maps.push(...resolved.filter(map=>!duplicates.has(map.id)));
  }
  maps.sort((a,b)=>a.page.id.localeCompare(b.page.id)||a.id.localeCompare(b.id));
  const base={version:1,revision,context,warnings:[...new Set(warnings)]};
  if(id){const map=maps.find(map=>map.id===id);if(!map)throw new RenderError(404,'Map is not available in this context');return {...base,map};}
  return {...base,total:maps.length,offset,limit,maps:maps.slice(offset,offset+limit).map(({config,...summary})=>summary)};
}
