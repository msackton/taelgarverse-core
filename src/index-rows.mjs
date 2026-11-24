import {getPageType} from './header-core/metadata.mjs';

export const indexReference = text => typeof text === 'string' ? text.trim().replace(/^\[\[|\]\]$/g,'').split('|')[0].split('#')[0] : '';
export const hasLocation = record => indexReference(record?.location) && indexReference(record.location).toLowerCase() !== 'unknown';
export const knownDate = date => Number.isFinite(date?.sort) && !date.isHiddenDate;

const compare = new Intl.Collator('en', {sensitivity:'base', numeric:true}).compare;
const statusOrder = ['Stub','Needs work','Check','Lint','AI review','Updates pending','Complete'];

function noteStatus(rawTags) {
  const tags = typeof rawTags === 'string' ? rawTags.split(/[,\s]+/) : Array.isArray(rawTags) ? rawTags : [];
  const statusTags = new Set(tags.filter(tag => typeof tag === 'string')
    .map(tag => tag.trim().replace(/^#/, '').toLowerCase())
    .filter(tag => tag.startsWith('status/')));
  if (!statusTags.size) return 'Complete';
  if (statusTags.has('status/stub')) return 'Stub';
  if (statusTags.has('status/check/ai')) return 'AI review';
  if (statusTags.size === 1 && statusTags.has('status/check/lint')) return 'Lint';

  let needsCheck = false;
  for (const tag of statusTags) {
    if (tag === 'status/check/lint' || tag === 'status/gameupdate' || tag.startsWith('status/gameupdate/')) continue;
    if (tag === 'status/check/errors' || tag.startsWith('status/check/errors/')) return 'Needs work';
    if (tag !== 'status/check' && !tag.startsWith('status/check/')) return 'Needs work';
    needsCheck = true;
  }
  return needsCheck ? 'Check' : 'Updates pending';
}

// Both queries provide the location lookup so formatted links inherit host visibility.
export function createIndexRows({dates,names,templates}, at, {fields,lookup,whereabouts,kinds}) {
  const items = [], sortKeys = new WeakMap();

  function formattedParts(text, source) {
    const parts = [];
    let end = 0;
    for (const match of text.matchAll(/\[\[([^\[\]\n]+)\]\]/g)) {
      if (match.index > end) parts.push(text.slice(end,match.index));
      const [ref,...alias] = match[1].split('|'), page = lookup(ref,source);
      parts.push(page ? {path:page.path,name:alias.join('|') || ref} : 'Unknown');
      end = match.index + match[0].length;
    }
    if (end < text.length) parts.push(text.slice(end));
    return parts;
  }

  function add(page, {life,matched = at,affiliation} = {}) {
    const metadata = page.metadata, kind = getPageType(metadata);
    life ??= dates.getPageDates(metadata,at);
    const ended = knownDate(life.endDate) && life.endDate.sort < at.sort;
    const until = ended ? life.endDate : at;
    const format = (template,when = at) => templates.formatDisplayString(template,{name:page.name,frontmatter:metadata},when);
    const parts = (template,when) => formattedParts(format(template,when),page.path);
    const item = {path:page.path,name:format('<name:n>'),type:format('<maintype:n>'),
      imageTarget:metadata.image,pronunciation:metadata.pronunciation};
    const keys = {};
    if (kind === 'person') {
      item.person = parts('<name> (<pronouns> <pronunciation>)');
      item.info = parts('<ancestry> <maintype>');
      if (fields.has('alive')) item.alive = life.isAlive;
    } else if (fields.has('info')) {
      item.info = item.type;
    }
    if (kinds) {
      item.kind = kind;
      keys.kind = kinds.indexOf(kind);
    }
    if (fields.has('status')) {
      item.status = noteStatus(metadata.tags);
      keys.status = statusOrder.indexOf(item.status);
    }
    if (fields.has('home')) item.home = parts('<home:1>');
    if (fields.has('origin') && hasLocation(whereabouts(page,at).origin)) item.origin = parts('<origin:1>');
    if (fields.has('currentLocation') || fields.has('lastKnown')) {
      const current = whereabouts(page,at).current;
      const currentParts = !ended && hasLocation(current) && lookup(current.location,page.path) ? parts('<current:2>') : [];
      if (fields.has('currentLocation')) item.currentLocation = currentParts;
      if (fields.has('lastKnown')) {
        const last = whereabouts(page,until).lastKnown;
        if (currentParts.length) item.lastKnown = currentParts;
        else if (hasLocation(last) && lookup(last.location,page.path)) {
          const sighting = knownDate(last.awayEnd) && last.awayEnd.sort <= until.sort ? last.awayEnd : ended ? until : null;
          item.lastKnown = parts('<lastknown:2>',until);
          if (sighting && item.lastKnown.length) item.lastKnown.push(' ('+sighting.display+')');
        }
      }
    }
    if (fields.has('region') && kind === 'place') {
      const home = whereabouts(page,matched).home, region = lookup(home.location,page.path);
      if (region) item.region = {path:region.path,name:names.getNameObject(region.path).name || region.name};
    }
    if (fields.has('population') && kind === 'place' && metadata.population != null) {
      item.population = metadata.population === 0 ? '0' : format('<population>');
      const number = Number(metadata.population);
      if (String(metadata.population).trim() && Number.isFinite(number)) keys.population = number;
    }
    if (affiliation && fields.has('roles')) item.roles = affiliation.roles.join(' · ');
    if (affiliation) {
      for (const [key,value] of [['joined',affiliation.term.startDate], ['left',affiliation.term.explicitEndDate]]) {
        if (fields.has(key) && knownDate(value) && value.sort <= until.sort) {
          item[key] = value.display;
          keys[key] = value.sort;
        }
      }
    }
    for (const field of kind === 'person' ? ['born','died'] : ['created','destroyed']) {
      if (!fields.has(field)) continue;
      const value = dates.normalizeDate(metadata[field],field === 'died' || field === 'destroyed');
      if (knownDate(value) && value.sort <= at.sort) { item[field] = value.display; keys[field] = value.sort; }
    }
    sortKeys.set(item,keys);
    items.push(item);
  }

  function sortValue(item, key) {
    const value = item[key], keys = sortKeys.get(item);
    if (key === 'population' || Object.hasOwn(keys,key)) return keys[key];
    if (Array.isArray(value)) return value.map(part => typeof part === 'string' ? part : part.name).join('') || undefined;
    if (typeof value === 'boolean') return Number(value);
    return value?.name || value || undefined;
  }

  function sort(sortBy) {
    items.sort((a,b) => {
      for (const key of sortBy) {
        const left = sortValue(a,key), right = sortValue(b,key);
        const order = left == null || right == null ? Number(left == null)-Number(right == null) :
          typeof left === 'number' && typeof right === 'number' ? left-right : compare(left,right);
        if (order) return order;
      }
      return compare(a.name,b.name) || a.path.localeCompare(b.path,'en');
    });
    return items;
  }

  return {add,sort};
}
