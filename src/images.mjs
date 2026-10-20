import {load} from 'cheerio';

export const imageUrl = entry=>'/assets/'+entry.target.split('/').map(encodeURIComponent).join('/');

export function imageEntries(store,html) {
  const $ = load(html,{},false), entries = new Set();
  $('img[src^="/assets/"]').each((_,element)=>{
    let target;
    try { target = decodeURIComponent($(element).attr('src').split(/[?#]/)[0].slice(8)); } catch { return; }
    const entry = store.assets.get(target);
    if (entry && !entry.image && !entry.generatedImageVariant && !entry.generatedMapTile) entries.add(entry);
  });
  return [...entries];
}

function imageSizes(image) {
  const inClass = name=>image.hasClass(name) || image.closest('.'+name).length;
  if (image.closest('table').length) return '(max-width: 719px) 3.25rem, 4.5rem';
  const size = ['small','large'].find(size=>inClass('taelgar-image--size-'+size)) || 'standard';
  const aside = inClass('taelgar-image--aside'), figure = inClass('taelgar-image--figure');
  const authored = Number(image.attr('width'));
  const width = aside ? {small:'12.5rem',standard:'20rem',large:'26rem'}[size] : figure ? {small:'24rem',standard:'36rem',large:'48rem'}[size] : (authored || 1040)+'px';
  return '(max-width: 800px) min(calc(100vw - 40px), '+width+'), min('+width+', 100vw)';
}

// Run after embeds and generated headers have been included. It covers both
// Markdown images and authored HTML without requiring changes to vault notes.
export function responsiveImages(html,store) {
  const $ = load(html,{},false);
  let lead = true;
  $('img[src]').each((_,element)=>{
    const image = $(element);
    if (image.closest('.twemoji,.leaflet-map,.leaflet-container').length) return;
    const hidden = image.closest('[hidden],[popover],details:not([open])').length>0;
    if (!image.attr('loading')) image.attr('loading',lead && !hidden ? 'eager' : 'lazy');
    if (!image.attr('decoding')) image.attr('decoding','async');
    if (!hidden) lead = false;
    const raw = image.attr('src');
    if (!raw.startsWith('/assets/')) return;
    let target;
    try { target = decodeURIComponent(raw.split(/[?#]/)[0].slice(8)); } catch { return; }
    const entry = store.assets.get(target), info = entry?.image;
    if (!info?.variants?.length || image.attr('srcset')) return;
    const authoredWidth = Number(image.attr('width')), authoredHeight = Number(image.attr('height'));
    image.attr('sizes',image.attr('sizes') || (image.attr('loading')==='lazy' ? 'auto, ' : '')+imageSizes(image));
    // Retain authored layout dimensions, and supply the missing aspect ratio.
    if (!authoredWidth) image.attr('width',String(authoredHeight ? Math.round(authoredHeight*info.width/info.height) : info.width));
    if (!authoredHeight) image.attr('height',String(authoredWidth ? Math.round(authoredWidth*info.height/info.width) : info.height));
    const inline = info.variants.filter(item=>item.width<=1440);
    const candidates = inline.length ? inline : info.variants.slice(0,1);
    image.attr('src',candidates.find(item=>item.width>=320)?.url || candidates.at(-1).url);
    image.attr('srcset',candidates.map(item=>item.url+' '+item.width+'w').join(', '));
    image.attr('data-image-full',imageUrl(entry));
    image.attr('data-image-width',String(info.width));image.attr('data-image-height',String(info.height));
    image.attr('data-image-variants',JSON.stringify(info.variants));
  });
  return $.html();
}
