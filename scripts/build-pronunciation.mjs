import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {ROOT} from '../src/config.mjs';
const output = path.join(ROOT, '.cache/pronunciation-plugin/taelgar-pronunciation');
await fs.mkdir(output, {recursive: true});
await build({absWorkingDir: ROOT, entryPoints: ['experiments/pronunciation/obsidian/main.mjs'], outfile: path.join(output, 'main.js'), bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', external: ['obsidian', '@codemirror/view'], footer: {js: 'module.exports = module.exports.default;'}, logLevel: 'silent'});
for (const file of ['manifest.json', 'styles.css']) await fs.copyFile(path.join(ROOT, 'experiments/pronunciation/obsidian', file), path.join(output, file));
console.log('Obsidian plugin built: ' + output);
