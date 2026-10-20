import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,isInside} from '../src/config.mjs';

const run = promisify(exec);

test('Wrangler custom build produces map and diagram assets without a prior local build or vault',async t=>{
  const cache = path.join(ROOT,'.cache');
  await fs.mkdir(cache,{recursive:true});
  const directory = await fs.mkdtemp(path.join(cache,'browser-build-test-'));
  t.after(async()=>{
    const resolved = await fs.realpath(directory);
    assert.ok(isInside(await fs.realpath(cache),resolved));
    // Remove the dependency junction before cleaning up the isolated checkout.
    await fs.unlink(path.join(resolved,'node_modules'));
    await fs.rm(resolved,{recursive:true});
  });
  await fs.symlink(path.join(ROOT,'node_modules'),path.join(directory,'node_modules'),'junction');
  await fs.mkdir(path.join(directory,'scripts'));
  for (const file of ['build-browser.mjs','build-core-release.mjs','repository-version.mjs']) {
    await fs.copyFile(path.join(ROOT,'scripts',file),path.join(directory,'scripts',file));
  }
  await fs.cp(path.join(ROOT,'src/browser'),path.join(directory,'src/browser'),{recursive:true});
  for(const file of ['map-distance.mjs','map-path.mjs'])await fs.copyFile(path.join(ROOT,'src',file),path.join(directory,'src',file));
  const config = JSON.parse(await fs.readFile(path.join(ROOT,'wrangler.json'),'utf8'));
  await run(config.build.command,{cwd:directory,windowsHide:true});
  for (const file of ['maps.js','leaflet.css','diagrams.js','image-viewer.js']) {
    assert.ok((await fs.stat(path.join(directory,'public/generated',file))).size>0,file+' is packaged');
  }
  assert.match(await fs.readFile(path.join(directory,'.generated/core-release.mjs'),'utf8'),/"commit":"[a-f0-9]{40}"/);
});
