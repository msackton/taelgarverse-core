import path from 'node:path';
import {parse} from 'yaml';
import MarkdownIt from 'markdown-it';
import {IMAGE_TYPES,parseNote,publicationExclusions,availableInContext} from './content-store.mjs';
import {escapeHtml,pageUrl} from './common.mjs';
import {measurementOptions} from './map-distance.mjs';
import {validateManifest,resolveMapSource} from './map-core.mjs';
import {baselineViewConfig} from './map-block.mjs';

import {resolvedMapLayers} from './map-layers.mjs';
import {resolveMapPath,pathIntersectsCrop} from './map-feature-path.mjs';

const point = value => Array.isArray(value) && value.length === 2 && value.every(v => Number.isFinite(v) && Math.abs(v) <= 10_000_000);
function number(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(name + ' must be a number');
  return value;
}
function dimension(value, fallback) {
  if (value === undefined) return fallback;
  const match = /^(\d+(?:\.\d+)?)(px|%)?$/.exec(String(value).trim());
  if (!match || Number(match[1]) <= 0 || Number(match[1]) > 2000) throw new Error('Invalid map size');
  return match[1] + (match[2] || 'px');
}

const exactEntry=(store,id)=>[...(store.canonical.get(id) || [])].find(entry=>entry.id===id);
function baselineMap(data,store,author,verifyImage) {
  if(typeof data.source!=='string')throw new Error('Use a local .map.json source; enclose [[wikilinks]] in quotes');
  const target=data.source.trim().replace(/^!?\[\[|\]\]$/g,'').split('|')[0].trim();
  if(!target || /[:?#\x00-\x1f\x7f\\]/.test(target) || target.startsWith('/'))throw new Error('Manifest source must be a local vault path');
  const relative=path.posix.normalize(path.posix.join(path.posix.dirname(author.id),target));
  if(relative==='..' || relative.startsWith('../'))throw new Error('Manifest source must stay inside the vault');
  const source=exactEntry(store,relative) || exactEntry(store,target) || (!target.includes('/') && store.lookup(target).entry);
  if(!source || source.note || !source.id.endsWith('.map.json'))throw new Error('Map manifest is missing or ambiguous: '+target);
  if(source.mapManifestError)throw new Error('Invalid map manifest: '+source.mapManifestError);
  const manifest={...validateManifest(source.mapManifest)};
  delete manifest.regionLayers;
  const documents=(manifest.layers??[]).map(relative=>{
    const id=path.posix.join(path.posix.dirname(source.id),relative),file=exactEntry(store,id);
    if(!file?.mapLayers || file.mapLayersError)throw new Error('Map layer file missing or invalid: '+id+(file?.mapLayersError?' · '+file.mapLayersError:''));
    return {path:id,data:file.mapLayers};
  });
  if(documents.length)manifest.regionLayers=resolvedMapLayers(documents);
  const imagePath=path.posix.join(path.posix.dirname(source.id),manifest.image),entry=exactEntry(store,imagePath);
  if(!entry || entry.note || entry.extension!=='.png')throw new Error('Core image is missing: '+imagePath);
  if(verifyImage){
    if(source.mapValidationError)throw new Error(source.mapValidationError);
    if(entry.mapImageInfo?.format!=='png')throw new Error('Map image has not been prepared');
  }
  const image='/assets/'+entry.target.split('/').map(encodeURIComponent).join('/');
  return {entry,manifest,manifestEntry:source,block:data,
    config:verifyImage?baselineViewConfig(data,resolveMapSource(manifest,entry.mapImageInfo),image):null};
}

export function parseMap(source, store, author, {verifyImage=true}={}) {
  // Obsidian's unquoted wikilinks look like nested YAML sequences. Keep the
  // image field literal, including the triple brackets used by Sembara.
  source = source.replace(/^(\s*image:\s*)(!?(?:\[{2,})[^\n]*?\]{2,})\s*$/gm,
    (_,prefix,image) => prefix + JSON.stringify(image));
  const data = parse(source, {maxAliasCount:0});
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a map definition');
  if(data.version===2 || data.source!==undefined){
    try{return baselineMap(data,store,author,verifyImage);}
    catch(error){error.mapBaseline=true;throw error;}
  }
  const bounds = data.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 2 || !bounds.every(point) ||
      bounds[0].some((v,i) => v >= bounds[1][i])) throw new Error('Map bounds must contain two increasing coordinate pairs');
  let image = data.image;
  if (typeof image !== 'string') throw new Error('A single map image is required');
  image = image.trim().replace(/^!?\[{2,}|\]{2,}$/g,'').split('|')[0].trim();
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(author.id),image));
  // Prefer an exact authored relative path before the normal vault lookup.
  const exact = store.canonical.get(relative);
  const resolution = exact ? {entry:exact.size === 1 ? [...exact][0] : undefined} : store.lookup(image);
  const entry = resolution.entry;
  if (!entry || entry.note || !IMAGE_TYPES.has(entry.extension)) throw new Error('Map image is missing or ambiguous: ' + image);
  const minZoom = number(data.minZoom,-3,'minZoom'), maxZoom = number(data.maxZoom,2,'maxZoom');
  if (minZoom < -10 || maxZoom > 10 || minZoom > maxZoom) throw new Error('Invalid map zoom limits');
  const defaultZoom = Math.max(minZoom,Math.min(maxZoom,number(data.defaultZoom,minZoom,'defaultZoom')));
  const hasCenter = data.lat !== undefined && data.long !== undefined;
  const center = hasCenter ? [number(data.lat,0,'lat'),number(data.long,0,'long')] : undefined;
  return {entry,config:{bounds,minZoom,maxZoom,defaultZoom,center,fitBounds:data.fitBounds === true || !center,
    height:dimension(data.height,'600px'),width:dimension(data.width,'100%'),
    measurement:measurementOptions(data,entry,bounds),
    image:'/assets/' + entry.target.split('/').map(encodeURIComponent).join('/')}};
}

export function renderMap(source, env) {
  try {
    const {entry,config,manifest} = parseMap(source,env.store,env.entry);
    if(config.version===2){
      const paths=[];
      for(const target of env.store.entries??[]){
        if(!target.note?.metadata?.mapPath || !availableInContext(target,env.context??{date:env.date,campaigns:[]},env.store.settings))continue;
        let value;
        try{if(target.mapPathError)throw new Error(target.mapPathError);value=resolveMapPath(target.note.metadata.mapPath,target.mapPathGeometry);}
        catch{env.warnings.push('Map: invalid mapPath in '+target.id);continue;}
        if(pathIntersectsCrop(value.points,config.crop,manifest.sourceOffset))
          paths.push({...value,id:target.id,name:target.name??target.id,href:pageUrl(target.slug,env.date,env.context)});
      }
      if(paths.length){config.mapPaths=paths;config.sourceOffset=manifest.sourceOffset;}
    }
    if(config.regionLayers){
      config.regionLinks={};
      for(const layer of config.regionLayers)for(const region of layer.regions){
        if(!region.note)continue;
        const target=env.store.lookup(region.note).entry;
        if(target?.note && availableInContext(target,env.context??{date:env.date,campaigns:[]},env.store.settings))
          config.regionLinks[layer.key+'#'+region.id]=pageUrl(target.slug,env.date,env.context);
      }
    }
    if(!config.measurement)env.warnings.push('Leaflet map: distance measurement disabled; verify image calibration, unit, and scale');
    const tile = entry.mapTiles?.find(tile => JSON.stringify(tile.bounds) === JSON.stringify(config.bounds));
    if (tile) config.tile = tile;
    const label = 'Map: ' + path.posix.basename(entry.id,path.posix.extname(entry.id)).replace(/[-_]/g,' ');
    return '<figure class="leaflet-map" data-map="' + escapeHtml(JSON.stringify(config)) + '">' +
      '<div class="map-canvas" hidden role="region" aria-label="' + escapeHtml(label) + '" style="--map-height:' + config.height + ';--map-width:' + config.width + '"></div>' +
      '<figcaption><span class="map-status" role="status">Interactive map requires JavaScript. </span>' +
      '<a href="' + escapeHtml(config.image) + '" target="_blank" rel="noopener">'+(config.version===2?'Open full source image':'Open map image')+'</a></figcaption></figure>\n';
  } catch (error) {
    env.warnings.push('Leaflet map: ' + error.message);
    return '<div class="admonition warning"><p class="admonition-title">Map unavailable</p><p>' + escapeHtml(error.message) + '</p></div>\n';
  }
}

export function mapImages(store,{homeSource=null,campaignHomes={},strict=false}={}) {
  const result = [], seen = new Set(), markdown = new MarkdownIt();
  const authors=store.entries.filter(entry=>entry.note);
  if(homeSource!==null)authors.push({id:'_website/home.md',note:typeof homeSource==='string'?parseNote(homeSource):homeSource});
  for(const [host,source] of Object.entries(campaignHomes))authors.push({id:'_website/'+host+'.md',note:typeof source==='string'?parseNote(source):source});
  for (const author of authors) {
    if(publicationExclusions(author.note.metadata).includes('all'))continue;
    for (const token of markdown.parse(author.note.body,{})) {
      if (token.type !== 'fence' || !/^(?:taelgar-map|leaflet)(?:\s|$)/i.test(token.info.trim())) continue;
      try {
        const map = parseMap(token.content,store,author,{verifyImage:false});
        map.entry.mapImage = true;
        // Validate every referenced manifest, even when two maps share an image.
        const key = map.entry.id + JSON.stringify(map.block??map.config.bounds)+(map.manifestEntry?.id || '');
        if (!seen.has(key)) {seen.add(key);result.push(map);}
      } catch(error) {
        if(strict && error.mapBaseline)throw new Error(author.id+': '+error.message);
        // The renderer reports invalid legacy definitions on their article.
      }
    }
  }
  return result;
}
