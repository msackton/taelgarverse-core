import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT} from '../src/config.mjs';
import {loadCloudflareConfig} from './prepare-cloudflare.mjs';
import {buildBrowser} from './build-browser.mjs';
import {createSearchDatabase} from './search-database.mjs';
import {SearchIndex,readPreparedSearch} from './search-index.mjs';
import {activationPointer,validatePublicationUploads,createRetentionStorage,prunePublication,POINTER_KEY} from './content-retention.mjs';

const task=process.argv[2], extra=process.argv.slice(3);
const output=path.join(ROOT,'.cache/cloudflare');
const latestFile=path.join(output,'latest.json');
const receiptFile=path.join(output,'remote-upload.json');
const cli=path.join(ROOT,'node_modules/wrangler/bin/wrangler.js');

function run(args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,...args,...extra],{cwd:ROOT,stdio:'inherit',windowsHide:true,
      env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    child.on('error',reject);
    child.on('exit',code=>code===0 ? resolve() : reject(new Error('Wrangler exited with code '+code)));
  });
}

function prepared() {
  if (!fs.existsSync(latestFile)) throw new Error('Prepare content first: node scripts/prepare-cloudflare.mjs');
  const report=JSON.parse(fs.readFileSync(latestFile,'utf8'));
  const config=JSON.parse(fs.readFileSync(report.configFile,'utf8'));
  return {report,config,flags:['--config',report.configFile]};
}

function verifiedUpload(report,config) {
  const receipt=fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile,'utf8')) : {};
  if (receipt.revision!==report.revision || receipt.bucket!==report.bucket ||
      receipt.worker!==config.name || receipt.account!==config.account_id) {
    throw new Error('Upload this snapshot first with node scripts/cloudflare.mjs upload-remote, then publish it');
  }
}

async function uploadPrepared(report,config,flags,{local=false,activate=false}={}) {
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  validatePublicationUploads(report.revision,uploads);
  if(config.r2_buckets?.find(b=>b.binding==='CONTENT')?.bucket_name!==report.bucket)throw new Error('Prepared content and retention bucket disagree');
  if(extra.some(arg=>/^--(?:config|env|local|remote|persist-to)(?:=|$)/.test(arg) || ['-c','-e'].includes(arg)))throw new Error('Publishing destination overrides must be configured before preparation');
  const manifest=report.search?readPreparedSearch(report):null;
  const db=await createSearchDatabase(config,{local});let retention;
  try{
    retention=await createRetentionStorage(config,{local});const index=new SearchIndex(db,{log:console.log});
    await index.withPublicationLock(async()=>{
      const target=local?['--local','--persist-to',path.join(ROOT,'.wrangler/state')]:['--remote'];
      // Re-upload under the lock at activation too: an intervening publication
      // may have collected this previously uploaded but unactivated snapshot.
      await run(['r2','bulk','put',report.bucket,...flags,'--filename',report.manifestFile,...target,'--concurrency','8','--force']);
      if(!activate)return;
      if(manifest)await index.stage(report.revision,manifest);
      const pointer=activationPointer(await retention.getJSON(POINTER_KEY),{revision:report.revision,
        completedAt:new Date().toISOString(),...(report.search?{search:report.search}:{})});
      fs.writeFileSync(report.pointerFile,JSON.stringify(pointer)+'\n');
      await run(['r2','object','put',report.bucket+'/'+POINTER_KEY,...flags,'--file',report.pointerFile,...target,'--force']);
      try{await prunePublication(retention,index,pointer,{log:console.log});}
      catch(error){throw new Error('Content is published, but cleanup failed; retry node scripts/cloudflare.mjs publish: '+error.message);}
    });
  }finally{try{await retention?.close();}finally{await db.close();}}
}

if (task==='check' || task==='deploy') {
  await buildBrowser();
  const config=loadCloudflareConfig();
  config.main=path.join(ROOT,'src/worker.mjs');
  config.assets.directory=path.join(ROOT,'public');
  fs.mkdirSync(output,{recursive:true});
  const deployConfig=path.join(output,'deploy.json');
  fs.writeFileSync(deployConfig,JSON.stringify(config)+'\n');
  await run(['deploy','--config',deployConfig,
    ...(task==='check' ? ['--dry-run','--outdir',path.join(output,'worker-build')] : [])]);
} else if (task==='bucket') {
  const {report,flags}=prepared();
  await run(['r2','bucket','create',report.bucket,...flags]);
} else if (task==='dev') {
  await buildBrowser();
  const {flags}=prepared();
  await run(['dev',...flags,'--ip','127.0.0.1','--port','8787','--persist-to',path.join(ROOT,'.wrangler/state')]);
} else if (task==='upload-local' || task==='upload-remote') {
  const {report,config,flags}=prepared();
  const local=task==='upload-local';
  await uploadPrepared(report,config,flags,{local,activate:local});
  if (!local) {
    fs.writeFileSync(receiptFile,JSON.stringify({revision:report.revision,bucket:report.bucket,
      worker:config.name,account:config.account_id,uploadedAt:new Date().toISOString()})+'\n');
  }
} else if (task==='publish') {
  const {report,config,flags}=prepared();
  verifiedUpload(report,config);
  await uploadPrepared(report,config,flags,{activate:true});
} else {
  throw new Error('Unknown Cloudflare task');
}
