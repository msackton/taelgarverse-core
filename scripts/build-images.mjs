import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {IMAGE_DEFAULTS,IMAGE_VERSION,fileHash,animatedPNG} from './optimize-images.mjs';

export const IMAGE_WIDTHS = [96,192,320,480,640,960,1440,1920,2560];
const formats = new Set(['.png','.jpg','.jpeg','.webp']);
const pending = new Map();

async function variants(entry,cacheDir,settings) {
  const sourceHash = await fileHash(entry.filename);
  const key = createHash('sha256').update(JSON.stringify({version:1,widths:IMAGE_WIDTHS,sourceHash,...settings,...IMAGE_VERSION})).digest('hex');
  const directory = path.join(cacheDir,key), marker = path.join(directory,'complete.json');
  let result;
  try {
    result = JSON.parse(await fs.readFile(marker,'utf8'));
    await Promise.all(result.variants.map(item=>fs.access(path.join(directory,item.file))));
  } catch { result = undefined; }
  if (!result) {
    const input = await fs.readFile(entry.filename), metadata = await sharp(input).metadata();
    // APNG is not reported as multipage by every libvips version.
    if ((metadata.pages || 1)>1 || animatedPNG(input)) return null;
    const rotated = metadata.orientation>=5 && metadata.orientation<=8;
    const width = rotated ? metadata.height : metadata.width, height = rotated ? metadata.width : metadata.height;
    const maxWidth = Math.max(1,Math.min(width,Math.round(width*Math.min(1,settings.maxSize/Math.max(width,height)))));
    const widths = [...new Set([...IMAGE_WIDTHS.filter(size=>size<maxWidth),maxWidth])];
    result = {width,height,sourceBytes:input.length,variants:[]};
    await fs.mkdir(directory,{recursive:true});
    for (const target of widths) {
      const file = target+'.webp', temporary = path.join(directory,randomUUID()+'.webp');
      try {
        // Lossless PNG derivatives retain transparency, lettering and fine lines.
        const info = await sharp(input).autoOrient().resize({width:target,withoutEnlargement:true})
          .webp(metadata.format==='png' ? {lossless:true} : {quality:settings.quality}).toFile(temporary);
        await fs.rename(temporary,path.join(directory,file));
        result.variants.push({file,width:info.width,height:info.height,bytes:info.size});
      } finally { await fs.rm(temporary,{force:true}); }
    }
    const temporary = path.join(directory,randomUUID()+'.json');
    await fs.writeFile(temporary,JSON.stringify(result));
    await fs.rename(temporary,marker);
  }
  return {...result,key,directory};
}

// Original exports are never rewritten. Every generated asset is an ordinary
// snapshot entry, so uploads, deduplication, retention and rollback work as usual.
export async function prepareImages(store,cacheDir,options={},entries=store.entries,onProgress=()=>{}) {
  const settings = {...IMAGE_DEFAULTS,...options};
  if (!Number.isInteger(settings.maxSize) || settings.maxSize<1 || !Number.isInteger(settings.quality) || settings.quality<1 || settings.quality>100) throw new Error('Invalid image variant settings');
  const stats = {images:0,variants:0,sourceBytes:0,variantBytes:0};
  for (const entry of [...entries]) {
    if (entry.note || entry.generatedMapTile || entry.generatedImageVariant || !formats.has(entry.extension)) continue;
    const taskKey = JSON.stringify([entry.filename,cacheDir,settings]);
    let task = pending.get(taskKey);
    if (!task) {
      task = variants(entry,cacheDir,settings);pending.set(taskKey,task);
      task.finally(()=>pending.delete(taskKey)).catch(()=>{});
    }
    let result;
    try { result = await task; }
    catch (error) {
      // An undecodable source still has its original URL and browser fallback.
      if (!/unsupported image format|corrupt|invalid.*header|bad.*header|premature end/i.test(error.message)) throw error;
      const warning = 'Image variants omitted for undecodable image: '+entry.id;
      if (!store.warnings.includes(warning)) store.warnings.push(warning);
      continue;
    }
    if (!result) continue;
    const {width,height,key,directory} = result;
    // Resampling line art can add colours and cost more than a sharper copy.
    // Keep the cheapest choices without removing the inline/screen boundary.
    const efficient = result.variants.filter((item,index)=>!result.variants.slice(index+1).some(next=>
      (next.width<=1440)===(item.width<=1440) && next.bytes<=item.bytes));
    const images = efficient.map(({file,width,height,bytes})=>{
      const target = 'image-variants/'+key+'/'+file;
      if (!store.assets.has(target)) {
        const asset = {id:target,target,filename:path.join(directory,file),extension:'.webp',note:null,generatedImageVariant:true};
        store.assets.set(target,asset);store.entries.push(asset);
      }
      return {url:'/assets/'+target,width,height,bytes};
    });
    entry.image = {width,height,variants:images};
    stats.images++;stats.variants+=images.length;stats.sourceBytes+=result.sourceBytes;
    stats.variantBytes+=images.reduce((sum,item)=>sum+item.bytes,0);
    onProgress({...stats,currentFile:entry.id});
  }
  return stats;
}
