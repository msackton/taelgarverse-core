import path from 'node:path';
import {parse} from 'yaml';
import MarkdownIt from 'markdown-it';
import {IMAGE_TYPES} from './content-store.mjs';
import {escapeHtml} from './common.mjs';
import {measurementOptions} from './map-distance.mjs';

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

export function parseMap(source, store, author) {
  // Obsidian's unquoted wikilinks look like nested YAML sequences. Keep the
  // image field literal, including the triple brackets used by Sembara.
  source = source.replace(/^(\s*image:\s*)(!?(?:\[{2,})[^\n]*?\]{2,})\s*$/gm,
    (_,prefix,image) => prefix + JSON.stringify(image));
  const data = parse(source, {maxAliasCount:0});
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a map definition');
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
    const {entry,config} = parseMap(source,env.store,env.entry);
    if(!config.measurement)env.warnings.push('Leaflet map: distance measurement disabled; verify image calibration, unit, and scale');
    const tile = entry.mapTiles?.find(tile => JSON.stringify(tile.bounds) === JSON.stringify(config.bounds));
    if (tile) config.tile = tile;
    const label = 'Map: ' + path.posix.basename(entry.id,path.posix.extname(entry.id)).replace(/[-_]/g,' ');
    return '<figure class="leaflet-map" data-map="' + escapeHtml(JSON.stringify(config)) + '">' +
      '<div class="map-canvas" hidden role="region" aria-label="' + escapeHtml(label) + '" style="--map-height:' + config.height + ';--map-width:' + config.width + '"></div>' +
      '<figcaption><span class="map-status" role="status">Interactive map requires JavaScript. </span>' +
      '<a href="' + escapeHtml(config.image) + '" target="_blank" rel="noopener">Open map image</a></figcaption></figure>\n';
  } catch (error) {
    env.warnings.push('Leaflet map: ' + error.message);
    return '<div class="admonition warning"><p class="admonition-title">Map unavailable</p><p>' + escapeHtml(error.message) + '</p></div>\n';
  }
}

export function mapImages(store) {
  const result = [], seen = new Set(), markdown = new MarkdownIt();
  for (const author of store.entries.filter(entry => entry.note)) {
    for (const token of markdown.parse(author.note.body,{})) {
      if (token.type !== 'fence' || !/^(?:taelgar-map|leaflet)(?:\s|$)/i.test(token.info.trim())) continue;
      try {
        const map = parseMap(token.content,store,author);
        map.entry.mapImage = true;
        const key = map.entry.id + JSON.stringify(map.config.bounds);
        if (!seen.has(key)) {seen.add(key);result.push(map);}
      } catch { /* The renderer reports invalid definitions on their article. */ }
    }
  }
  return result;
}
