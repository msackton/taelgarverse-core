import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {mapImages} from '../src/maps.mjs';

const tileSize = 512, quality = 85;
const pending = new Map();

async function pyramid(entry, bounds, cacheDir) {
  const input = await fs.readFile(entry.filename), metadata = await sharp(input).metadata();
  const height = bounds[1][0], width = bounds[1][1];
  const minNativeZoom = Math.min(0,Math.floor(Math.log2(tileSize / Math.max(width,height))));
  let maxNativeZoom = Math.max(0,Math.ceil(Math.log2(Math.max(metadata.width/width,metadata.height/height))));
  // Bound publication work even for an accidentally enormous source image.
  while (width * height * 4 ** maxNativeZoom > 160_000_000 && maxNativeZoom > minNativeZoom) maxNativeZoom--;
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
  let complete = false;
  try {
    await fs.access(marker);
    await Promise.all(files.map(file=>fs.access(file.filename)));
    complete = true;
  } catch { /* Incomplete caches are rebuilt before they are registered. */ }
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
  return {files,tile:{bounds,width,height,tileSize,minNativeZoom,maxNativeZoom,baseUrl:'/assets/map-tiles/'+key}};
}

export async function prepareMaps(store, cacheDir) {
  const generated = [];
  for (const {entry,config} of mapImages(store)) {
    if(!entry.sha256){
      const hash=createHash('sha256');
      for await(const chunk of createReadStream(entry.filename))hash.update(chunk);
      entry.sha256=hash.digest('hex');
    }
    // Small regional maps remain image overlays. Tiling covers the large
    // world maps; arbitrary nonzero-origin bounds still work as overlays.
    if (Math.max(...config.bounds[1]) < 4096 || config.bounds[0].some(Boolean)) continue;
    const cacheKey = cacheDir + entry.filename + JSON.stringify(config.bounds);
    let task = pending.get(cacheKey);
    if (!task) {
      task = pyramid(entry,config.bounds,cacheDir);pending.set(cacheKey,task);
      task.finally(()=>pending.delete(cacheKey)).catch(()=>{});
    }
    const {files,tile} = await task;
    entry.mapTiles = [...(entry.mapTiles || []).filter(old=>JSON.stringify(old.bounds)!==JSON.stringify(tile.bounds)),tile];
    for (const file of files) if (!store.assets.has(file.target)) {
      store.assets.set(file.target,file);store.entries.push(file);generated.push(file);
    }
  }
  return generated;
}
