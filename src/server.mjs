import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,RenderError,isInside,loadSettings} from './config.mjs';
import {Engine} from './engine.mjs';
import {handleRequest} from './application.mjs';
import {serveAsset,themeFiles,contentTypes} from './http-assets.mjs';
import {prepareMaps} from '../scripts/build-maps.mjs';
import {prepareImages} from '../scripts/build-images.mjs';
import {imageEntries} from './images.mjs';

export function createServer(engine) {
  const mapCache = path.join(ROOT,'.cache/maps');
  const imageCache = path.join(ROOT,'.cache/images');
  let mapsReady;
  const ready = () => mapsReady ??= prepareMaps(engine.store,mapCache).catch(error=>{mapsReady=undefined;throw error;});
  const server=http.createServer(async(req,res)=>{
    try {
      const request=new Request(new URL(req.url,'http://localhost'),{method:req.method,headers:req.headers});
      const response=await handleRequest(request,engine,{
        async renderPage(page,date,context,dm,campaigns) {
          await ready();
          const render = ()=>engine.render(page,date,context,dm,undefined,campaigns);
          const result = render(), entries = imageEntries(engine.store,result.html);
          if (!entries.length) return result;
          await prepareImages(engine.store,imageCache,{},entries);
          return render();
        },
        async renderHome(context) {
          await ready();
          const result = engine.renderHome(context), entries = imageEntries(engine.store,result?.html || '');
          if (!entries.length) return result;
          await prepareImages(engine.store,imageCache,{},entries);
          return engine.renderHome(context);
        },
        assets(entry,request) {
          const directory = entry.generatedMapTile ? mapCache : entry.generatedImageVariant ? imageCache : engine.settings.source_dir;
          if (!isInside(directory,fs.realpathSync(entry.filename))) throw new RenderError(404,'Asset not found');
          const stat=fs.statSync(entry.filename);
          return serveAsset(request,{...entry,size:stat.size,etag:'"'+stat.size+'-'+stat.mtimeMs+'"'},range=>
            Readable.toWeb(fs.createReadStream(entry.filename,{start:range.offset,end:range.offset+range.length-1})));
        },
        theme(name) {
          const file=themeFiles[name];
          if (!file) throw new RenderError(404,'Theme file not found');
          return new Response(fs.readFileSync(path.join(ROOT,'public',file)),{headers:{'Content-Type':contentTypes[path.extname(file)]}});
        },
      });
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if (!response.body) res.end();
      else await pipeline(Readable.fromWeb(response.body),res);
    } catch(error) {
      if (res.headersSent) {res.destroy();return;}
      console.error(error);
      res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({detail:'Internal rendering error'}));
    }
  });
  server.once('close',()=>engine.closeSearch?.());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const start = performance.now();
  const engine = new Engine(loadSettings());
  const server = createServer(engine);
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 8765);
  server.on('error',error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port,host,() => console.log('TaelgarVerse: http://' + host + ':' + port +
    ' (' + engine.store.bySlug.size + ' pages; startup ' + Math.round(performance.now() - start) + ' ms)'));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => process.exit(0)));
}
