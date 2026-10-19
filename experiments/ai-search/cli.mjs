import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {ROOT,loadSettings} from '../../src/config.mjs';
import {Store} from '../../src/store.mjs';
import {Contexts} from '../../src/contexts.mjs';
import {tokenizer,prepareCorpus,validateConfig,PILOT_INSTANCE} from './corpus.mjs';
import {PilotClient,credentials,owned} from './cloudflare.mjs';
import {readJSON,writeJSON,validateBatch,reserve,syncBatch,compareQuery} from './runner.mjs';
import {reportHTML,viewerHTML} from './viewer.mjs';
import {updateProbe,visibilityProbe} from './probes.mjs';

export const CACHE=path.join(ROOT,'.cache/ai-search-pilot');
function options(argv){
  const result={command:argv[0]==='--help' ? 'help' : argv[0] || 'help'};
  const flags=new Set(['dry-run','rerank']);
  const values=new Set(['pilot','config','source','views','style','chunk-tokens','overlap-tokens','batch','query','mode','threshold','keyword-match','port']);
  for(let i=1;i<argv.length;i++){
    const key=argv[i].replace(/^--/,'');
    if(flags.has(key))result[key]=true;
    else if(values.has(key) && argv[i].startsWith('--') && argv[i+1] && !argv[i+1].startsWith('--'))result[key]=argv[++i];
    else throw new Error('Unknown or missing option: '+argv[i]);
  }
  return result;
}
const batchFile=run=>{
  if(!/^(article|passages)-[a-f0-9]{16}$/.test(run || ''))throw new Error('Invalid pilot batch ID');
  return path.join(CACHE,'batches',run,'manifest.json');
};
const receiptFile=run=>path.join(path.dirname(batchFile(run)),'upload.json');
function loadBatch(run,codec,config){
  run ??=readJSON(path.join(CACHE,'latest.json')).run;
  const batch=readJSON(batchFile(run));
  if(config.siteUrl)for(const doc of batch.documents)if(doc.url.startsWith('/'))doc.url=new URL(doc.url,config.siteUrl).href;
  batch.limits=config.limits;return validateBatch(batch,codec);
}
function recordReport(comparisons,prefix){
  const file=prefix || path.join(CACHE,'reports',new Date().toISOString().replaceAll(':','-')+'-'+Math.random().toString(36).slice(2,7));
  writeJSON(file+'.json',comparisons);fs.writeFileSync(file+'.html',reportHTML(comparisons));return file+'.html';
}
function uploaded(batch){
  const file=receiptFile(batch.run), receipt=fs.existsSync(file) ? readJSON(file) : {};
  if(receipt.digest!==batch.digest || !receipt.completedAt)throw new Error('Upload this exact batch and wait for indexing before searching');
}
function environment(client,batch){return {
  previous:fs.existsSync(receiptFile(batch.run)) ? readJSON(receiptFile(batch.run)) : {},
  reserveUsage:amount=>reserve(CACHE,client.account,batch.limits,amount),
  record:report=>writeJSON(receiptFile(batch.run),{...report,account:client.account}),log:message=>console.log(message),
};}

export function createPilotServer({loadBatches,search}){
  return http.createServer(async(req,res)=>{
    const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(type==='application/json'?JSON.stringify(body):body);};
    try{
      const host=req.headers.host;
      if(!/^127\.0\.0\.1:\d+$/.test(host || '') || (req.headers.origin && req.headers.origin!=='http://'+host))return send(403,{detail:'Use the local pilot origin'});
      const url=new URL(req.url,'http://'+host);
      if(req.method==='GET' && url.pathname==='/')return send(200,viewerHTML,'text/html');
      if(req.method==='GET' && url.pathname==='/api/batches')return send(200,loadBatches());
      if(req.method==='POST' && url.pathname==='/api/search'){
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{detail:'Use application/json'});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8192)return send(413,{detail:'Request too large'});}
        const result=await search(JSON.parse(body));return send(200,result);
      }
      return send(404,{detail:'Unknown pilot route'});
    }catch(error){return send(400,{detail:error instanceof SyntaxError?'Invalid JSON':error.message});}
  });
}

export async function main(argv=process.argv.slice(2)){
  const opts=options(argv), config=validateConfig(readJSON(opts.pilot || new URL('./pilot.json',import.meta.url)));
  if(opts.command==='help'){
    console.log(`AI Search pilot (isolated instance: ${PILOT_INSTANCE})
Local:
  prepare [--style article|passages] [--views public-all] [--chunk-tokens 600] [--overlap-tokens 0]
          [--source <existing prepared export>] [--config <vault config>] [--pilot <allowlist JSON>]
  upload --dry-run [--batch <run ID>]
Remote, using CLOUDFLARE_API_TOKEN or the existing Wrangler login:
  init | status
  upload [--batch <run ID>]
  query --query "..." [--mode hybrid|keyword|vector] [--views public-all] [--rerank]
  compare [--batch <run ID>] [--views public-all] [--rerank]
  probe-updates [--batch <run ID>]   (two diagnostic copies; cleans up afterward)
  probe-visibility --batch <visibility run ID>
  reset --batch <run ID>   (only documents owned by that pilot batch)
Local viewer backed by remote queries:
  serve [--port 8770]
Optional retrieval settings: --threshold 0..1, --keyword-match and|or.
Prepared files, usage counters, upload receipts, and results stay in .cache/ai-search-pilot.`);return;
  }
  const codec=tokenizer();
  try{
    if(opts.command==='prepare'){
      const settings=loadSettings(opts.config);if(opts.source)settings.source_dir=fs.realpathSync(path.resolve(opts.source));
      const store=new Store(settings), registry=readJSON(path.join(settings.vault_dir,'_scripts/session_note_campaigns.json'));
      const contexts=new Contexts(store,registry,settings);
      const batch=prepareCorpus({store,contexts,config,codec,views:(opts.views || 'public-all').split(','),style:opts.style || 'article',
        chunkTokens:Number(opts['chunk-tokens'] || 600),overlapTokens:Number(opts['overlap-tokens'] || 0)});
      writeJSON(batchFile(batch.run),batch);writeJSON(path.join(CACHE,'latest.json'),{run:batch.run});
      // Exact upload payloads can be inspected without reading the JSON escapes.
      for(const doc of batch.documents){const file=path.join(path.dirname(batchFile(batch.run)),'documents',path.basename(doc.key));fs.mkdirSync(path.dirname(file),{recursive:true});
        fs.writeFileSync(path.join(path.dirname(file),doc.view+'-'+path.basename(file)),doc.text);}
      console.log(JSON.stringify({run:batch.run,notes:batch.sources.length,documents:batch.documents.length,tokens:batch.tokens,warnings:batch.warnings,manifest:batchFile(batch.run)},null,2));return;
    }
    if(opts.command==='upload' && opts['dry-run']){
      const batch=loadBatch(opts.batch,codec,config);console.log(JSON.stringify({instance:PILOT_INSTANCE,run:batch.run,documents:batch.documents.length,
        tokens:batch.tokens,views:batch.views.map(v=>v.id),limits:batch.limits,remoteCalls:0},null,2));return;
    }
    if(!['init','status','upload','query','compare','reset','serve','probe-updates','probe-visibility'].includes(opts.command))throw new Error('Unknown pilot command: '+opts.command);
    const client=new PilotClient(credentials());
    if(opts.command==='init'){
      const info=await client.ensure();console.log(JSON.stringify({instance:PILOT_INSTANCE,account:client.account,embeddingModel:info.embedding_model,
        indexMethod:info.index_method,chunkSize:info.chunk_size,overlap:info.chunk_overlap},null,2));return;
    }
    if(opts.command==='status'){
      const items=await client.list();console.log(JSON.stringify({instance:PILOT_INSTANCE,account:client.account,stats:await client.stats(),
        runs:[...new Set(items.filter(owned).map(i=>i.metadata.run))],sample:items.slice(0,1).map(i=>({status:i.status,metadata:i.metadata,fields:Object.keys(i)})),
        usage:fs.existsSync(path.join(CACHE,'usage',client.account+'.json'))?readJSON(path.join(CACHE,'usage',client.account+'.json')):null},null,2));return;
    }
    if(opts.command==='serve'){
      const loadBatches=()=>{
        const folder=path.join(CACHE,'batches');if(!fs.existsSync(folder))return [];
        return fs.readdirSync(folder).filter(run=>/^(article|passages)-[a-f0-9]{16}$/.test(run) && fs.existsSync(receiptFile(run))).flatMap(run=>{
          const b=loadBatch(run,codec,config);try{uploaded(b);}catch{return [];}
          return [{run,style:b.options.style,chunkTokens:b.options.chunkTokens,experiment:b.options.experiment || 'sample',notes:b.sources.length,
            views:b.views.map(({id,label})=>({id,label}))}];
        });
      };
      const server=createPilotServer({loadBatches,search:async input=>{
        const batch=loadBatch(input.run,codec,config);uploaded(batch);
        if(!Array.isArray(input.modes) || !input.modes.length || input.modes.length>3 || new Set(input.modes).size!==input.modes.length || typeof input.rerank!=='boolean')throw new Error('Invalid search modes');
        const result=await compareQuery(new PilotClient(credentials()),batch,input.view,input.query,{modes:input.modes,rerank:input.rerank,threshold:input.threshold ?? .4,
          reserveUsage:amount=>reserve(CACHE,client.account,batch.limits,amount)});
        recordReport([result]);return result;
      }});
      const port=Number(opts.port || 8770);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
      console.log('Search pilot: http://127.0.0.1:'+port);for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
      return;
    }
    const batch=loadBatch(opts.batch,codec,config);
    if(opts.command==='upload'){
      const lock=path.join(CACHE,'sync-'+client.account+'-'+batch.run+'.lock');const fd=fs.openSync(lock,'wx');
      try{const result=await syncBatch(client,batch,environment(client,batch));console.log(JSON.stringify({run:result.run,uploaded:result.uploaded,
        unchanged:result.unchanged,resumed:result.resumed,deleted:result.deleted,tokens:result.tokens,indexedChunks:result.indexedChunks,
        completedAt:result.completedAt,receipt:receiptFile(batch.run)},null,2));}
      finally{fs.closeSync(fd);fs.unlinkSync(lock);}return;
    }
    if(opts.command==='reset'){
      if(!opts.batch)throw new Error('Reset requires an explicit --batch ID');
      const items=(await client.list()).filter(i=>owned(i) && i.metadata.run===batch.run);
      for(const item of items)await client.remove(item);
      if(fs.existsSync(receiptFile(batch.run)))fs.unlinkSync(receiptFile(batch.run));
      console.log('Deleted '+items.length+' documents from '+batch.run+'; cumulative usage retained');return;
    }
    uploaded(batch);
    if(opts.command.startsWith('probe-')){
      const settings={codec,reserveUsage:amount=>reserve(CACHE,client.account,batch.limits,amount),log:message=>console.log(message),
        saveBatch:exported=>writeJSON(batchFile(exported.run),exported),
        record:report=>writeJSON(path.join(CACHE,'reports',opts.command+'.json'),report)};
      const result=opts.command==='probe-updates' ? await updateProbe(client,batch,settings) : await visibilityProbe(client,batch,settings);
      console.log(JSON.stringify(result,null,2));return;
    }
    const view=opts.views || batch.views[0].id, settings={rerank:Boolean(opts.rerank),threshold:Number(opts.threshold ?? 0),keywordMatch:opts['keyword-match'] || 'and',
      reserveUsage:amount=>reserve(CACHE,client.account,batch.limits,amount)};
    const queries=opts.command==='query' ? [{query:opts.query,expected:[]}] : readJSON(new URL('./queries.json',import.meta.url));
    const comparisons=[];
    const reportPath=path.join(CACHE,'reports',new Date().toISOString().replaceAll(':','-')+'-'+Math.random().toString(36).slice(2,7));
    for(const query of queries){
      const result=await compareQuery(client,batch,view,query.query,{...settings,...(opts.command==='query'?{modes:[opts.mode || 'hybrid']}:{})});
      result.kind=query.kind || 'manual';
      result.evaluation=Object.fromEntries(result.results.map(r=>[r.mode,query.expected.length ? r.pages.some(p=>query.expected.some(id=>batch.documents.find(d=>d.source===id)?.page===p.page)) : query.kind==='negative' ? r.pages.length===0 : null]));
      comparisons.push(result);console.log(JSON.stringify({query:query.query,results:result.results.map(r=>({mode:r.mode,latencyMs:r.latencyMs,pages:r.pages.map(p=>p.title),expectedHit:result.evaluation[r.mode]}))}));
      recordReport(comparisons,reportPath);
    }
    console.log('Comparison report: '+recordReport(comparisons,reportPath));
  }finally{if(opts.command!=='serve')codec.free();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){main().catch(error=>{console.error(error.message);process.exitCode=1;});}
