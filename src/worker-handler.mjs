import {handleRequest} from './application.mjs';
import {loadSnapshot} from './snapshot.mjs';
import {serveAsset,themeFiles} from './http-assets.mjs';
import {RenderError} from './common.mjs';

export function createWorker(instantiate) {
  let state;
  return {async fetch(request,env) {
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
      const {revision}=await publication.json();
      if (!/^[a-f0-9]{64}$/.test(revision || '')) throw new RenderError(503,'Published content pointer is invalid');
      if (!state || state.revision!==revision || state.bucket!==env.CONTENT) {
        const pending=loadSnapshot(env.CONTENT,revision,instantiate);
        const current={revision,bucket:env.CONTENT,pending};state=current;
        pending.catch(()=>{if(state===current)state=undefined;});
      }
      const {engine,store}=await state.pending;
      return await handleRequest(request,engine,{
        runtime:'cloudflare-worker',revision,
        async renderPage(page,date,context,dm,campaigns) {
          const {entry}=engine.resolvePage(page,date,context,dm,campaigns), note=await store.getNote(entry);
          return engine.render(page,date,context,dm,note,campaigns);
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
    } catch(error) {
      const status=error.status || 500;
      if (status===500) console.error(error);
      return new Response(JSON.stringify({detail:status===500 ? 'Internal rendering error' : error.message}),{
        status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
      });
    }
  }};
}
