import path from 'node:path';
import {availableInContext} from './content-store.mjs';
import {pageUrl} from './common.mjs';
import {fragmentId, pageLinkEntry} from './markdown.mjs';

// Resolve diagram destinations against the originating note, including embeds.
// Only ordinary URLs and visible, unambiguous articles become active links.
export function resolveDiagramLink(target, {store, entry, context, origin}) {
  target = target.trim();
  if (!target || /[\u0000-\u001f\u007f\\]/.test(target) || target.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    let url;
    try { url = new URL(target); } catch { return null; }
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    if (url.origin !== origin || !url.pathname.startsWith('/page/')) return {href: url.href};
    target = url.pathname + url.hash;
  }
  const hash = target.indexOf('#');
  let name, fragment;
  try {
    name = decodeURIComponent((hash < 0 ? target : target.slice(0, hash)).split('?')[0]);
    fragment = hash < 0 ? '' : fragmentId(decodeURIComponent(target.slice(hash + 1)));
  } catch { return null; }
  let destination;
  if (!name) destination = entry;
  else if (name.startsWith('/page/')) destination = pageLinkEntry(store, name);
  else {
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(entry.id), name));
    const exported = path.posix.normalize(path.posix.join(path.posix.dirname(entry.target), name));
    destination = /^\.\.?\//.test(name) ? store.lookup(relative).entry || store.lookup(exported).entry
      : store.lookup(name).entry || store.lookup(relative).entry || store.lookup(exported).entry;
  }
  if (!availableInContext(destination, context, store.settings)) return null;
  return {page: destination.slug, title: destination.title,
    href: pageUrl(destination.slug, context.date, context) + (fragment ? '#' + fragment : '')};
}
