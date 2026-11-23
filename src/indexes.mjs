import {parse} from 'yaml';
import {createHeaderContext, HeaderDataError} from './header-core/index.mjs';
import {getPageType, pageTypes} from './header-core/metadata.mjs';
import {indexTableColumns, validateIndexTableOptions} from './index-columns.mjs';

const keys = new Set(['type','from','via','target','recursive','scope','where','show','mode','heading','columns','sortBy']);
const scalar = value => typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);
const mapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = new Intl.Collator('en', {sensitivity:'base', numeric:true}).compare;
const known = date => Number.isFinite(date?.sort) && !date.isHiddenDate;
const day = sort => ({sort,days:sort,isNormalizedDate:true});
const reference = text => typeof text === 'string' ? text.trim().replace(/^\[\[|\]\]$/g,'').split('|')[0].split('#')[0] : '';
const hasLocation = record => reference(record?.location) && reference(record.location).toLowerCase() !== 'unknown';

function validate(options) {
  if (!mapping(options)) throw new Error('Use a YAML mapping for a whereabouts index.');
  for (const key of Object.keys(options)) if (!keys.has(key)) throw new Error('Unknown index option: ' + key);
  if (options.type !== 'whereabouts') throw new Error('type must be whereabouts.');
  if (!pageTypes.includes(options.from)) throw new Error('from must be one of: ' + pageTypes.join(', '));
  if (!['home','current','lastKnown'].includes(options.via)) throw new Error('via must be home, current, or lastKnown.');
  for (const [key, choices] of Object.entries({scope:['current','historical','ever'], show:['both','obsidian','website'], mode:['grid','table']})) {
    if (options[key] !== undefined && !choices.includes(options[key])) throw new Error(key + ' must be one of: ' + choices.join(', '));
  }
  for (const key of ['recursive','heading']) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new Error(key + ' must be true or false.');
  }
  if (options.target !== undefined && (typeof options.target !== 'string' || !options.target.trim())) throw new Error('target must be a note name or path.');
  if (options.where !== undefined) {
    if (!mapping(options.where)) throw new Error('where must be a mapping of frontmatter fields.');
    for (const [field,value] of Object.entries(options.where)) {
      const values = Array.isArray(value) ? value : [value];
      if (!field || !values.length || !values.every(scalar)) throw new Error('where requires scalar values or nonempty lists of scalars.');
    }
  }
  validateIndexTableOptions(options);
}

export function parseIndex(source) {
  const options = parse(source,{maxAliasCount:20});
  validate(options);
  return {recursive:true, scope:'current', show:'both', mode:'grid', heading:true, ...options};
}

const indexes = new WeakMap();
function pagesFor(snapshot) {
  if (indexes.has(snapshot)) return indexes.get(snapshot);
  const byPath = new Map(), byType = new Map(pageTypes.map(type => [type, []]));
  for (const page of snapshot.pages) {
    byPath.set(page.path, page);
    byType.get(getPageType(page.metadata))?.push(page);
  }
  const pages = {byPath, byType};
  indexes.set(snapshot, pages);
  return pages;
}

// Probe the last day in each interval of constant whereabouts. Include changes
// on ancestors as well as on the subject so an entire chain represents one day.
function boundaryDays(records, first, last) {
  const days = new Set([last]);
  for (const record of records) {
    for (const boundary of [record.logicalStart.sort - 1, record.logicalEnd.sort, record.awayEnd.sort]) {
      if (first <= boundary && boundary < last) days.add(boundary);
    }
  }
  return [...days].sort((a,b) => b-a);
}

export function queryIndex(snapshot, options, {date, sourcePath, resolve, visible = () => true} = {}) {
  validate(options);
  const {from, via, scope = 'current', recursive = true, where = {}, columns, sortBy} = options;
  const {dates,names,locations,templates} = createHeaderContext(snapshot,{date});
  const at = dates.normalizeDate(date);
  const {byPath,byType} = pagesFor(snapshot);
  const lookups = new Map(), records = new WeakMap(), dated = new WeakMap();
  function lookup(value, source) {
    const ref = reference(value);
    if (!ref) return undefined;
    let cache = lookups.get(source);
    if (!cache) lookups.set(source, cache = new Map());
    if (!cache.has(ref)) {
      const page = resolve ? resolve(ref,source) : byPath.get(names.getFileForTarget(ref)?.path);
      cache.set(ref, page && visible(page) ? page : undefined);
    }
    return cache.get(ref);
  }
  const target = options.target ? lookup(options.target,sourcePath) : byPath.get(sourcePath);
  if (!target || !visible(target)) throw new Error('The index target is unavailable.');
  function recordsFor(page) {
    if (!records.has(page.metadata)) records.set(page.metadata,locations.getWhereaboutsList(page.metadata));
    return records.get(page.metadata);
  }
  function whereabouts(page, when) {
    let cache = dated.get(page.metadata);
    if (!cache) dated.set(page.metadata, cache = new Map());
    if (!cache.has(when.sort)) cache.set(when.sort,locations.getWhereabouts(page.metadata,when,recordsFor(page)));
    return cache.get(when.sort);
  }
  function matchesOn(page, when, first) {
    let wb = whereabouts(page,when);
    // A last-known sighting belongs to its original day, including secondary
    // geography and every containing location. A container can move later.
    if (via === 'lastKnown' && !hasLocation(wb.current)) {
      for (const sort of boundaryDays(recordsFor(page),first,when.sort)) {
        const prior = whereabouts(page,day(sort));
        if (hasLocation(prior.current)) {
          when = day(sort);
          wb = prior;
          break;
        }
      }
    }
    let cycle;
    function visit(record, source, ancestors) {
      if (!hasLocation(record)) return false;
      const parent = lookup(record.location,source);
      if (!parent) return false;
      if (parent.path === target.path) return true;
      if (!recursive) return false;
      if (ancestors.has(parent.path)) { cycle = true; return false; }
      ancestors.add(parent.path);
      const next = whereabouts(parent,when);
      const hit = visit(next.current,parent.path,ancestors) || visit(next.secondary,parent.path,ancestors);
      ancestors.delete(parent.path);
      return hit;
    }
    const ancestors = new Set([page.path]);
    const found = via === 'home' ? visit(wb.home,page.path,ancestors) :
      visit(wb.current,page.path,ancestors) || visit(wb.secondary,page.path,ancestors);
    if (!found && cycle) throw new HeaderDataError('location',[page.path]);
    return found ? when : undefined;
  }
  function matchDate(page, first, last) {
    if (scope !== 'ever') return matchesOn(page,last,first);
    const pending = [page], seen = new Set(), history = [];
    while (pending.length) {
      const ancestor = pending.pop();
      if (seen.has(ancestor.path)) continue;
      seen.add(ancestor.path);
      for (const record of recordsFor(ancestor)) {
        history.push(record);
        if (recursive) {
          const parent = lookup(record.location,ancestor.path);
          if (parent && parent.path !== target.path && !seen.has(parent.path)) pending.push(parent);
        }
      }
    }
    let cycle;
    for (const sort of boundaryDays(history,first,last.sort)) {
      try {
        const matched = matchesOn(page,day(sort),first);
        if (matched) return matched;
      } catch (error) {
        if (!(error instanceof HeaderDataError)) throw error;
        cycle = error;
      }
    }
    if (cycle) throw cycle;
  }

  const fields = new Set([...indexTableColumns(from,columns), ...(sortBy || [])]);
  const filters = Object.entries(where);
  const items = [], warnings = new Set(), sortKeys = new WeakMap();
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
  for (const page of byType.get(from)) {
    const metadata = page.metadata;
    if (!visible(page) || page.path === target.path || !filters.every(([key,value]) =>
      Object.hasOwn(metadata,key) && (Array.isArray(value) ? value.includes(metadata[key]) : metadata[key] === value))) continue;
    try {
      const life = dates.getPageDates(metadata,at);
      const first = known(life.startDate) ? life.startDate.sort : -Infinity;
      const ended = known(life.endDate) && life.endDate.sort < at.sort;
      if (first > at.sort || (ended && (scope === 'current' || life.endDate.sort < first))) continue;
      const matched = matchDate(page,first,ended ? life.endDate : at);
      if (!matched) continue;
      const format = template => templates.formatDisplayString(template,{name:page.name,frontmatter:metadata},at);
      const item = {path:page.path,name:format('<name:n>'),type:format('<maintype:n>'),
        imageTarget:metadata.image, pronunciation:metadata.pronunciation};
      const keys = {};
      if (from === 'person') {
        item.person = formattedParts(format('<name> (<pronouns> <pronunciation>)'),page.path);
        item.info = formattedParts(format('<ancestry> <maintype>'),page.path);
      }
      if (fields.has('home')) item.home = formattedParts(format('<home:1>'),page.path);
      if (fields.has('currentLocation')) {
        const current = whereabouts(page,at).current;
        item.currentLocation = !ended && hasLocation(current) && lookup(current.location,page.path) ?
          formattedParts(format('<current:2>'),page.path) : [];
      }
      if (fields.has('region')) {
        const home = whereabouts(page,matched).home, region = lookup(home.location,page.path);
        if (region) item.region = {path:region.path,name:names.getNameObject(region.path).name || region.name};
      }
      if (fields.has('population') && metadata.population != null) {
        item.population = metadata.population === 0 ? '0' : format('<population>');
        const number = Number(metadata.population);
        if (String(metadata.population).trim() && Number.isFinite(number)) keys.population = number;
      }
      for (const field of ['born','died','created','destroyed']) {
        if (!fields.has(field)) continue;
        const value = dates.normalizeDate(metadata[field],field === 'died' || field === 'destroyed');
        if (known(value) && value.sort <= at.sort) { item[field] = value.display; keys[field] = value.sort; }
      }
      sortKeys.set(item,keys);
      items.push(item);
    } catch (error) {
      if (!(error instanceof HeaderDataError)) throw error;
      warnings.add('Some pages were omitted because their relationship metadata contains a cycle.');
    }
  }
  function sortValue(item, key) {
    const value = item[key];
    if (key === 'population' || Object.hasOwn(sortKeys.get(item),key)) return sortKeys.get(item)[key];
    if (Array.isArray(value)) return value.map(part => typeof part === 'string' ? part : part.name).join('') || undefined;
    return value?.name || value || undefined;
  }
  items.sort((a,b) => {
    for (const key of sortBy || (from === 'place' ? ['type'] : [])) {
      const left = sortValue(a,key), right = sortValue(b,key);
      const order = left == null || right == null ? Number(left == null)-Number(right == null) :
        typeof left === 'number' && typeof right === 'number' ? left-right : compare(left,right);
      if (order) return order;
    }
    return compare(a.name,b.name) || a.path.localeCompare(b.path,'en');
  });
  const label = {person:'People',place:'Places',object:'Objects',event:'Events',group:'Groups',power:'Powers',ancestry:'Ancestries',creature:'Creatures'}[from];
  return {from,label:(scope === 'historical' ? 'Historical ' : scope === 'ever' ? 'All-time ' : '') + label,
    target:names.getNameObject(target.path).name || target.name, items,warnings:[...warnings],columns};
}
