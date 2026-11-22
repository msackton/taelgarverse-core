import fs from 'node:fs';
import path from 'node:path';
import {buildRuntime} from './build-runtime.mjs';

const {output,revision}=buildRuntime();
fs.copyFileSync(path.join(output,'headers.mjs'),new URL('./generated.mjs',import.meta.url));
console.log('Historical header reference updated: '+revision.slice(0,12));
