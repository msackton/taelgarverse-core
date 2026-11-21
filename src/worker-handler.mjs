import {handleRequest} from './application.mjs';
import {openSnapshot} from './runtime-snapshot.mjs';
import {serveAsset,themeFiles} from './http-assets.mjs';
import {RenderError} from './common.mjs';
import {createD1Search} from './search.mjs';
import {pageCache} from './page-cache.mjs';
import {crawlerResponse,withCrawlerHeaders} from './crawler-policy.mjs';
import {bucketText,withTimeout,timings,timingLog,discardBody,RequestTimeout} from './runtime-io.mjs';

function failureResponse(error){
  const status=error instanceof URIError ? 400 : error.status || 500;
  // Provider exceptions can contain SQL, parameters or source content.
  if(status===500)console.error(JSON.stringify({event:'request-failed'}));
  return new Response(JSON.stringify({detail:status===500 ? 'Internal rendering error' : error.message}),{
    status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      ...(status===503?{'Retry-After':'1'}:{})},
  });
}
function routeCategory(request){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/search' || path==='/' && url.searchParams.has('q'))return 'search';
  if(path==='/api/navigation' || path.startsWith('/browse/'))return 'navigation';
  if(path==='/api/page' || path.startsWith('/page/'))return 'article';
  if(path==='/')return 'home';
  return 'other';
}

export function createWorker(coreRelease = {},{cache,snapshotCache,timeoutMs,cacheMs,queryTimeoutMs,requestTimeoutMs=10000,log=timingLog}={}) {
  let state;
  async function fetchResponse(request,env,context,measure,signal,onSnapshot) {
    try {
      const url=new URL(request.url);
      if (url.pathname.startsWith('/theme/')) {
        const file=themeFiles[url.pathname.slice(7)];
        if (!file) return new Response('Theme file not found',{status:404});
        return env.ASSETS.fetch(new Request(new URL('/'+file,url),request));
      }
      const publication=await measure('pointer',()=>bucketText(env.CONTENT,'published/current.json',timeoutMs));
      if (publication===null) {
        if (url.pathname==='/health') return Response.json({status:'awaiting-content',runtime:'cloudflare-worker'},{headers:{'Cache-Control':'no-store'}});
        throw new RenderError(503,'No content has been published');
      }
      const published=JSON.parse(publication), {revision}=published;
      if (!/^[a-f0-9]{64}$/.test(revision || '')) throw new RenderError(503,'Published content pointer is invalid');
      const cached=pageCache(request,published,coreRelease,cache,{cacheMs});
      if(cached){const response=await measure('page-cache',()=>cached.match());if(response)return cached.respond(response,true);}
      signal.throwIfAborted();
      if (!state || state.revision!==revision || state.bucket!==env.CONTENT) {
        const pending=openSnapshot(env.CONTENT,revision,{cache:snapshotCache,timeoutMs,cacheMs,log});
        const current={revision,bucket:env.CONTENT,pending};state=current;
        pending.catch(()=>{if(state===current)state=undefined;});
      }
      onSnapshot(state);
      const snapshot=await measure('snapshot-init',()=>state.pending);
      const {engine,store,index}=await measure('route-init',()=>snapshot.forRequest(request));
      let renderedPage=false;
      const response=await measure('application',()=>handleRequest(request,engine,{
        runtime:'cloudflare-worker',revision,
        search:createD1Search(env.SEARCH_DB,{revision,descriptor:index.search,store,measure,queryTimeoutMs}),
        releases:{core:coreRelease,content:{...(index.sourceVersion || {}),
          ...(published.commit ? {commit:published.commit,dirty:published.dirty} : {}),publishedAt:published.completedAt}},
        async renderPage(page,date,context,dm,campaigns) {
          const result=await measure('render',()=>engine.renderAsync(page,date,context,dm,campaigns,entry=>store.getNote(entry)));
          renderedPage=true;return result;
        },
        async renderHome(context,siteHost) {
          const result=await measure('render',()=>engine.renderHomeAsync(context,entry=>store.getNote(entry),siteHost));
          renderedPage=!!result;return result;
        },
        renderIndex(page,type,date,context,dm,campaigns) {
          return measure('render',()=>engine.renderIndexAsync(page,type,date,context,dm,campaigns,entry=>store.getNote(entry)));
        },
        assets(entry,request) {
          return serveAsset(request,entry,async range=>withTimeout(async signal=>{
            const object=await env.CONTENT.get(entry.objectKey,{range});
            if(signal.aborted){discardBody(object);throw signal.reason;}
            if (!object || object.size!==entry.size) throw new RenderError(503,'Content asset is not available');
            return object.body;
          },timeoutMs));
        },
        theme:(name,request)=>env.ASSETS.fetch(new Request(new URL('/'+themeFiles[name],request.url),request)),
      }));
      if(signal.aborted){discardBody(response);throw signal.reason;}
      if(cached && renderedPage && cached.accepts(response)){
        await cached.put(response,context);
        return cached.respond(response,false);
      }
      return response;
    } catch(error) {
      return failureResponse(error);
    }
  }
  return {async fetch(request,env,context) {
    const enabled=env.BLOCK_CRAWLERS==='true';
    const rejected=enabled?crawlerResponse(request):null;
    if(rejected)return withCrawlerHeaders(rejected,enabled);
    const timing=timings(log);let requestState;
    const response=await withTimeout(async signal=>{
      const value=await fetchResponse(request,env,context,(name,operation)=>{
        signal.throwIfAborted();return timing.measure(name,operation);
      },signal,current=>{requestState=current;});
      if(signal.aborted){discardBody(value);throw signal.reason;}
      return value;
    },requestTimeoutMs).catch(error=>{
      // A joining request owns this deadline. If the original request's I/O
      // context has disappeared, its timers/promise may never settle. Evict
      // only the snapshot this request used so the next request can reopen it.
      if(error instanceof RequestTimeout && state===requestState)state=undefined;
      return failureResponse(error);
    });
    timing.finish(routeCategory(request),response.status);
    return withCrawlerHeaders(response,enabled);
  }};
}
