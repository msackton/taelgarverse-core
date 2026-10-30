import {Component,ItemView,Platform,Setting} from 'obsidian';
import {spawn} from 'node:child_process';
import {spawn as unprefixedSpawn} from 'child_process';
import os from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {appendFileSync} from 'node:fs';
import {mountSessionReview} from '../../../src/browser/session-review.mjs';
import {discoverSessionReviews} from './session-review-index.mjs';
import {resolveReviewPython} from './session-review-python.mjs';
import {runReviewProcess,reviewProcessBackend,REVIEW_PROCESS_LIMIT} from './session-review-process.mjs';

export const SESSION_REVIEW_VIEW='taelgar-session-review';
function trace(feature,label){
  try{appendFileSync(path.join(feature.app.vault.adapter.getBasePath(),'.obsidian/plugins/taelgarverse/session-review-debug.log'),label+'\n');}catch{}
}
export function inspectReviewSetup(python){
  let user;
  try{user=os.userInfo().username;}catch{user='unavailable';}
  const flag=name=>process.env[name]==null?null:/^\d+$/.test(process.env[name])?process.env[name]:'set';
  return {executable:resolveReviewPython(python),appExecutable:process.execPath,arch:process.arch,
    electron:process.versions.electron,node:process.versions.node,type:process.type,pid:process.pid,ppid:process.ppid,
    cwd:process.cwd?.(),user,spawnAliasesMatch:spawn===unprefixedSpawn,
    launchBackend:reviewProcessBackend(),
    spawnSourceSha256:createHash('sha256').update(Function.prototype.toString.call(spawn)).digest('hex'),
    nodeOptions:(process.execArgv??[]).filter(arg=>arg.startsWith('--')).map(arg=>arg.split('=')[0]),
    environmentFlags:{UV_THREADPOOL_SIZE:flag('UV_THREADPOOL_SIZE'),NODE_CHANNEL_FD:flag('NODE_CHANNEL_FD'),
      ELECTRON_RUN_AS_NODE:flag('ELECTRON_RUN_AS_NODE'),NODE_OPTIONS:process.env.NODE_OPTIONS!=null}};
}
export async function reviewRequest(vault,python,request){
  const log=label=>{try{appendFileSync(path.join(vault,'.obsidian/plugins/taelgarverse/session-review-debug.log'),label+'\n');}catch{}};
  log('request '+request.command+' '+new Date().toISOString());
  const executable=resolveReviewPython(python),backend=reviewProcessBackend();
  log('runtime '+JSON.stringify({platform:process.platform,node:process.versions?.node,electron:process.versions?.electron,
    type:process.type,sandboxed:process.sandboxed,executable,backend}));
  const helper=path.join(vault,'.agents/skills/check-session-entities/scripts/entity_review.py');
  const args=request.command==='connectionCheck'
    ?['-X','utf8','-B','-c','import json,sys,os; json.load(sys.stdin); print(json.dumps({"connection":"ok","pythonVersion":sys.version.split()[0],"executable":sys.executable,"parentPid":os.getppid()}))']
    :['-X','utf8','-B',helper];
  let stderr='';
  try{
    const result=await runReviewProcess(executable,args,{cwd:vault,windowsHide:true,shell:false,encoding:'utf8',
      env:{...process.env,PYTHONIOENCODING:'utf-8'},timeout:60000,maxBuffer:REVIEW_PROCESS_LIMIT},JSON.stringify(request),log);
    const {error,output}=result;stderr=result.stderr;
    log('process complete '+(error?.code??(error?'error':0))+' stdout length '+(output?.length??0));
    if(error?.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')throw new Error('Review response too large');
    if(error?.killed)throw new Error('Review helper timed out; reload to inspect the current artifact before retrying.');
    if(error&&!output)throw error;
    const value=JSON.parse(output);
    if(value.error||error)throw new Error(value.error||error.message);
    if(value.parentPid)log('Python parent pid '+value.parentPid);
    log('JSON parsed');return value;
  }catch(error){
    log('response error '+error.message);
    throw new Error(error.message+(stderr?'\n'+stderr.slice(-5000):''));
  }
}

export class SessionReviewView extends ItemView{
  constructor(leaf,feature){
    trace(feature,'view constructor before super');
    super(leaf);this.feature=feature;this.saved={};this.closed=false;
    trace(feature,'view constructor content '+this.contentEl.tagName);
    this.contentEl.textContent='Opening session review…';
  }
  getViewType(){return SESSION_REVIEW_VIEW;}
  getDisplayText(){return 'Session review';}
  getIcon(){return 'list-checks';}
  getState(){return this.review?.getState()??this.saved;}
  async setState(state,result){
    trace(this.feature,'view setState');
    this.saved=state??{};
    await super.setState(state,result);
    if(this.closed)return;
    if(this.review)await this.review.restore(this.saved);
    else await this.ensureMounted();
  }
  async onOpen(){
    trace(this.feature,'view onOpen');
    this.closed=false;
    await this.ensureMounted();
  }
  async ensureMounted(){
    trace(this.feature,'ensureMounted '+this.closed+' '+!!this.review);
    if(this.closed)return;
    if(this.review){await this.review.ready;return;}
    if(!this.feature.enabled){this.contentEl.textContent='Enable Session review in Taelgarverse settings to open the hub.';return;}
    this.contentEl.textContent='Opening session review…';
    try{
      const vault=this.app.vault.adapter.getBasePath?.();
      if(typeof vault!=='string'||!vault)throw new Error('The session review hub requires a local desktop vault.');
      this.contentEl.replaceChildren();
      trace(this.feature,'before mount content '+this.contentEl.tagName+' children '+this.contentEl.ownerDocument.body.childElementCount);
      this.review=mountSessionReview(this.contentEl,{
        request:request=>this.feature.request(request),
        open:async(file,line)=>{
          const leaf=this.app.workspace.getLeaf('tab');
          await leaf.openFile(this.app.vault.getAbstractFileByPath(file),line==null?{}:{eState:{line},state:{mode:'source'}});
        },initialState:this.saved,onStartupStep:step=>trace(this.feature,step),
      });
      await this.review.ready;
      trace(this.feature,'mount ready');
    }catch(error){
      trace(this.feature,'mount failure '+error.message);
      console.error('Taelgarverse session review failed to open',error);
      this.review?.dispose();this.review=null;
      if(this.closed)return;
      this.contentEl.textContent='Session review could not start: '+error.message;
      const retry=this.contentEl.ownerDocument.createElement('button');
      retry.type='button';retry.textContent='Retry opening session review';
      retry.addEventListener('click',()=>void this.ensureMounted());this.contentEl.append(retry);
    }
  }
  onClose(){this.saved=this.getState();this.closed=true;this.review?.dispose();this.review=null;}
}

export class SessionReviewFeature extends Component{
  constructor(plugin){super();this.plugin=plugin;this.app=plugin.app;}
  get enabled(){return Platform.isDesktopApp&&this.plugin.settings.sessionReviewEnabled===true;}
  request(request){
    if(request.command==='index')return discoverSessionReviews(this.app.vault.adapter.getBasePath());
    if(request.command==='connectionInfo'){
      const result=inspectReviewSetup(this.plugin.settings.sessionReviewPython);
      trace(this,'setup '+JSON.stringify(result));return Promise.resolve(result);
    }
    return reviewRequest(this.app.vault.adapter.getBasePath(),this.plugin.settings.sessionReviewPython,request);
  }
  onload(){
    this.plugin.registerView(SESSION_REVIEW_VIEW,leaf=>new SessionReviewView(leaf,this));
    this.plugin.addCommand({id:'open-session-entity-review',name:'Open session review',checkCallback:checking=>{
      if(!this.enabled)return false;if(!checking)void this.open();return true;
    }});
  }
  async open(){
    trace(this,'feature open');
    let leaf=this.app.workspace.getLeavesOfType(SESSION_REVIEW_VIEW)[0];
    trace(this,'existing leaf '+!!leaf);
    if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:SESSION_REVIEW_VIEW,active:true});}
    trace(this,'leaf state '+leaf.view?.getViewType());
    await this.app.workspace.revealLeaf(leaf);
    await leaf.loadIfDeferred?.();
    if(leaf.view instanceof SessionReviewView)await leaf.view.ensureMounted();
  }
  renderSettings(container){
    new Setting(container).setName('Session review').setHeading();
    new Setting(container).setName('Enable session review')
      .setDesc('Experimental desktop session index, transcript fixes, and entity decisions. Requires Python 3.9+ and the vault’s session-review helpers.')
      .addToggle(toggle=>toggle.setValue(this.enabled).onChange(async value=>{
        this.plugin.settings.sessionReviewEnabled=value;await this.plugin.saveData(this.plugin.settings);
        if(!value)this.app.workspace.detachLeavesOfType?.(SESSION_REVIEW_VIEW);
      }));
    new Setting(container).setName('Session review Python executable')
      .setDesc('Executable name or absolute path. On Windows, resolves an installed native Python .exe; elsewhere defaults to python3.')
      .addText(text=>text.setValue(this.plugin.settings.sessionReviewPython??'').onChange(async value=>{
        this.plugin.settings.sessionReviewPython=value.trim();await this.plugin.saveData(this.plugin.settings);
      }));
  }
  onunload(){this.app.workspace.detachLeavesOfType?.(SESSION_REVIEW_VIEW);}
}
