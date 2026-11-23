// The application dispatches by name. Snapshot loading and timings use the
// same match, including the distinction between a homepage and an empty search.
function route(name, data, timing = name) {
  return {name, data, timing};
}

const routes = new Map([
  ['/', route('home', 'renderer')],
  ['/api/page', route('pageApi', 'renderer', 'article')],
  ['/api/maps', route('maps', 'renderer')],
  ['/api/diagram-links', route('diagramLinks', 'renderer', 'diagram-links')],
  ['/api/navigation', route('navigation', 'navigation')],
  ['/api/search', route('searchApi', 'search', 'search')],
  ['/api/contexts', route('contexts', 'manifest')],
  ['/health', route('health', 'manifest')],
  ['/docs', route('docs', 'manifest')],
  ['/openapi.json', route('openapi', 'manifest')],
  ['/page/', route('article', 'renderer')],
  ['/browse/', route('browse', 'navigation', 'navigation')],
  ['/assets/', route('asset', 'asset')],
  ['/theme/', route('theme', 'manifest')],
]);
const searchPage = route('searchPage', 'navigation', 'search');
const missing = route('notFound', 'manifest', 'other');

export function classifyRoute(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return {...missing, name: 'methodNotAllowed', url};
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch (error) { return {...missing, name: 'invalidPath', url, error}; }
  // A trailing slash in the table matches the remaining path as a single value.
  const prefixEnd = pathname.indexOf('/', 1) + 1;
  const match = pathname === '/' && url.searchParams.has('q') ? searchPage
    : routes.get(pathname) ?? routes.get(pathname.slice(0, prefixEnd)) ?? missing;
  return {...match, url, pathname, tail: pathname.slice(prefixEnd)};
}
