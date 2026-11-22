import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/config.mjs';
import {buildBrowser} from './build-browser.mjs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const suites=new Map([
  [undefined,'.test.mjs'],
  ['--integration','.integration.mjs'],
  ['--live-vault','.live-vault.mjs'],
  ['--historical-headers','.historical.mjs'],
]);

export function selectTests(files,args=[]){
  const suffix=suites.get(args[0]);
  if(args.length>1 || !suffix)
    throw new Error('Use npm test with at most one of --integration, --live-vault or --historical-headers');
  return files.filter(file=>file.endsWith(suffix)).sort();
}

export async function runTests(args=process.argv.slice(2)){
  const files=selectTests(await fs.readdir(new URL('../tests/',import.meta.url)),args);
  await fs.mkdir(new URL('../.cache/',import.meta.url),{recursive:true});
  if(!args.length || args[0]==='--integration')await buildBrowser();
  // Legacy reference sources are checked-in fixtures. Never rebuild them from
  // local CustomJS or download a reference repository as part of a test run.
  try{execFileSync(process.execPath,['--test',...files.map(file=>'tests/'+file)],{cwd:ROOT,windowsHide:true,stdio:'inherit'});}
  catch(error){process.exitCode=error.status || 1;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await runTests();
