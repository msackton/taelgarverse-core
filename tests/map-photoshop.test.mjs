import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import sharp from 'sharp';
import {PhotoshopJob,runPython} from '../obsidian/taelgarverse/maps/photoshop-runner.mjs';
import {exporterFiles} from '../obsidian/taelgarverse/maps/bundled-exporter.mjs';
import {resolvePythonExecutable} from '../obsidian/taelgarverse/python-runtime.mjs';

const png=await sharp({create:{width:4,height:4,channels:4,background:'transparent'}}).png().toBuffer();
const fixture=`import json,sys,base64
from pathlib import Path
args=sys.argv[1:]
def get(flag): return args[args.index(flag)+1]
if '--inventory-json' in args:
    if 'invalid' in get('--source'):
        Path(get('--inventory-json')).write_text('{}',encoding='utf-8')
        sys.exit(0)
    value={'version':1,'width':4,'height':4,'source':{'path':get('--source'),'size':4,'mtimeNs':'123'},'layers':[{'path':'/land','visible':True,'supported':True},{'path':'/masked','visible':True,'supported':False,'reason':'Unsupported mask'}]}
    Path(get('--inventory-json')).write_text(json.dumps(value),encoding='utf-8')
else:
    expected=json.loads(Path(get('--expected-source')).read_text(encoding='utf-8'))
    if get('--source')!=expected['source']['path']: sys.exit(2)
    recipe=json.loads(Path(get('--recipe')).read_text(encoding='utf-8'))
    if not recipe['layers']['/land'] or recipe['layers']['/masked']: sys.exit(3)
    Path(get('--output')+'.png').write_bytes(base64.b64decode('${png.toString('base64')}'))
    Path(get('--output')+'.map.json').write_text(json.dumps({'version':2,'image':'map.png','sourceOffset':[5000,7000]}),encoding='utf-8')
`;
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'map-runner-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const bundle=Object.fromEntries(exporterFiles.map(name=>[name,name.endsWith('export_core.py')?fixture:'']));
 return {root,options:{python:resolvePythonExecutable(),bundle},source:path.join(root,'source $(no shell); with spaces.psb')};
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
test('runner rejects invalid inventory and requires an absolute local file',async t=>{
 const {options,root}=await setup(t);
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
 await assert.rejects(runPython(process.execPath,['--source','$(bad);file.psd'],{spawnProcess,env:{TAELGAR_DROPBOX_LINK:'token-secret'},onProgress:text=>progress.push(text)}),error=>error.message.length<=8192 && error.message.includes('[redacted]') && !error.message.includes('token-secret'));
 assert.equal(calls[0].options.shell,false);assert.equal(calls[0].options.env.TAELGAR_DROPBOX_LINK,'token-secret');assert.deepEqual(calls[0].args,['--source','$(bad);file.psd']);assert.ok(progress.every(text=>!text.includes('token-secret')));
});
test('cancellation waits for subprocess close before rejecting and never starts an already cancelled job',async()=>{
 const controller=new AbortController();let child,started=0,killed=false,closed=false;
 const spawnProcess=()=>{started++;child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed=true;setTimeout(()=>{closed=true;child.emit('close',130);},10);};return child;};
 const pending=runPython(process.execPath,[],{signal:controller.signal,spawnProcess});controller.abort();
 await assert.rejects(pending,/cancelled/);assert.ok(killed && closed);
 await assert.rejects(runPython('python',[],{signal:controller.signal,spawnProcess}),/cancelled/);assert.equal(started,1);
});
test('missing executable yields an actionable error',async()=>{
 await assert.rejects(runPython('/not-a-real-python-executable',[]),/Could not start Python/);
});

test('bundled exporter includes maintained sources, recipe and geometry and ignores legacy script overrides',async t=>{
 const {readMapExporterBundle}=await import('../scripts/build-obsidian.mjs');
 const {exporterFiles,unpackExporter}=await import('../obsidian/taelgarverse/maps/bundled-exporter.mjs');
 const bundle=await readMapExporterBundle(),job=await PhotoshopJob.create({bundle,exporter:'missing-old-checkout.py'});t.after(()=>job.dispose());
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

test('layer inspection and export normalize Python launch paths while preserving literal exporter arguments',async()=>{
 const calls=[],normalize=value=>process.platform==='win32'?value.replaceAll('\\','/'):value;
 const spawnProcess=(python,args,options)=>{
  calls.push({python,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  queueMicrotask(()=>child.emit('close',0));return child;
 };
 const exporter='D:\\Exporter checkout\\export_core.py',source='D:\\Artwork\\source $(literal);.psb';
 for(const args of [[exporter,'--source',source,'--inventory-json','inventory.json'],[exporter,'--source',source,'--output','map']]){
  await runPython(process.execPath,args,{spawnProcess});
  const call=calls.at(-1);assert.equal(call.python,normalize(process.execPath));assert.equal(call.options.cwd,normalize(process.cwd()));
  assert.deepEqual(call.args,args);assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);
 }
 assert.equal(calls.length,2);
});

test('an early launch error without stdout or stderr remains an actionable Python error',async()=>{
 const spawnProcess=()=>{const child=new EventEmitter();queueMicrotask(()=>{child.emit('error',new Error('ENOENT'));child.emit('close',-2);});return child;};
 await assert.rejects(runPython(process.execPath,[],{spawnProcess}),/Could not start Python/);
});
