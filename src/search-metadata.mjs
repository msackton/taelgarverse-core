import {compileAvailability} from './content-store.mjs';
import {searchType} from './search-types.mjs';

export const normalizeName=value=>String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('"','').replace(/\s+/g,' ').trim();
export function compileSearchMetadata(entry) {
  const raw=entry.note.metadata.aliases ?? [],aliases=(Array.isArray(raw)?raw:[raw]).map(normalizeName);
  const names=[entry.title,entry.name,entry.note.metadata.name].filter(Boolean).map(normalizeName);
  return {type:searchType(entry),names:[...new Set(names)],aliases:[...new Set(aliases)],
    text:normalizeName([entry.slug,entry.name,entry.title,entry.note.metadata.name,...(Array.isArray(raw)?raw:[raw])].filter(Boolean).join(' '))};
}
export function searchMetadataRow(entry) {
  return {page:entry.slug,...compileSearchMetadata(entry),...compileAvailability(entry)};
}
