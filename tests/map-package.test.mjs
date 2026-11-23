import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {packMapPackage} from '../scripts/build-map-package.mjs';
import {ROOT} from '../src/config.mjs';

// Package installation must work with no relative access to the source checkout.
test('packed map package bundles independently with a DOM-free coordinates entry and complete CSS',async t=>{
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const temporary=await fs.mkdtemp(path.join(ROOT,'.cache/map-package-'));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const archive=await packMapPackage(path.join(temporary,'staging with spaces'));
  execFileSync('tar',['-xzf',archive,'-C',temporary],{windowsHide:true});
  const output=path.join(temporary,'package');
  const members=(await fs.readdir(output,{recursive:true})).map(file=>file.split(path.sep).join('/'));
  for(const file of ['package.json','README.md','LICENSE','dist/viewer.js','dist/coordinates.js','dist/sketch.js','dist/viewer.d.ts','dist/sketch.d.ts','dist/styles.css'])assert.ok(members.includes(file),file);
  assert.ok(!members.some(file=>file.startsWith('src/') || file.startsWith('node_modules/')));
  const coordinates=await import(pathToFileURL(path.join(output,'dist/coordinates.js')));
  assert.deepEqual(coordinates.coreToLatLng([10,20],480),[460,10]);
  assert.equal(coordinates.routeDistance([{lat:0,lng:0},{lat:40,lng:30}],{xScale:.6,yScale:.6}),30);
  assert.equal(coordinates.MAP_SCALE.milesPerPixel,.6);
  const sketch=await import(pathToFileURL(path.join(output,'dist/sketch.js')));assert.deepEqual(sketch.applySketchCommand([],{type:'clearDrawings'}),[]);
  const css=await fs.readFile(path.join(output,'dist/styles.css'),'utf8');assert.match(css,/\.leaflet-container/);assert.match(css,/\.map-measure-controls/);assert.match(css,/\.map-widget-header/);assert.doesNotMatch(css,/url\(images\//);
  const viewer=await build({absWorkingDir:output,entryPoints:['dist/viewer.js'],bundle:true,write:false,platform:'browser',format:'esm',external:['leaflet'],metafile:true,logLevel:'silent'});
  assert.match(viewer.outputFiles[0].text,/mountMap/);assert.doesNotMatch(viewer.outputFiles[0].text,/node:|from "\.\.\//);
  assert.ok(Object.keys(viewer.metafile.inputs).every(file=>file.startsWith('dist/')),'consumer needs only the packed files');
});
