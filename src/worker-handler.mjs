import {handleRequest} from './application.mjs';
import {openSnapshot} from './runtime-snapshot.mjs';
import {serveAsset,themeFiles} from './http-assets.mjs';
import {RenderError} from './common.mjs';
import {createD1Search} from './search.mjs';
import {pageCache} from './page-cache.mjs';

export function createWorker(coreRelease = {},{cache}={}) {
  let state;
  return {async fetch(request,env,context) {
    try {
      const url=new URL(request.url);
      if (url.pathname.startsWith('/theme/')) {
        const file=themeFiles[url.pathname.slice(7)];
        if (!file) return new Response('Theme file not found',{status:404});
        return env.ASSETS.fetch(new Request(new URL('/'+file,url),request));
      }
      const publication=await env.CONTENT.get('published/current.json');
      if (!publication) {
        if (url.pathname==='/health') return Response.json({status:'awaiting-content',runtime:'cloudflare-worker'},{headers:{'Cache-Control':'no-store'}});
        throw new RenderError(503,'No content has been published');
      }
      const published=await publication.json(), {revision}=published;
      if (!/^[a-f0-9]{64}$/.test(revision || '')) throw new RenderError(503,'Published content pointer is invalid');
      const cached=pageCache(request,published,coreRelease,cache);
      if(cached){const response=await cached.match();if(response)return cached.respond(response,true);}
      if (!state || state.revision!==revision || state.bucket!==env.CONTENT) {
        const pending=openSnapshot(env.CONTENT,revision);
        const current={revision,bucket:env.CONTENT,pending};state=current;
        pending.catch(()=>{if(state===current)state=undefined;});
      }
      const snapshot=await state.pending;
      const {engine,store,index}=await snapshot.forRequest(request);
      let renderedPage=false;
      const response=await handleRequest(request,engine,{
        runtime:'cloudflare-worker',revision,
        search:createD1Search(env.SEARCH_DB,{revision,descriptor:index.search,store}),
        releases:{core:coreRelease,content:{...(index.sourceVersion || {}),
          ...(published.commit ? {commit:published.commit,dirty:published.dirty} : {}),publishedAt:published.completedAt}},
        async renderPage(page,date,context,dm,campaigns,pov) {
          const result=await engine.renderAsync(page,date,context,dm,campaigns,entry=>store.getNote(entry),pov);
          renderedPage=true;return result;
        },
        async renderHome(context,siteHost) {
          const result=await engine.renderHomeAsync(context,entry=>store.getNote(entry),siteHost);
          renderedPage=!!result;return result;
        },
        renderIndex(page,type,date,context,dm,campaigns,pov) {
          return engine.renderIndexAsync(page,type,date,context,dm,campaigns,entry=>store.getNote(entry),pov);
        },
        assets(entry,request) {
          return serveAsset(request,entry,async range=>{
            const object=await env.CONTENT.get(entry.objectKey,{range});
            if (!object || object.size!==entry.size) throw new RenderError(503,'Content asset is not available');
            return object.body;
          });
        },
        theme:(name,request)=>env.ASSETS.fetch(new Request(new URL('/'+themeFiles[name],request.url),request)),
      });
      if(cached && renderedPage && cached.accepts(response)){
        await cached.put(response,context);
        return cached.respond(response,false);
      }
      return response;
    } catch(error) {
      const status=error instanceof URIError ? 400 : error.status || 500;
      if (status===500) console.error(error);
      return new Response(JSON.stringify({detail:status===500 ? 'Internal rendering error' : error.message}),{
        status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
      });
    }
  }};
}
