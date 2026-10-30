import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import sharp from 'sharp';
import {PhotoshopJob,runPython} from '../obsidian/taelgarverse/maps/photoshop-runner.mjs';

const png=await sharp({create:{width:4,height:4,channels:4,background:'transparent'}}).png().toBuffer();
const fixture=`import fs from 'node:fs/promises';
const args=process.argv.slice(2),get=flag=>args[args.indexOf(flag)+1],has=flag=>args.includes(flag);
if(has('--inventory-json')){
 if(get('--source').includes('invalid')){await fs.writeFile(get('--inventory-json'),'{}');process.exit(0);}
 await fs.writeFile(get('--inventory-json'),JSON.stringify({version:1,width:4,height:4,source:{path:get('--source'),size:4,mtimeNs:'123'},layers:[{path:'/land',visible:true,supported:true},{path:'/masked',visible:true,supported:false,reason:'Unsupported mask'}]}));
}else{
 const expected=JSON.parse(await fs.readFile(get('--expected-source')));if(get('--source')!==expected.source.path)process.exit(2);
 const recipe=JSON.parse(await fs.readFile(get('--recipe')));if(!recipe.layers['/land'] || recipe.layers['/masked'])process.exit(3);
 await fs.writeFile(get('--output')+'.png',Buffer.from('${png.toString('base64')}','base64'));
 await fs.writeFile(get('--output')+'.map.json',JSON.stringify({version:2,image:'map.png',sourceOffset:[5000,7000]}));
}
`;
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'map-runner-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const exporter=path.join(root,'exporter with spaces.mjs');await fs.writeFile(exporter,fixture);
 return {root,options:{python:process.execPath,exporter},source:path.join(root,'source $(no shell); with spaces.psb')};
}
test('runner inspects and exports the inspected source, validates layers and retries only its own outputs',async t=>{
 const {options,source}=await setup(t),job=await PhotoshopJob.create(options);t.after(()=>job.dispose());
 const result=await job.inspect({source});assert.equal(result.layers.length,2);
 await assert.rejects(job.export({layers:[]}),/at least one/);await assert.rejects(job.export({layers:['/masked']}),/at least one/);
 for(let attempt=0;attempt<2;attempt++){
  const exported=await job.export({layers:['/land'],transparent:true});assert.deepEqual(exported.imageBytes,png);assert.deepEqual(exported.sourceOffset,[5000,7000]);
 }
 const directory=job.directory;await job.dispose();await assert.rejects(fs.stat(directory),{code:'ENOENT'});
 await assert.rejects(job.export({layers:['/land']}),/Load Photoshop layers/);
});
test('runner rejects invalid inventory and requires an absolute configured exporter and local file',async t=>{
 const {options,root}=await setup(t);
 await assert.rejects(PhotoshopJob.create({exporter:'relative.py'}),/absolute/);
 const job=await PhotoshopJob.create(options);t.after(()=>job.dispose());
 await assert.rejects(job.inspect({source:'relative.psd'}),/absolute/);
 await assert.rejects(job.inspect({source:path.join(root,'invalid.psd')}),/Invalid Photoshop layer inventory/);
});
test('subprocess uses literal arguments and environment-only links, redacts bounded error output',async()=>{
 const calls=[],progress=[];
 const spawnProcess=(python,args,options)=>{
  calls.push({python,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  queueMicrotask(()=>{child.stderr.emit('data',Buffer.from('x'.repeat(10000)+'token-secret'));child.emit('close',1);});return child;
 };
 await assert.rejects(runPython('/python with spaces',['--source','$(bad);file.psd'],{spawnProcess,env:{TAELGAR_DROPBOX_LINK:'token-secret'},onProgress:text=>progress.push(text)}),error=>error.message.length<=8192 && error.message.includes('[redacted]') && !error.message.includes('token-secret'));
 assert.equal(calls[0].options.shell,false);assert.equal(calls[0].options.env.TAELGAR_DROPBOX_LINK,'token-secret');assert.deepEqual(calls[0].args,['--source','$(bad);file.psd']);assert.ok(progress.every(text=>!text.includes('token-secret')));
});
test('cancellation waits for subprocess close before rejecting and never starts an already cancelled job',async()=>{
 const controller=new AbortController();let child,started=0,killed=false,closed=false;
 const spawnProcess=()=>{started++;child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed=true;setTimeout(()=>{closed=true;child.emit('close',130);},10);};return child;};
 const pending=runPython('python',[],{signal:controller.signal,spawnProcess});controller.abort();
 await assert.rejects(pending,/cancelled/);assert.ok(killed && closed);
 await assert.rejects(runPython('python',[],{signal:controller.signal,spawnProcess}),/cancelled/);assert.equal(started,1);
});
test('missing executable yields an actionable error',async()=>{
 await assert.rejects(runPython('/not-a-real-python-executable',[]),/Could not start Python/);
});

test('bundled exporter includes maintained sources, recipe and geometry and needs no script override',async t=>{
 const {readMapExporterBundle}=await import('../scripts/build-obsidian.mjs');
 const {exporterFiles,unpackExporter}=await import('../obsidian/taelgarverse/maps/bundled-exporter.mjs');
 const bundle=await readMapExporterBundle(),job=await PhotoshopJob.create({bundle});t.after(()=>job.dispose());
 assert.ok(job.exporter.startsWith(job.directory+path.sep));assert.ok(job.exporter.endsWith('export_core.py'));
 for(const name of exporterFiles)assert.equal(await fs.readFile(path.join(job.directory,'exporter',name),'utf8'),await fs.readFile(new URL('../'+name,import.meta.url),'utf8'));
 await assert.rejects(unpackExporter(job.directory,bundle),{code:'EEXIST'});
 await assert.rejects(PhotoshopJob.create({bundle:{...bundle,'../escape.py':'bad'}}),/incomplete/);
 const directory=job.directory;await job.dispose();await assert.rejects(fs.stat(directory),{code:'ENOENT'});
});
test('Dropbox shared links use environment-only URLs and do not pass API credential arguments',async t=>{
 const {options,root}=await setup(t),job=await PhotoshopJob.create(options);t.after(()=>job.dispose());
 const link='https://www.dropbox.com/scl/fi/example/world.psb?rlkey=private-test-key&dl=0';
 job.run=async(args,env)=>{
  assert.ok(args.includes('--dropbox-link-env'));assert.ok(!args.includes(link));assert.ok(!args.includes('--dropbox-credentials'));assert.ok(!args.includes('--dropbox-root'));assert.equal(env.TAELGAR_DROPBOX_LINK,link);
  await fs.writeFile(args[args.indexOf('--inventory-json')+1],JSON.stringify({version:1,width:4,height:4,source:{path:path.join(root,'cached.psb')},layers:[]}));
 };
 await assert.rejects(job.inspect({source:'/Maps/world.psb',dropbox:true}),/shared-file link/);
 await assert.rejects(job.inspect({source:'id:file',dropbox:true}),/shared-file link/);
 await job.inspect({source:link,dropbox:true});
});
