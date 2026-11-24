import {parse} from 'yaml';
import {createHeaderContext, HeaderDataError} from './header-core/index.mjs';
import {getPageType, pageTypes} from './header-core/metadata.mjs';
import {TAELGAR_LOCATION} from './header-core/locations.mjs';
import {matchAffiliation} from './index-affiliations.mjs';
import {indexTableColumns, validateIndexTableOptions} from './index-columns.mjs';
import {createIndexRows, hasLocation, indexReference as reference, knownDate as known} from './index-rows.mjs';

const keys = new Set(['type','from','via','affiliationType','target','recursive','scope','where','show','mode','heading','columns','columnHeadings','sortBy']);
const scalar = value => typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);
const mapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const day = sort => ({sort,days:sort,isNormalizedDate:true});

function validate(options) {
  if (!mapping(options)) throw new Error('Use a YAML mapping for a taelgar-index.');
  for (const key of Object.keys(options)) if (!keys.has(key)) throw new Error('Unknown index option: ' + key);
  if (!['whereabouts','affiliation','catalog'].includes(options.type)) throw new Error('type must be whereabouts, affiliation, or catalog.');
  if (!pageTypes.includes(options.from)) throw new Error('from must be one of: ' + pageTypes.join(', '));
  if (options.type === 'whereabouts') {
    if (!['home','current','lastKnown'].includes(options.via)) throw new Error('via must be home, current, or lastKnown.');
  } else if (options.via !== undefined) {
    throw new Error('via requires type: whereabouts.');
  }
  if (options.affiliationType !== undefined) {
    if (options.type !== 'affiliation') throw new Error('affiliationType requires type: affiliation.');
    const kinds = [].concat(options.affiliationType);
    if (!kinds.length || kinds.some(kind => typeof kind !== 'string' || !kind.trim())) {
      throw new Error('affiliationType must be a nonempty string or a nonempty list of strings.');
    }
  }
  for (const [key, choices] of Object.entries({scope:['current','historical','ever'], show:['both','obsidian','website'], mode:['grid','table']})) {
    if (options[key] !== undefined && !choices.includes(options[key])) throw new Error(key + ' must be one of: ' + choices.join(', '));
  }
  if (options.recursive !== undefined && typeof options.recursive !== 'boolean') {
    throw new Error('recursive must be true or false.');
  }
  if (options.heading !== undefined && typeof options.heading !== 'boolean' &&
    (typeof options.heading !== 'string' || !options.heading.trim())) {
    throw new Error('heading must be true, false, or nonempty text.');
  }
  if (options.target !== undefined && (typeof options.target !== 'string' || !options.target.trim())) throw new Error('target must be a note name or path.');
  if (options.where !== undefined) {
    if (!mapping(options.where)) throw new Error('where must be a mapping of frontmatter fields.');
    for (const [field,value] of Object.entries(options.where)) {
      const values = Array.isArray(value) ? value : [value];
      if (!field || !values.length || !values.every(scalar)) throw new Error('where requires scalar values or nonempty lists of scalars.');
    }
  }
  if (options.type === 'catalog' && !Object.keys(options.where ?? {}).length) {
    throw new Error('A catalog requires a nonempty where mapping.');
  }
  validateIndexTableOptions(options);
}

export function parseIndex(source) {
  const options = parse(source,{maxAliasCount:20});
  validate(options);
  return {recursive:options.type === 'whereabouts', scope:'current', show:'both', mode:'grid', heading:true, ...options};
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
  const {type, from, via, scope = 'current', recursive = type === 'whereabouts', where = {}, columns, columnHeadings, sortBy} = options;
  const affiliationTypes = options.affiliationType === undefined ? null : new Set([].concat(options.affiliationType));
  const {dates,names,locations,affiliations,templates} = createHeaderContext(snapshot,{date});
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
  const taelgarRoot = type === 'whereabouts' && reference(options.target) === TAELGAR_LOCATION;
  let target;
  if (type !== 'catalog' && !taelgarRoot) {
    target = options.target ? lookup(options.target,sourcePath) : byPath.get(sourcePath);
    if (!target || !visible(target)) throw new Error('The index target is unavailable.');
  }
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
      if (taelgarRoot && reference(record.location) === TAELGAR_LOCATION) return true;
      const parent = lookup(record.location,source);
      if (!parent) return false;
      if (parent.path === target?.path) return true;
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
          if (parent && parent.path !== target?.path && !seen.has(parent.path)) pending.push(parent);
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
  const rows = createIndexRows({dates,names,templates},at,{fields,lookup,whereabouts});
  const warnings = new Set();
  for (const page of byType.get(from)) {
    const metadata = page.metadata;
    if (!visible(page) || page.path === target?.path || !filters.every(([key,value]) =>
      Object.hasOwn(metadata,key) && (Array.isArray(value) ? value.includes(metadata[key]) : metadata[key] === value))) continue;
    try {
      const life = dates.getPageDates(metadata,at);
      const first = known(life.startDate) ? life.startDate.sort : -Infinity;
      const ended = known(life.endDate) && life.endDate.sort < at.sort;
      if (first > at.sort || (ended && (scope === 'current' || life.endDate.sort < first))) continue;
      const until = ended ? life.endDate : at;
      const affiliation = type === 'affiliation' ? matchAffiliation(
        affiliations.getAffiliations(metadata,until), page.path, {target, lookup, recursive, scope, affiliationTypes, first, until}
      ) : undefined;
      let matched = until;
      if (type === 'whereabouts') matched = matchDate(page,first,until);
      if (type === 'affiliation') matched = affiliation?.date;
      if (!matched) continue;
      rows.add(page,{life,matched,affiliation});
    } catch (error) {
      if (!(error instanceof HeaderDataError)) throw error;
      warnings.add('Some pages were omitted because their relationship metadata contains a cycle.');
    }
  }
  const items = rows.sort(sortBy || (from === 'place' ? ['type'] : []));
  const label = {person:'People',place:'Places',object:'Objects',event:'Events',group:'Groups',power:'Powers',ancestry:'Ancestries',creature:'Creatures'}[from];
  return {from,label:(scope === 'historical' ? 'Historical ' : scope === 'ever' ? 'All-time ' : '') + label,
    target:taelgarRoot ? TAELGAR_LOCATION : target && (names.getNameObject(target.path).name || target.name),
    items,warnings:[...warnings],columns,columnHeadings};
}
