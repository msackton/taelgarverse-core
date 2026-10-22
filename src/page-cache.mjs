import {createHash} from 'node:crypto';

const browserPolicy='public, max-age=0, must-revalidate';
const edgePolicy='public, max-age=86400';
const warning=operation=>console.warn(JSON.stringify({event:'page-cache-'+operation+'-failed'}));
const discard=response=>{response.body?.cancel().catch(()=>{});};

// Only the Worker caches rendered HTML. The publication pointer must have been
// read successfully before calling this, including on conditional requests.
export function pageCache(request,published,core,cache=globalThis.caches?.default) {
  if(!cache || !['GET','HEAD'].includes(request.method) || request.headers.has('Authorization') || request.headers.has('Range') ||
    /(?:^|,)\s*no-store\s*(?:,|$)/i.test(request.headers.get('Cache-Control') || '') ||
    !/^[a-f0-9]{40,64}$/.test(core.commit || '') || !Number.isFinite(Date.parse(core.publishedAt)))return null;
  const url=new URL(request.url);
  let pathname;
  try{pathname=decodeURIComponent(url.pathname);}catch{return null;}
  if(!pathname.startsWith('/page/') && !(pathname==='/' && !url.searchParams.has('q')))return null;
  url.hash='';
  // Preserve parameter presence, order and repeated values. The router uses
  // first values for some options and all values for campaign selections.
  const identity=JSON.stringify([1,[core.commit,core.dirty,core.publishedAt],
    [published.revision,published.commit,published.dirty,published.completedAt],url.href]);
  const digest=createHash('sha256').update(identity).digest('hex');
  const key=new Request(new URL('/.taelgarverse-cache/pages/v1/'+digest,url.origin));
  // A weak validator describes the versioned representation without hashing
  // the HTML or depending on transfer compression.
  const etag='W/"tv-page-'+digest+'"';
  const accepts=response=>response.status===200 && /^text\/html(?:;|$)/i.test(response.headers.get('Content-Type') || '') &&
    !response.headers.has('Set-Cookie') && !/(?:^|,)\s*private\b/i.test(response.headers.get('Cache-Control') || '') &&
    (!response.headers.has('Vary') || response.headers.get('Vary').toLowerCase()==='accept-encoding');
  return {
    accepts,
    async match() {
      try{
        const response=await cache.match(key);
        if(response && accepts(response) && response.headers.get('ETag')===etag)return response;
        if(response)discard(response);
      }catch{warning('read');}
      return null;
    },
    async put(response,context) {
      // A HEAD miss has no body and must never replace a cached GET response.
      if(request.method!=='GET')return;
      const copy=response.clone(),headers=new Headers(copy.headers);
      headers.set('Cache-Control',edgePolicy);headers.set('ETag',etag);
      const stored=new Response(copy.body,{status:200,headers});
      const pending=Promise.resolve().then(()=>cache.put(key,stored)).catch(()=>{discard(stored);warning('write');});
      if(context?.waitUntil)context.waitUntil(pending);
      else await pending;
    },
    respond(response,hit) {
      const headers=new Headers(response.headers);
      headers.set('Cache-Control',browserPolicy);headers.set('ETag',etag);
      headers.set('X-Taelgar-Page-Cache',hit?'HIT':'MISS');
      const condition=request.headers.get('If-None-Match');
      const unchanged=condition && (condition.trim()==='*' || condition.split(',').some(value=>value.trim().replace(/^W\//,'')===etag.slice(2)));
      if(unchanged || request.method==='HEAD'){
        discard(response);
        if(unchanged)headers.delete('Content-Length');
        return new Response(null,{status:unchanged?304:200,headers});
      }
      return new Response(response.body,{status:200,headers});
    },
  };
}
