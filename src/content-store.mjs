import path from 'node:path';
import {parse} from 'yaml';
import {RenderError,dateKey} from './common.mjs';

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
export function excluded(metadata, settings) {
  const raw = metadata.excludePublish;
  const exclusions = (typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : []).map(x => String(x).trim().toLowerCase());
  const tags = typeof metadata.tags === 'string' ? [metadata.tags] : metadata.tags ?? [];
  return exclusions.includes('all') || settings.campaigns.some(c => exclusions.includes(c.toLowerCase())) ||
    (Array.isArray(tags) && tags.some(t => String(t).split('/').includes('excalidraw')));
}
export function availableInContext(entry, context) {
  if (!entry?.note || excluded(entry.note.metadata,{campaigns:context.campaigns})) return false;
  const active = entry.note.metadata.activeYear;
  return !active || dateKey(String(active),true) <= dateKey(context.date);
}
function addAlias(map, alias, entry) {
  if (!alias) return;
  const entries = map.get(alias) ?? new Set();
  entries.add(entry);
  map.set(alias, entries);
}
export class ContentStore {
  constructor(entries,warnings = []) {
    this.entries = entries;
    this.warnings = warnings;
    this.bySlug = new Map(); this.assets = new Map(); this.canonical = new Map(); this.aliases = new Map();
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
