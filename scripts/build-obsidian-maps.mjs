// Compatibility entry point: Map Tools is now the Maps feature of Taelgarverse.
import {buildObsidian} from './build-obsidian.mjs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export {buildObsidian as buildObsidianMaps};
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log('Taelgarverse plugin built: '+await buildObsidian());
