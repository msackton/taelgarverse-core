import {load} from 'cheerio';

export const imageUrl = entry=>'/assets/'+entry.target.split('/').map(encodeURIComponent).join('/');

// 2000px shell minus two 32px gutters; standalone maps/media have no sidebars.
const expandedWidth = 1936;
const expandedImage = (image,{wide=false}={})=>image.is('.taelgar-image--hero') ||
  image.closest('.taelgar-image--hero,.taelgar-image-gallery,.admonition.gallery,details.gallery').length > 0 ||
  (wide && !image.attr('align') && !image.closest('.taelgar-image--aside,.image.inline').length &&
    (image.parent().is('figure') || (image.closest('p').length > 0 && !image.closest('p').text().trim())));

// Match the site's rem-based image roles (the Material root is 20px), table
// limits, and mobile overrides. Bounds in one usage describe its widest layout.
export function imageDisplayBounds(image,options) {
  const inClass = name=>image.hasClass(name) || image.closest('.'+name).length;
  if (image.closest('table').length) return [{width:90,height:90}];
  const size = ['small','large'].find(size=>inClass('taelgar-image--size-'+size)) || 'standard';
  const aside = inClass('taelgar-image--aside'), figure = inClass('taelgar-image--figure');
  const width = Number(image.attr('width')), height = Number(image.attr('height'));
  const bounds = [{width:aside ? {small:250,standard:400,large:520}[size]
    : figure ? {small:480,standard:720,large:960}[size] : expandedImage(image,options) ? expandedWidth : width || (height ? undefined : 900),
    ...(!aside && !figure && height ? {height} : {})}];
  if (aside || image.attr('align')) bounds.push({width:764,height:480});
  else if (image.closest('.admonition.image.inline,details.image.inline').length) {
    bounds[0].width = Math.min(bounds[0].width,234);
    bounds.push({width:width || 764,...(height ? {height} : {})});
  }
  return bounds;
}

export function collectHtmlImageUsages(store,html,usages=new Map(),options) {
  const $ = load(html,{},false);
  $('img[src^="/assets/"]').each((_,element)=>{
    const image = $(element);
    if (image.attr('srcset') || image.closest('.twemoji,.leaflet-map,.leaflet-container').length) return;
    let target;
    try { target = decodeURIComponent(image.attr('src').split(/[?#]/)[0].slice(8)); } catch { return; }
    const entry = store.assets.get(target);
    if (!entry || entry.generatedImageVariant || entry.generatedMapTile) return;
    const bounds = imageDisplayBounds(image,options), found = usages.get(entry.id) || [];
    if (!found.some(item=>JSON.stringify(item)===JSON.stringify(bounds))) found.push(bounds);
    usages.set(entry.id,found);
  });
  return usages;
}

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

function imageSizes(image,options) {
  const inClass = name=>image.hasClass(name) || image.closest('.'+name).length;
  if (image.closest('table').length) return '(max-width: 719px) 3.25rem, 4.5rem';
  const size = ['small','large'].find(size=>inClass('taelgar-image--size-'+size)) || 'standard';
  const aside = inClass('taelgar-image--aside'), figure = inClass('taelgar-image--figure');
  const authored = Number(image.attr('width'));
  const width = aside ? {small:'12.5rem',standard:'20rem',large:'26rem'}[size] : figure ? {small:'24rem',standard:'36rem',large:'48rem'}[size] : expandedImage(image,options) ? expandedWidth+'px' : (authored || 900)+'px';
  if (expandedImage(image,options)) return '(max-width: 800px) calc(100vw - 36px), (max-width: 1100px) calc(100vw - 48px), min(calc(100vw - 64px), '+width+')';
  return '(max-width: 800px) min(calc(100vw - 40px), '+width+'), min('+width+', 100vw)';
}

function imageCaption(image) {
  const host = image.closest('figure,.admonition.image,details.image,.admonition.gallery li,details.gallery li');
  // A gallery caption belongs to its item, never to a neighbouring image.
  if (!host.length || host.find('img').length !== 1) return '';
  const caption = (host.is('figure') ? host.children('figcaption').first() : host).clone();
  caption.find('.admonition-title,summary,img,script,style,button,[hidden],[popover],.dm-note-ref').remove();
  caption.find('br').replaceWith(' ');
  caption.find('p,li').append(' ');
  return caption.text().replace(/\s+/g,' ').trim();
}

// Run after embeds and generated headers have been included. It covers both
// Markdown images and authored HTML without requiring changes to vault notes.
export function responsiveImages(html,store,options) {
  const $ = load(html,{},false);
  let lead = true;
  $('img[src]').each((_,element)=>{
    const image = $(element);
    if (image.closest('.twemoji,.leaflet-map,.leaflet-container').length) return;
    const caption = imageCaption(image);
    if (caption && !image.attr('data-image-caption')) image.attr('data-image-caption',caption);
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
    image.attr('sizes',image.attr('sizes') || (image.attr('loading')==='lazy' ? 'auto, ' : '')+imageSizes(image,options));
    // Retain authored layout dimensions, and supply the missing aspect ratio.
    if (!authoredWidth) image.attr('width',String(authoredHeight ? Math.round(authoredHeight*info.width/info.height) : info.width));
    if (!authoredHeight) image.attr('height',String(authoredWidth ? Math.round(authoredWidth*info.height/info.width) : info.height));
    const inline = info.variants.filter(item=>item.inline===true || (item.inline===undefined && item.width<=1440));
    const candidates = inline.length ? inline : info.variants.slice(0,1);
    image.attr('src',candidates.find(item=>item.width>=320)?.url || candidates.at(-1).url);
    image.attr('srcset',candidates.map(item=>item.url+' '+item.width+'w').join(', '));
    image.attr('data-image-full',imageUrl(entry));
    image.attr('data-image-width',String(info.width));image.attr('data-image-height',String(info.height));
    image.attr('data-image-variants',JSON.stringify(info.variants));
  });
  return $.html();
}
