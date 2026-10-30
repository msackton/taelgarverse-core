import path from 'node:path';
import {parse} from 'yaml';
import {RenderError,dateKey} from './common.mjs';
import {withoutHeaderCallouts} from './header-callout.mjs';

export const IMAGE_TYPES = new Set(['.png','.jpg','.jpeg','.gif','.webp','.heic']);
export const AUDIO_TYPES = new Set(['.mp3','.m4a','.wav','.flac','.ogg']);
export const ASSET_TYPES = new Set([...IMAGE_TYPES, ...AUDIO_TYPES, '.pdf']);

function normalizeYaml(value) {
  if (value instanceof Date) return value.toISOString().replace(/T00:00:00.000Z$/, '');
  if (Array.isArray(value)) return value.map(normalizeYaml);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, normalizeYaml(v)]));
  return value;
}
export function parseNote(source) {
  source = source.replace(/\r\n?/g, '\n');
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source);
  if (!match) return {metadata: {}, body: source, source};
  const parsed = parse(match[1], {version: '1.1', merge: true, uniqueKeys: false, maxAliasCount: 100});
  const metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? normalizeYaml(parsed) : {};
  return {metadata, body: source.slice(match[0].length), source};
}

// Generated callout fallback text is not authored article content.
export function authoredBody(note) {
  return withoutHeaderCallouts(note.body);
}
export function publicationExclusions(metadata) {
  const raw = metadata.excludePublish;
  const exclusions = (typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : []).map(x => String(x).trim().toLowerCase());
  return exclusions;
}
export function excluded(metadata, settings) {
  const exclusions=publicationExclusions(metadata);
  return exclusions.includes('all') || settings.campaigns.some(c => exclusions.includes(c.toLowerCase()));
}
// Match CustomJS DateManager's start dates: numeric years start on January 1;
// quoted years and year-month strings use the last day of the stated period.
// Missing/unknown dates cannot establish that a subject is in the future.
function creationDateKey(value) {
  if (!value) return null;
  let date = String(value);
  if (typeof value === 'string') {
    if (/^[0-9]{1,4}$/.test(date)) date += '-12-31';
    else if (/^[0-9]{1,4}-[0-9]{1,2}$/.test(date)) {
      const month = Number(date.split('-')[1]);
      date += '-' + [31,28,31,30,31,30,31,31,30,31,30,31][month - 1];
    }
  }
  try { return dateKey(date,true); } catch { return null; }
}
// POV dates describe the earliest perspective in which the page exists.
// Years (quoted or numeric), plural years, and months start at their beginning.
function povDateKey(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = String(value).trim().replace(/^([0-9]{1,4})s$/, '$1');
  try { return dateKey(date,true); } catch { return null; }
}
export function availableFrom(entry, settings = {}) {
  if (entry.availability) return settings.respect_pov_dates === true ? entry.availability.povFrom : entry.availability.from;
  const metadata=entry.note.metadata,start=creationDateKey(metadata.born || metadata.created);
  const pov = settings.respect_pov_dates === true ? povDateKey(metadata.POV) : null;
  return Math.max(start || 10101,metadata.activeYear ? dateKey(String(metadata.activeYear),true) : 10101,pov || 10101);
}
export function availableInContext(entry, context, settings) {
  if (!entry?.note) return false;
  const exclusions=entry.availability?.exclusions;
  if (exclusions ? exclusions.includes('all') || context.campaigns.some(c=>exclusions.includes(c.toLowerCase())) : excluded(entry.note.metadata,{campaigns:context.campaigns})) return false;
  const policy = typeof context.pov === 'boolean' ? {respect_pov_dates:context.pov} : settings;
  return availableFrom(entry,policy)<=dateKey(context.date);
}
export function compileAvailability(entry) {
  return {from:availableFrom(entry),povFrom:availableFrom(entry,{respect_pov_dates:true}),exclusions:publicationExclusions(entry.note.metadata)};
}
function addAlias(map, alias, entry) {
  if (!alias) return;
  const entries = map.get(alias) ?? new Set();
  entries.add(entry);
  map.set(alias, entries);
}
export class ContentStore {
  constructor(entries,warnings = [],settings = {},lookups) {
    this.settings = settings;
    this.entries = entries;
    this.warnings = warnings;
    this.bySlug = new Map(); this.assets = new Map(); this.canonical = new Map(); this.aliases = new Map();
    if (lookups) {
      this.bySlug=new Map(lookups.pages.map(([key,index])=>[key,entries[index]]));
      this.assets=new Map(lookups.assets.map(([key,index])=>[key,entries[index]]));
      for(const field of ['canonical','aliases'])this[field]=new Map(lookups[field].map(([key,indices])=>[key,new Set(indices.map(index=>entries[index]))]));
      return;
    }
    for (const entry of entries) {
      const relative = entry.id;
      const mapping = entry.note ? this.bySlug : this.assets;
      const key = entry.note ? entry.slug : entry.target;
      if (mapping.has(key)) throw new Error('Duplicate URL: ' + key);
      mapping.set(key, entry);

      const names = [relative, entry.target, path.posix.basename(relative), path.posix.basename(entry.target)];
      if (entry.note) names.push(entry.name, entry.name.toLowerCase(), relative.slice(0, -3), entry.slug);
      else names.push(path.posix.basename(relative).toLowerCase());
      for (const name of names) addAlias(this.canonical, name, entry);
      let aliases = entry.note?.metadata.aliases ?? [];
      if (typeof aliases === 'string') aliases = [aliases];
      if (Array.isArray(aliases)) for (const alias of aliases) {
        addAlias(this.aliases, String(alias), entry);
        addAlias(this.aliases, String(alias).toLowerCase(), entry);
      }
    }
  }

  compileLookups() {
    const indices=new Map(this.entries.map((entry,index)=>[entry,index]));
    return {pages:[...this.bySlug].map(([key,entry])=>[key,indices.get(entry)]),assets:[...this.assets].map(([key,entry])=>[key,indices.get(entry)]),
      canonical:[...this.canonical].map(([key,entries])=>[key,[...entries].map(entry=>indices.get(entry))]),
      aliases:[...this.aliases].map(([key,entries])=>[key,[...entries].map(entry=>indices.get(entry))])};
  }

  lookup(raw) {
    const target = raw.trim().replace(/^!?\[\[|\]\]$/g, '').replace(/\\/g, '/');
    const names = [target];
    if (target.endsWith('.md')) names.push(target.slice(0, -3));
    if (target.includes('/')) {
      names.push(path.posix.basename(target), path.posix.basename(target, path.posix.extname(target)));
      if (!path.posix.extname(target)) names.push(target + '.md');
    } else {
      names.push(target.toLowerCase());
      if (!target.endsWith('.md')) names.push(target + '.md');
    }
    for (const map of [this.canonical, this.aliases]) for (const name of names) {
      const matches = map.get(name);
      if (matches) return matches.size === 1 ? {status: 'found', entry: [...matches][0]} : {status: 'ambiguous'};
    }
    return {status: 'missing'};
  }

  resolve(page) {
    if (page.startsWith('/') || page.includes('\\') || page.split('/').some(p => p === '.' || p === '..')) {
      throw new RenderError(404, 'Page not found');
    }
    page = page.replace(/\/$/, '');
    const direct = this.bySlug.get(page.replace(/\.md$/, ''));
    if (direct) return direct;
    const result = this.lookup(page);
    if (result.status === 'ambiguous') throw new RenderError(409, 'Ambiguous page name; use its full relative path');
    if (!result.entry?.note) throw new RenderError(404, 'Page not found');
    return result.entry;
  }
}
