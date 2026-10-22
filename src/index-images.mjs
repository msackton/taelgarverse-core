import path from 'node:path';
import {IMAGE_TYPES} from './content-store.mjs';

export function indexImageTarget(value) {
  // Unquoted [[image.png]] can arrive from YAML as nested single-item arrays.
  while (Array.isArray(value) && value.length===1) value=value[0];
  if (typeof value!=='string') return undefined;
  const target=value.trim().replace(/^!?\[\[|\]\]$/g,'').split('|')[0].split('#')[0].trim();
  if (!target || /^(?:[a-z][a-z\d+.-]*:|[\\/]{2})/i.test(target)) return undefined;
  return target;
}

export function indexImageEntry(store,value,sourcePath) {
  const target=indexImageTarget(value);
  if (!target) return undefined;
  const relative=path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath),target));
  const exact=store.canonical.get(relative);
  const entry=exact ? exact.size===1 ? [...exact][0] : undefined : /^\.\.?\//.test(target) ? undefined : store.lookup(target).entry;
  return entry && !entry.note && IMAGE_TYPES.has(entry.extension) ? entry : undefined;
}
