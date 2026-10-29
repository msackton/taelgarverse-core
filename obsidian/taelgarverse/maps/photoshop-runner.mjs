import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {MAX_MAP_PNG_BYTES,mapPngInfo} from './create-map-files.mjs';

const cancelled=()=>new Error('Photoshop export cancelled.');
const privateKeys=['DROPBOX_ACCESS_TOKEN','DROPBOX_APP_KEY','DROPBOX_APP_SECRET','DROPBOX_REFRESH_TOKEN'];

// No shell, no credentials in arguments, and bounded output even for very large PSDs.
export function runPython(python,args,{signal,env=process.env,onProgress=()=>{},spawnProcess=spawn}={}){
  if(signal?.aborted)return Promise.reject(cancelled());
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(python,args,{shell:false,windowsHide:true,env,stdio:['ignore','pipe','pipe']});
    let tail='',timer,spawnError;
    const redact=value=>privateKeys.reduce((text,key)=>env[key]?text.split(env[key]).join('[redacted]'):text,value);
    const output=data=>{tail=(tail+data.toString()).slice(-8192);onProgress(redact(tail));};
    child.stdout.on('data',output);child.stderr.on('data',output);
    const abort=()=>{child.kill('SIGTERM');timer=setTimeout(()=>child.kill('SIGKILL'),2000);timer.unref?.();};
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',error=>{spawnError=error;});
    child.on('close',code=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(signal?.aborted)reject(cancelled());
      else if(spawnError)reject(new Error('Could not start Python. Check the executable in Taelgarverse settings.'));
      else if(code!==0)reject(new Error(redact(tail.trim()) || `Python exporter exited with code ${code}.`));
      else resolve();
    });
    if(signal?.aborted)abort();
  });
}

async function readBounded(file,limit){
  const handle=await fs.open(file,'r');
  try{
    const stat=await handle.stat();
    if(!stat.isFile() || stat.size>limit)throw new Error('Exporter output exceeds the supported file size.');
    const bytes=Buffer.alloc(stat.size+1);let length=0;
    while(length<bytes.length){const {bytesRead}=await handle.read(bytes,length,bytes.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    if(length!==stat.size)throw new Error('Exporter output changed while reading it.');
    return bytes.subarray(0,length);
  }finally{await handle.close();}
}

export async function checkCredentialsFile(filename,vaultRoot){
  if(!filename)return '';
  if(!path.isAbsolute(filename))throw new Error('Dropbox credential file must have an absolute path outside the vault.');
  const real=await fs.realpath(filename);
  if(vaultRoot){
    const root=await fs.realpath(vaultRoot);
    for(const candidate of [path.resolve(filename),real]){
      const relative=path.relative(root,candidate);
      if(!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative)))throw new Error('Move the Dropbox credential file outside the vault before using it.');
    }
  }
  return real;
}

export class PhotoshopJob {
  static async create({python,exporter,credentialsFile='',vaultRoot,token='',onProgress=()=>{}}){
    if(!exporter || !path.isAbsolute(exporter))throw new Error('Set the absolute Python exporter script path in Taelgarverse settings first.');
    if(!(await fs.stat(exporter)).isFile())throw new Error('Python exporter script was not found.');
    const credentials=await checkCredentialsFile(credentialsFile,vaultRoot);
    if(/[\r\n]/.test(token))throw new Error('Invalid Dropbox access token.');
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'taelgar-map-'));
    return new PhotoshopJob({python:python || (process.platform==='win32'?'python':'python3'),exporter,credentials,token,onProgress,directory});
  }
  constructor(options){Object.assign(this,options);this.controller=new AbortController();this.pending=null;this.inventory=null;}
  async run(args){
    if(this.controller.signal.aborted)throw cancelled();
    if(this.pending)throw new Error('A Photoshop operation is already running.');
    const env={...process.env,PYTHONUNBUFFERED:'1'};
    if(this.token)env.DROPBOX_ACCESS_TOKEN=this.token;
    const pending=runPython(this.python,[this.exporter,...args],{signal:this.controller.signal,env,onProgress:this.onProgress});
    this.pending=pending;
    try{await pending;}finally{this.pending=null;}
  }
  async inspect({source,dropbox=false,namespace=''}){
    if(this.inventory)throw new Error('Create a new inspection to reload Photoshop layers.');
    source=source.trim();
    if(!source || (!dropbox && !path.isAbsolute(source)))throw new Error('Enter an absolute local PSD/PSB path, or choose a Dropbox source.');
    const args=dropbox?['--dropbox-path',source,'--cache-dir',path.join(os.tmpdir(),'taelgarverse-dropbox')]:['--source',source];
    if(dropbox && this.credentials)args.push('--dropbox-credentials',this.credentials);
    if(dropbox && namespace.trim())args.push('--dropbox-root',namespace.trim());
    const filename=path.join(this.directory,'inventory.json');
    await this.run([...args,'--inventory-json',filename]);
    const value=JSON.parse(await readBounded(filename,2*1024*1024));
    if(value.version!==1 || !path.isAbsolute(value.source?.path??'') || !Array.isArray(value.layers) || value.layers.length>4096 || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width<=0 || value.height<=0 || value.width>50000 || value.height>50000 || value.width*value.height>250000000 || value.layers.some(row=>typeof row.path!=='string' || !row.path.startsWith('/') || typeof row.visible!=='boolean' || typeof row.supported!=='boolean'))throw new Error('Invalid Photoshop layer inventory; update the Python exporter checkout.');
    this.inventory=value;return value;
  }
  async export({layers,topLeft='',bottomRight='',transparent=false}){
    if(!this.inventory)throw new Error('Load Photoshop layers first.');
    const known=new Map(this.inventory.layers.map(row=>[row.path,row]));
    if(!Array.isArray(layers) || !layers.length || layers.some(name=>!known.get(name)?.supported))throw new Error('Select at least one supported drawable layer.');
    if(this.controller.signal.aborted)throw cancelled();
    if(this.pending)throw new Error('A Photoshop operation is already running.');
    // Only this job's own generated files may be replaced for a retry.
    await fs.rm(path.join(this.directory,'map.png'),{force:true});
    await fs.rm(path.join(this.directory,'map.map.json'),{force:true});
    const recipe=path.join(this.directory,'recipe.json');
    await fs.writeFile(recipe,JSON.stringify({layers:Object.fromEntries(this.inventory.layers.map(row=>[row.path,layers.includes(row.path)]))}));
    const output=path.join(this.directory,'map');
    const args=['--source',this.inventory.source.path,'--expected-source',path.join(this.directory,'inventory.json'),'--recipe',recipe,'--output',output];
    if(topLeft.trim())args.push('--top-left',topLeft.trim());
    if(bottomRight.trim())args.push('--bottom-right',bottomRight.trim());
    if(transparent)args.push('--transparent');
    await this.run(args);
    const manifest=JSON.parse(await readBounded(output+'.map.json',65536));
    if(manifest.version!==2 || manifest.image!=='map.png' || !Array.isArray(manifest.sourceOffset) || manifest.sourceOffset.length!==2 || manifest.sourceOffset.some(n=>!Number.isInteger(n) || n<0 || n>100000))throw new Error('Invalid map manifest from the Python exporter.');
    const imageBytes=await readBounded(output+'.png',MAX_MAP_PNG_BYTES);mapPngInfo(imageBytes);
    return {imageBytes,sourceOffset:manifest.sourceOffset};
  }
  async dispose(){
    this.controller.abort();
    await this.pending?.catch(()=>{});
    this.token='';this.inventory=null;
    await fs.rm(this.directory,{recursive:true,force:true});
  }
}
