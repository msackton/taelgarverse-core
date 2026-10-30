import fs from 'node:fs';
import path from 'node:path';
import {Buffer} from 'node:buffer';

function nativeExecutable(filename){
  let fd;
  try{
    const stat=fs.statSync(filename);
    if(!stat.isFile()||stat.size<2)return false;
    fd=fs.openSync(filename,'r');const magic=Buffer.alloc(2);
    return fs.readSync(fd,magic,0,2,0)===2&&magic.toString('ascii')==='MZ';
  }catch{return false;}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}

// Windows App Execution Aliases can resemble python.exe without being native
// executables. Resolve the interpreter before invoking Electron/libuv.
export function resolvePythonExecutable(requested,{platform=process.platform,env=process.env,
  executable=nativeExecutable,list=folder=>{try{return fs.readdirSync(folder);}catch{return [];}}}={}){
  if(platform!=='win32')return requested||'python3';
  const get=name=>Object.entries(env).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1];
  const name=requested||'python';
  if(/[\\/]/.test(name)||path.win32.isAbsolute(name)){
    if(!path.win32.isAbsolute(name)||!executable(name))throw new Error('Set the Python executable to the absolute path of a working Python .exe in Taelgarverse settings.');
    return name;
  }
  const filename=name.toLowerCase().endsWith('.exe')?name:name+'.exe';
  for(const folder of (get('PATH')||'').split(';').map(value=>value.trim().replace(/^"(.*)"$/,'$1')).filter(Boolean)){
    const candidate=path.win32.join(folder,filename);
    if(path.win32.isAbsolute(candidate)&&executable(candidate))return candidate;
  }
  if(/^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(name)){
    const roots=[get('LOCALAPPDATA')&&path.win32.join(get('LOCALAPPDATA'),'Programs','Python'),get('ProgramFiles'),get('ProgramFiles(x86)')].filter(Boolean);
    for(const root of roots)for(const folder of list(root).filter(value=>/^Python3\d*$/i.test(value)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))){
      const candidate=path.win32.join(root,folder,'python.exe');
      if(executable(candidate))return candidate;
    }
  }
  throw new Error('Python was not found as a native executable. Set its absolute .exe path in Taelgarverse settings.');
}

export function pythonLaunchPaths(executable,cwd,platform=process.platform){
  // Equivalent forward-slash launch paths avoid the path-dependent native
  // process termination observed in the user's Windows Obsidian host.
  const normalize=value=>platform==='win32'&&typeof value==='string'?value.replaceAll('\\','/'):value;
  return {executable:normalize(executable),cwd:normalize(cwd)};
}
