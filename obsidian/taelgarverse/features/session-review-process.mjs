import {execFile} from 'node:child_process';
import {pythonLaunchPaths} from '../python-runtime.mjs';

export {pythonLaunchPaths as reviewLaunchPaths} from '../python-runtime.mjs';

export const REVIEW_PROCESS_LIMIT=16*1024*1024;
export function reviewProcessBackend(){return process.platform==='win32'?'windows-normalized':'local-node';}
const timeoutError=()=>new Error('Review helper timed out; reload to inspect the current artifact before retrying.');

export function runReviewProcess(executable,args,options,request,log=()=>{}){
  const launch=pythonLaunchPaths(executable,options.cwd);
  return new Promise((resolve,reject)=>{
    let child,input,timer,settled=false;
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);input?.removeListener('error',inputError);
      input=null;child=null;error?reject(error):resolve(result);
    };
    const inputError=error=>finish(error);
    timer=setTimeout(()=>{try{child?.kill();}catch{}finish(timeoutError());},(options.timeout??60000)+5000);
    try{
      log('before execFile '+reviewProcessBackend());
      child=execFile(launch.executable,args,{...options,cwd:launch.cwd},(error,output,stderr)=>finish(null,{error,output,stderr}));
      log('after execFile '+reviewProcessBackend());
      if(settled)return;
      input=child?.stdin;
      // Early native launch failures can return before stdin exists. Preserve
      // the OS error delivered by execFile's already-installed callback.
      if(!input){log('no stdin; awaiting execFile callback');return;}
      input.on('error',inputError);input.end(request);
    }catch(error){finish(error);}
  });
}
