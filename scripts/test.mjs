import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/config.mjs';
import {buildBrowser} from './build-browser.mjs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function selectTests(files,args=[]){
  if(args.length>1 || args.some(arg=>!['--integration','--live-vault'].includes(arg)))
    throw new Error('Use npm test, npm test -- --integration, or npm test -- --live-vault');
  const suffix=args[0]==='--integration'?'.integration.mjs':args[0]==='--live-vault'?'.live-vault.mjs':'.test.mjs';
  return files.filter(file=>file.endsWith(suffix)).sort();
}

export async function runTests(args=process.argv.slice(2)){
  const files=selectTests(await fs.readdir(new URL('../tests/',import.meta.url)),args);
  await fs.mkdir(new URL('../.cache/',import.meta.url),{recursive:true});
  if(!args.includes('--live-vault'))await buildBrowser();
  // Legacy reference sources are checked-in fixtures. Never rebuild them from
  // local CustomJS or download a reference repository as part of a test run.
  try{execFileSync(process.execPath,['--test',...files.map(file=>'tests/'+file)],{cwd:ROOT,windowsHide:true,stdio:'inherit'});}
  catch(error){process.exitCode=error.status || 1;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await runTests();
