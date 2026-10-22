import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {IMAGE_DEFAULTS,IMAGE_VERSION,animatedPNG} from './optimize-images.mjs';
import {collectImageUsages} from './image-usage.mjs';

const formats = new Set(['.png','.jpg','.jpeg','.webp']);
const pending = new Map();
// Bound simultaneous decodes as well as job count. An unusually large image
// takes the whole budget and runs alone; variants of each image stay serial.
const pixelBudget = 32_000_000;
let activePixels = 0;
const encodingQueue = [];
function drainEncoders() {
  while (encodingQueue.length && activePixels+encodingQueue[0].pixels<=pixelBudget) {
    const next=encodingQueue.shift();activePixels+=next.pixels;next.start();
  }
}
async function encodeImage(pixels,action) {
  if (!Number.isSafeInteger(pixels) || pixels<1) throw new Error('Invalid image dimensions');
  pixels=Math.min(pixelBudget,pixels);
  await new Promise(start=>{encodingQueue.push({pixels,start});drainEncoders();});
  try{return await action();}
  finally{activePixels-=pixels;drainEncoders();}
}

export function usedImageWidths(width,height,usages,maxSize=IMAGE_DEFAULTS.maxSize) {
  const limit = Math.max(1,Math.min(width,Math.round(width*Math.min(1,maxSize/Math.max(width,height)))));
  const requested = usages.flatMap(bounds=>{
    const display = Math.max(...bounds.map(bound=>Math.min(bound.width || Infinity,(bound.height || Infinity)*width/height,width)));
    // Wide layouts also need a phone-sized choice. Fixed small images just
    // need their displayed width and a 2x copy for high-density screens.
    const bases = display>640 ? [360,display] : [display];
    const inlineLimit = display > 1440 ? 2560 : 1440;
    return bases.flatMap(base=>[base,base*2]).map(size=>Math.max(1,Math.min(inlineLimit,limit,Math.ceil(size))));
  });
  const inline = [];let groupStart;
  for (const size of [...new Set(requested)].sort((a,b)=>a-b)) {
    if (groupStart!==undefined && size<=groupStart*1.25) inline[inline.length-1] = size;
    else {inline.push(size);groupStart=size;}
  }
  return [...new Set([...inline,limit])].sort((a,b)=>a-b).map(width=>({width,inline:inline.includes(width)}));
}

async function variants(entry,cacheDir,settings,usages,derivativeCache) {
  const input = await fs.readFile(entry.filename), metadata = await sharp(input).metadata();
  if ((metadata.pages || 1)>1 || animatedPNG(input)) return null;
  const rotated = metadata.orientation>=5 && metadata.orientation<=8;
  const width = rotated ? metadata.height : metadata.width, height = rotated ? metadata.width : metadata.height;
  const widths = usedImageWidths(width,height,usages,settings.maxSize);
  const sourceHash = createHash('sha256').update(input).digest('hex');
  // Maintenance: bump this recipe version whenever the generation algorithm,
  // output format, or compression logic changes (including shared helpers).
  // Code changes and --force trigger publication but do not bypass this cache.
  const key = createHash('sha256').update(JSON.stringify({version:3,widths,sourceHash,...settings,...IMAGE_VERSION})).digest('hex');
  const directory = path.join(cacheDir,key), marker = path.join(directory,'complete.json');
  const remote=derivativeCache?.get('images',key,({data,outputs})=>
    data?.width===width && data.height===height && data.sourceBytes===input.length && Array.isArray(data.variants) &&
    data.variants.length===outputs.length && data.variants.every((item,index)=>item &&
      widths.some(plan=>plan.width===item.width && plan.inline===item.inline) && item.file===item.width+'.webp' &&
      Number.isSafeInteger(item.height) && item.height>0 && item.height<=height &&
      outputs[index].target==='image-variants/'+key+'/'+item.file && outputs[index].size===item.bytes));
  if(remote)return {...remote.data,key,directory,cache:'remote',remoteOutputs:new Map(remote.outputs.map(o=>[o.target,o]))};
  // Different vault paths can contain identical bytes. Share a recipe build
  // so parallel workers never race to replace the same cache files.
  const pendingKey=path.resolve(directory),existing=pending.get(pendingKey);
  if(existing)return {...await existing,cache:'local'};
  const task=(async()=>{
    let result,cache='local';
    try {
      result = JSON.parse(await fs.readFile(marker,'utf8'));
      await Promise.all(result.variants.map(item=>fs.access(path.join(directory,item.file))));
    } catch { result = undefined; }
    if (!result) {
      cache='generated';
      await encodeImage(metadata.width*metadata.height,async()=>{
        result = {width,height,sourceBytes:input.length,variants:[]};
        await fs.mkdir(directory,{recursive:true});
        for (const {width:target,inline} of widths) {
          const file = target+'.webp', temporary = path.join(directory,randomUUID()+'.webp');
          try {
            // Lossless PNG derivatives retain transparency, lettering and fine lines.
            const info = await sharp(input).autoOrient().resize({width:target,withoutEnlargement:true})
              .webp(metadata.format==='png' ? {lossless:true} : {quality:settings.quality}).toFile(temporary);
            await fs.rename(temporary,path.join(directory,file));
            result.variants.push({file,width:info.width,height:info.height,bytes:info.size,inline});
          } finally { await fs.rm(temporary,{force:true}); }
        }
        const temporary = path.join(directory,randomUUID()+'.json');
        await fs.writeFile(temporary,JSON.stringify(result));
        await fs.rename(temporary,marker);
      });
    }
    return {...result,key,directory,cache};
  })();
  pending.set(pendingKey,task);
  try{return await task;}
  finally{pending.delete(pendingKey);}
}

// Original exports are never rewritten. Every generated asset is an ordinary
// snapshot entry, so uploads, deduplication, retention and rollback work as usual.
export async function prepareImages(store,cacheDir,options={},entries=store.entries,onProgress=()=>{},derivativeCache) {
  const {usages=collectImageUsages(store),concurrency=3,...imageOptions} = options;
  const settings = {...IMAGE_DEFAULTS,...imageOptions};
  if (!Number.isInteger(settings.maxSize) || settings.maxSize<1 || !Number.isInteger(settings.quality) || settings.quality<1 || settings.quality>100) throw new Error('Invalid image variant settings');
  if (!Number.isInteger(concurrency) || concurrency<1 || concurrency>4) throw new Error('Image concurrency must be between 1 and 4');
  const jobs=[...entries].filter(entry=>!entry.note && !entry.generatedMapTile && !entry.generatedImageVariant && formats.has(entry.extension) && usages.get(entry.id)?.length);
  const stats = {images:0,variants:0,sourceBytes:0,variantBytes:0,total:jobs.length,processed:0,generated:0,reusedLocal:0,reusedRemote:0,skipped:0};
  const results=new Array(jobs.length),started=performance.now();
  let next=0,failure;
  // Drain in-flight jobs on failure before the caller releases its publish lock.
  await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},async()=>{
    while(!failure && next<jobs.length){
      const index=next++,entry=jobs[index];let result;
      try {
        result=await variants(entry,cacheDir,settings,usages.get(entry.id),derivativeCache);
      } catch (error) {
        // An undecodable source still has its original URL and browser fallback.
        if (!/unsupported image format|corrupt|invalid.*header|bad.*header|premature end/i.test(error.message)) {failure ??=error;break;}
        results[index]={warning:'Image variants omitted for undecodable image: '+entry.id};
      }
      if(result){
        // Omit variants dominated by a sharper, cheaper copy in the same group.
        const efficient=result.variants.filter((item,index)=>!result.variants.slice(index+1).some(next=>next.inline===item.inline && next.bytes<=item.bytes));
        results[index]={result,efficient};
        stats.images++;stats.variants+=efficient.length;stats.sourceBytes+=result.sourceBytes;
        stats.variantBytes+=efficient.reduce((sum,item)=>sum+item.bytes,0);
        stats[result.cache==='remote'?'reusedRemote':result.cache==='local'?'reusedLocal':'generated']++;
      }else stats.skipped++;
      stats.processed++;
      try{onProgress({...stats,currentFile:entry.id,elapsedMs:performance.now()-started});}
      catch(error){failure ??=error;}
    }
  }));
  if(failure)throw failure;
  // Commit in source order, independent of completion order. This preserves
  // snapshot hashes and numeric page/asset IDs across cached and fresh builds.
  for(const [index,entry] of jobs.entries()){
    const {result,efficient,warning}=results[index] || {};
    if(warning && !store.warnings.includes(warning))store.warnings.push(warning);
    if(!result)continue;
    const {width,height,key,directory} = result;
    const images = efficient.map(({file,width,height,bytes,inline})=>{
      const target = 'image-variants/'+key+'/'+file;
      if (!store.assets.has(target)) {
        const asset = {id:target,target,filename:path.join(directory,file),extension:'.webp',note:null,generatedImageVariant:true};
        if(result.remoteOutputs)asset.remoteAsset=result.remoteOutputs.get(target);
        store.assets.set(target,asset);store.entries.push(asset);
      }
      return {url:'/assets/'+target,width,height,bytes,inline};
    });
    entry.image = {width,height,variants:images};
    derivativeCache?.record('images',key,{width,height,sourceBytes:result.sourceBytes,variants:efficient},images.map(image=>image.url.slice('/assets/'.length)));
  }
  return stats;
}
