import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../src/config.mjs';
import {buildRuntime} from './build-runtime.mjs';

const {output,revision}=buildRuntime();
fs.copyFileSync(path.join(output,'headers.mjs'),path.join(ROOT,'tests/helpers/legacy-headers/generated.mjs'));
console.log('Historical header reference updated: '+revision.slice(0,12));
