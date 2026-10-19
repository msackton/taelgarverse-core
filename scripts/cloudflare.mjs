import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT} from '../src/config.mjs';
import {loadCloudflareConfig} from './prepare-cloudflare.mjs';

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
  if (!fs.existsSync(latestFile)) throw new Error('Prepare content first: npm run cf:prepare');
  const report=JSON.parse(fs.readFileSync(latestFile,'utf8'));
  const config=JSON.parse(fs.readFileSync(report.configFile,'utf8'));
  return {report,config,flags:['--config',report.configFile]};
}

function verifiedUpload(report,config) {
  const receipt=fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile,'utf8')) : {};
  if (receipt.revision!==report.revision || receipt.bucket!==report.bucket ||
      receipt.worker!==config.name || receipt.account!==config.account_id) {
    throw new Error('Upload this snapshot first with npm run cf:upload, then publish it');
  }
}

if (task==='check' || task==='deploy') {
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
  const {flags}=prepared();
  await run(['dev',...flags,'--ip','127.0.0.1','--port','8787','--persist-to',path.join(ROOT,'.wrangler/state')]);
} else if (task==='upload-local' || task==='upload-remote') {
  const {report,config,flags}=prepared();
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  const immutableKey=new RegExp('^(?:assets/[a-f0-9]{64}|revisions/'+report.revision+'/(?:index\\.json|notes/[a-f0-9]{2}\\.json))$');
  if (!uploads.length || uploads.some(item=>!immutableKey.test(item.key))) {
    throw new Error('Upload manifest must contain only this snapshot and content-addressed assets');
  }
  const local=task==='upload-local';
  const storage=local ? ['--local','--persist-to',path.join(ROOT,'.wrangler/state')] : ['--remote'];
  await run(['r2','bulk','put',report.bucket,...flags,'--filename',report.manifestFile,...storage,'--concurrency','8','--force']);
  if (local) {
    await run(['r2','object','put',report.bucket+'/published/current.json',...flags,'--file',report.pointerFile,...storage,'--force']);
  } else {
    fs.writeFileSync(receiptFile,JSON.stringify({revision:report.revision,bucket:report.bucket,
      worker:config.name,account:config.account_id,uploadedAt:new Date().toISOString()})+'\n');
  }
} else if (task==='publish') {
  const {report,config,flags}=prepared();
  verifiedUpload(report,config);
  await run(['r2','object','put',report.bucket+'/published/current.json',...flags,
    '--file',report.pointerFile,'--remote','--force']);
} else {
  throw new Error('Unknown Cloudflare task');
}
