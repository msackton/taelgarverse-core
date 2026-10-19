import {handleRequest} from './application.mjs';
import {loadSnapshot} from './snapshot.mjs';
import {serveAsset,themeFiles} from './http-assets.mjs';
import {RenderError} from './common.mjs';

export function createWorker(instantiate,headerRevision) {
  let state;
  return {async fetch(request,env) {
    try {
      const url=new URL(request.url);
      if (url.pathname.startsWith('/theme/')) {
        if (!themeFiles[url.pathname.slice(7)]) return new Response('Theme file not found',{status:404});
        return env.ASSETS.fetch(request);
      }
      if (!state || state.revision!==env.CONTENT_REVISION || state.bucket!==env.CONTENT) {
        const pending=loadSnapshot(env.CONTENT,env.CONTENT_REVISION,instantiate,headerRevision);
        const current={revision:env.CONTENT_REVISION,bucket:env.CONTENT,pending};state=current;
        pending.catch(()=>{if(state===current)state=undefined;});
      }
      const {engine,store}=await state.pending;
      return await handleRequest(request,engine,{
        runtime:'cloudflare-worker',revision:env.CONTENT_REVISION,
        async renderPage(page,date,context,dm) {
          const entry=store.resolve(page), note=await store.getNote(entry);
          return engine.render(page,date,context,dm,note);
        },
        assets(entry,request) {
          return serveAsset(request,entry,async range=>{
            const object=await env.CONTENT.get(entry.objectKey,{range});
            if (!object || object.size!==entry.size) throw new RenderError(503,'Content asset is not available');
            return object.body;
          });
        },
        theme:(_name,request)=>env.ASSETS.fetch(request),
      });
    } catch(error) {
      const status=error.status || 500;
      if (status===500) console.error(error);
      return new Response(JSON.stringify({detail:status===500 ? 'Internal rendering error' : error.message}),{
        status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
      });
    }
  }};
}
