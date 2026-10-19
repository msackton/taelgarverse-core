import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT} from '../src/config.mjs';

const task=process.argv[2], extra=process.argv.slice(3);
const latestFile=path.join(ROOT,'.cache/cloudflare/latest.json');
if (!fs.existsSync(latestFile)) throw new Error('Prepare content first: npm run cf:prepare');
const report=JSON.parse(fs.readFileSync(latestFile,'utf8'));
const prepared=JSON.parse(fs.readFileSync(report.configFile,'utf8'));
if (prepared.vars.CONTENT_REVISION!==report.revision) throw new Error('Prepared configuration is stale; run npm run cf:prepare again');
const receiptFile=path.join(ROOT,'.cache/cloudflare/remote-upload.json');
if (task==='upload-remote') {
  const immutableKey=new RegExp('^(?:assets/[a-f0-9]{64}|revisions/'+report.revision+'/(?:index\\.json|notes/[a-f0-9]{2}\\.json))$');
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
  if (!uploads.length || uploads.some(item=>!immutableKey.test(item.key))) throw new Error('Upload manifest must contain only this snapshot and content-addressed assets');
}
if (task==='deploy') {
  const receipt=fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile,'utf8')) : {};
  if (receipt.revision!==report.revision || receipt.bucket!==report.bucket || receipt.worker!==prepared.name || receipt.account!==prepared.account_id) {
    throw new Error('Upload this snapshot first with npm run cf:upload, then deploy');
  }
}
const cli=path.join(ROOT,'node_modules/wrangler/bin/wrangler.js');
const config=['--config',report.configFile];
const commands={
  dev:['dev',...config,'--ip','127.0.0.1','--port','8787','--persist-to',path.join(ROOT,'.wrangler/state')],
  check:['deploy',...config,'--dry-run','--outdir',path.join(ROOT,'.cache/cloudflare/worker-build')],
  bucket:['r2','bucket','create',report.bucket,...config],
  'upload-local':['r2','bulk','put',report.bucket,...config,'--filename',report.manifestFile,'--local','--persist-to',path.join(ROOT,'.wrangler/state'),'--concurrency','8'],
  // Keys are immutable and verified above. Explicit force also avoids Wrangler
  // treating a declined bulk-upload prompt as a successful process exit.
  'upload-remote':['r2','bulk','put',report.bucket,...config,'--filename',report.manifestFile,'--remote','--concurrency','8','--force'],
  deploy:['deploy',...config],
};
if (!commands[task]) throw new Error('Unknown Cloudflare task');
const child=spawn(process.execPath,[cli,...commands[task],...extra],{cwd:ROOT,stdio:'inherit',windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{
  if (code===0 && task==='upload-remote') fs.writeFileSync(receiptFile,JSON.stringify({
    revision:report.revision,bucket:report.bucket,worker:prepared.name,account:prepared.account_id,uploadedAt:new Date().toISOString(),
  })+'\n');
  process.exitCode=code ?? 1;
});
