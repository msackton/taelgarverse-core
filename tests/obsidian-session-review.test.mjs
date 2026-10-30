import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {ROOT} from '../src/config.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/session-review.mjs'],write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});

function host({requestError,missingStdin=false,basePath='D:/test-vault',renderer=false}={}){
  const {document}=parseHTML('<html><body><main></main></body></html>');
  const diagnostics=[];
  let requests=0,baseStates=0,localCalls=0,launch;
  const response={sessions:[{campaign:'Demo',number:1,stage:'reviewable',sessionYaml:'_sessions/demo/cleaned/demo-session.yaml',entities:2,pending:1}]};
  class ItemView{
    constructor(leaf){this.leaf=leaf;this.app=leaf.app;this.contentEl=document.createElement('div');}
    async open(container){container.append(this.contentEl);await this.onOpen();}
    async setState(){baseStates++;}
  }
  const mockExecFile=(_file,_args,options,callback)=>{
    assert.equal(options.shell,false);assert.equal(options.timeout,60000);assert.equal(options.maxBuffer,16*1024*1024);
    launch={file:_file,cwd:options.cwd};
    if(missingStdin){queueMicrotask(()=>callback(new Error(requestError),'',''));return {kill(){}};}
    const child=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};
    child.stdin.end=()=>{requests++;queueMicrotask(()=>{
      if(requestError)callback(new Error(requestError),'','');
      else callback(null,JSON.stringify(response),'');
    });};return child;
  };
  const mockChildProcess={spawn(){throw new Error('Unexpected alternate spawn');},execFile(...args){localCalls++;return mockExecFile(...args);}};
  const module={exports:{}};
  const globals={module,exports:module.exports,console:{...console,error:(...args)=>diagnostics.push(args)},setTimeout,clearTimeout,setInterval,clearInterval,
    process:renderer?{platform:'win32',type:'renderer',versions:{electron:'43.8.3',node:'24.22.0'},env:process.env}:process,
    window:{},
    require:name=>name==='obsidian'?{Component:class{},ItemView,Platform:{isDesktopApp:true},Setting:class{}}:
      name==='node:child_process'?mockChildProcess:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const app={vault:{adapter:{getBasePath:()=>basePath}},workspace:{}};
  const feature={app,enabled:true,plugin:{settings:{}},request:request=>module.exports.reviewRequest(basePath,undefined,request)},leaf={app,detach(){throw new Error('Unexpected detach');}};
  const view=new module.exports.SessionReviewView(leaf,feature);
  return {view,diagnostics,api:module.exports,root:document.querySelector('main'),get requests(){return requests;},get baseStates(){return baseStates;},get localCalls(){return localCalls;},get launch(){return launch;}};
}

test('Obsidian view startup mounts the session index and survives workspace state restoration',async()=>{
  const h=host();await h.view.open(h.root);await h.view.setState({},{});
  assert.match(h.root.textContent,/Sessions/);assert.match(h.root.textContent,/Demo 1/);assert.equal(h.requests,1);
  h.view.onClose();assert.equal(h.root.textContent,'');
});

test('the real Python subprocess accepts JSON stdin and returns Unicode JSON without a shell',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'taelgar-review-bridge-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const helper=path.join(directory,'.agents/skills/check-session-entities/scripts/entity_review.py');
  await fs.mkdir(path.dirname(helper),{recursive:true});
  await fs.writeFile(helper,"import json,sys\nrequest=json.load(sys.stdin)\nprint(json.dumps({'echo':request,'label':'Ch’ik’a — Yezali'},ensure_ascii=False))\n");
  const module={exports:{}};
  vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,console,setTimeout,clearTimeout,process,
    require:name=>name==='obsidian'?{Component:class{},ItemView:class{},Platform:{isDesktopApp:true},Setting:class{}}:require(name)});
  const result=await module.exports.reviewRequest(directory,process.platform==='win32'?'python':'python3',{command:'index',argument:'a path with spaces'});
  assert.equal(result.echo.argument,'a path with spaces');assert.equal(result.label,'Ch’ik’a — Yezali');
  await fs.writeFile(helper,"import json,sys\njson.load(sys.stdin)\nprint(json.dumps({'error':'A guarded failure'}))\nsys.exit(1)\n");
  await assert.rejects(module.exports.reviewRequest(directory,process.platform==='win32'?'python':'python3',{command:'inspect'}),/A guarded failure/);
  const connection=await module.exports.reviewRequest(directory,process.platform==='win32'?'python':'python3',{command:'connectionCheck'});
  assert.equal(connection.connection,'ok');assert.match(connection.pythonVersion,/^3\./);
  assert.equal(connection.parentPid,process.pid);
});

test('the feature discovers sessions without starting the Python bridge',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'taelgar-native-index-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const h=host({basePath:directory});
  const feature=new h.api.SessionReviewFeature({app:h.view.app,settings:{sessionReviewEnabled:true}});
  const result=await feature.request({command:'index'});assert.equal(result.sessions.length,0);assert.equal(h.requests,0);
});

test('setup inspection records runtime identity without starting a child process',async()=>{
  const h=host(),feature=new h.api.SessionReviewFeature({app:h.view.app,settings:{}});
  const result=await feature.request({command:'connectionInfo'});
  assert.equal(result.appExecutable,process.execPath);assert.equal(result.arch,process.arch);
  assert.match(result.spawnSourceSha256,/^[a-f0-9]{64}$/);assert.equal(h.requests,0);
  assert.deepEqual(Object.keys(result.environmentFlags).sort(),['ELECTRON_RUN_AS_NODE','NODE_CHANNEL_FD','NODE_OPTIONS','UV_THREADPOOL_SIZE']);
});

test('missing Python shows an inline failure instead of a blank Obsidian view',async()=>{
  const h=host({requestError:'spawn python ENOENT'});await h.view.open(h.root);
  assert.match(h.root.textContent,/spawn python ENOENT/);assert.match(h.root.textContent,/Refresh session index/);
  h.view.onClose();
});

test('Windows renderer requests normalize launch paths and work without a remote bridge',async()=>{
  const h=host({renderer:true,basePath:'D:\\test-vault'});await h.view.open(h.root);
  assert.match(h.root.textContent,/Demo 1/);assert.equal(h.localCalls,1);assert.equal(h.requests,1);
  assert.doesNotMatch(h.launch.file,/\\/);assert.equal(h.launch.cwd,'D:/test-vault');
  h.view.onClose();
});

test('Windows launch failures are reported inline without an alternate launch attempt',async()=>{
  const h=host({renderer:true,requestError:'spawn python EACCES'});await h.view.open(h.root);
  assert.match(h.root.textContent,/spawn python EACCES/);assert.equal(h.localCalls,1);
  h.view.onClose();
});

test('an early pipe launch failure without stdin preserves the native error',async()=>{
  const h=host({missingStdin:true,requestError:'spawn python EACCES'});await h.view.open(h.root);
  assert.match(h.root.textContent,/spawn python EACCES/);assert.doesNotMatch(h.root.textContent,/reading 'on'/);
  assert.equal(h.localCalls,1);h.view.onClose();
});

test('workspace state can initialize the view before onOpen without mounting twice',async()=>{
  const h=host();assert.match(h.view.contentEl.textContent,/Opening session review/);
  await h.view.setState({},{});assert.equal(h.baseStates,1);
  await h.view.open(h.root);assert.match(h.root.textContent,/Sessions/);assert.equal(h.requests,1);
  h.view.onClose();
});

test('a startup exception displays a visible explanation and retry control',async()=>{
  const h=host({basePath:null});await h.view.open(h.root);
  assert.match(h.root.textContent,/requires a local desktop vault/);assert.match(h.root.textContent,/Retry opening session review/);
  assert.equal(h.requests,0);assert.equal(h.diagnostics.length,1);h.view.onClose();
});
