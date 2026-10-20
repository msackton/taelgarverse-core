import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/config.mjs';
import {buildRuntime} from './build-runtime.mjs';
import {buildBrowser} from './build-browser.mjs';

const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--integration'))throw new Error('Use npm test [-- --integration]');
await fs.mkdir(new URL('../.cache/',import.meta.url),{recursive:true});
buildRuntime();await buildBrowser();
const suffix=args.includes('--integration')?'.integration.mjs':'.test.mjs';
const files=(await fs.readdir(new URL('../tests/',import.meta.url))).filter(file=>file.endsWith(suffix)).sort();
try{execFileSync(process.execPath,['--test',...files.map(file=>'tests/'+file)],{cwd:ROOT,windowsHide:true,stdio:'inherit'});}
catch(error){process.exitCode=error.status || 1;}
