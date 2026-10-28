import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {mapImages} from '../src/maps.mjs';
import {resolveMapSource} from '../src/map-core.mjs';
import {baselineViewConfig} from '../src/map-block.mjs';
import {animatedPNG} from './optimize-images.mjs';

const tileSize = 512, quality = 85;
const tileMinEdge = 2048, tileMinBytes = 1024 * 1024;
const pending = new Map();

async function pyramid(input, metadata, bounds, cacheDir, derivativeCache) {
  const height = bounds[1][0], width = bounds[1][1];
  const minNativeZoom = Math.min(0,Math.floor(Math.log2(tileSize / Math.max(width,height))));
  let maxNativeZoom = Math.max(0,Math.ceil(Math.log2(Math.max(metadata.width/width,metadata.height/height))));
  // Bound publication work even for an accidentally enormous source image.
  while (width * height * 4 ** maxNativeZoom > 160_000_000 && maxNativeZoom > minNativeZoom) maxNativeZoom--;
  // Bump this recipe version for tiling, output-format, or compression algorithm
  // changes. Publication fingerprints and --force do not invalidate this cache.
  const key = createHash('sha256').update(input).update(JSON.stringify({version:1,bounds,tileSize,quality,
    minNativeZoom,maxNativeZoom,sharp:sharp.versions})).digest('hex');
  const directory = path.join(cacheDir,key), marker = path.join(directory,'complete.json');
  const files = [];
  for (let z=minNativeZoom; z<=maxNativeZoom; z++) {
    const w = Math.max(1,Math.round(width * 2 ** z)), h = Math.max(1,Math.round(height * 2 ** z));
    const cols = Math.ceil(w/tileSize), rows = Math.ceil(h/tileSize);
    for (let x=0;x<cols;x++) for (let y=0;y<rows;y++) files.push({
      id:'map-tiles/'+key+'/'+z+'/'+x+'/'+y+'.webp',target:'map-tiles/'+key+'/'+z+'/'+x+'/'+y+'.webp',
      filename:path.join(directory,String(z),'tiles','0',String(y),x+'.webp'),extension:'.webp',note:null,generatedMapTile:true,
    });
  }
  const remote=derivativeCache?.get('maps',key,({outputs})=>outputs.length===files.length && outputs.every((output,index)=>output.target===files[index].target));
  if(remote)files.forEach((file,index)=>{file.remoteAsset=remote.outputs[index];});
  let complete = Boolean(remote);
  if(!complete){
    try {
      await fs.access(marker);
      await Promise.all(files.map(file=>fs.access(file.filename)));
      complete = true;
    } catch { /* Incomplete caches are rebuilt before they are registered. */ }
  }
  if (!complete) {
    for (let z=minNativeZoom; z<=maxNativeZoom; z++) {
      const w = Math.max(1,Math.round(width * 2 ** z)), h = Math.max(1,Math.round(height * 2 ** z));
      const top = Math.ceil(h/tileSize)*tileSize-h;
      const level = path.join(directory,String(z));
      await fs.mkdir(level,{recursive:true});
      // North is negative pixel Y in CRS.Simple. Pad above the image so the
      // southern edge sits exactly at zero, including partial edge tiles.
      await sharp(input).resize(w,h,{fit:'fill'}).extend({top,bottom:0,left:0,right:0,background:'#e7e4dc'})
        .webp({quality}).tile({size:tileSize,layout:'google',depth:'one',skipBlanks:-1,background:'#e7e4dc'})
        .toFile(path.join(level,'tiles'));
    }
    await fs.writeFile(marker,JSON.stringify({key,tiles:files.length}));
  }
  derivativeCache?.record('maps',key,null,files.map(file=>file.target));
  return {files,tile:{bounds,width,height,tileSize,minNativeZoom,maxNativeZoom,baseUrl:'/assets/map-tiles/'+key}};
}

export async function prepareMaps(store, cacheDir, derivativeCache, sources={}) {
  const generated = [];
  const verified=new Map(),strict=sources.strict!==false;
  for (const map of mapImages(store,{...sources,strict})) {
    const {entry,manifest,manifestEntry,block}=map;
    let {config}=map;
    const input = await fs.readFile(entry.filename);
    if (manifest || !entry.sha256) entry.sha256 = createHash('sha256').update(input).digest('hex');
    let metadata;
    if(manifest){
      delete manifestEntry.mapValidationError;
      try {
        metadata=verified.get(entry.sha256);
        if(!metadata){
          // Force a full PNG decode, not just an IHDR read, before publishing a
          // calibrated image. This also rejects truncated or corrupt pixel data.
          const decoder=sharp(input,{limitInputPixels:250_000_000,failOn:'warning'});
          metadata=await decoder.metadata();await decoder.stats();
          verified.set(entry.sha256,metadata);
        }
        if(metadata.format!=='png' || (metadata.pages || 1)>1 || animatedPNG(input))
          throw new Error('Decoded map image must be a static PNG');
        entry.mapImageInfo={format:'png',width:metadata.width,height:metadata.height};
      }catch(error){
        manifestEntry.mapValidationError=error.message;
        if(strict)throw new Error(manifestEntry.id+': '+error.message);
        const warning=manifestEntry.id+': '+error.message;
        if(!store.warnings.includes(warning))store.warnings.push(warning);
        continue;
      }
      try { config=baselineViewConfig(block,resolveMapSource(manifest,entry.mapImageInfo),''); }
      catch(error){
        if(strict)throw new Error(manifestEntry.id+': '+error.message);
        const warning=manifestEntry.id+': '+error.message;
        if(!store.warnings.includes(warning))store.warnings.push(warning);
        continue;
      }
    }
    // Bounds describe display coordinates, not the download or decoded size.
    // Keep arbitrary nonzero-origin bounds as image overlays.
    if (config.bounds[0].some(Boolean)) continue;
    try { metadata ??= await sharp(input).metadata(); }
    catch (error) {
      if (!/unsupported image format|corrupt|invalid.*header|bad.*header|premature end/i.test(error.message)) throw error;
      const warning = 'Map tiles omitted for undecodable image: ' + entry.id;
      if (!store.warnings.includes(warning)) store.warnings.push(warning);
      continue;
    }
    // A static tile pyramid must not replace an animated map with one frame.
    if ((metadata.pages || 1) > 1 || animatedPNG(input)) continue;
    if (Math.max(metadata.width,metadata.height) < tileMinEdge && input.length < tileMinBytes) continue;
    const cacheKey = cacheDir + entry.filename + JSON.stringify(config.bounds);
    let task = derivativeCache ? undefined : pending.get(cacheKey);
    if (!task) {
      task = pyramid(input,metadata,config.bounds,cacheDir,derivativeCache);
      if(!derivativeCache){pending.set(cacheKey,task);task.finally(()=>pending.delete(cacheKey)).catch(()=>{});}
    }
    const {files,tile} = await task;
    entry.mapTiles = [...(entry.mapTiles || []).filter(old=>JSON.stringify(old.bounds)!==JSON.stringify(tile.bounds)),tile];
    for (const file of files) if (!store.assets.has(file.target)) {
      store.assets.set(file.target,file);store.entries.push(file);generated.push(file);
    }
  }
  return generated;
}
