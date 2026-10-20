import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildBrowser() {
  await build({absWorkingDir:root,entryPoints:['src/browser/images.mjs'],outfile:path.join(root,'public/generated/image-viewer.js'),
    bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'inline',logLevel:'silent'});
  await build({absWorkingDir:root,entryPoints:['src/browser/maps.mjs'],outfile:path.join(root,'public/generated/maps.js'),
    bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline',logLevel:'silent'});
  // Inline the optional Leaflet control icons so CSS never requests unmapped
  // relative image paths from the theme endpoint.
  let css = await fs.readFile(path.join(root,'node_modules/leaflet/dist/leaflet.css'),'utf8');
  for (const match of [...css.matchAll(/url\(images\/([^)]+)\)/g)]) {
    const bytes = await fs.readFile(path.join(root,'node_modules/leaflet/dist/images',match[1]));
    css = css.replace(match[0],'url(data:image/png;base64,' + bytes.toString('base64') + ')');
  }
  await fs.writeFile(path.join(root,'public/generated/leaflet.css'),css);
  const filename = path.join(root, 'public/generated/diagrams.js');
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/browser/diagrams.mjs'],
    outfile: filename,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'inline',
    write: false,
    logLevel: 'silent',
  });
  const bytes = result.outputFiles[0].contents;
  await fs.mkdir(path.dirname(filename), {recursive: true});
  let previous;
  try { previous = await fs.readFile(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!previous?.equals(Buffer.from(bytes))) await fs.writeFile(filename, bytes);
  return {filename, bytes: bytes.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await buildBrowser();
  console.log('Browser maps and diagrams ready (loaded only on pages that use them); diagrams: ' + Math.round(result.bytes / 1024) + ' KiB');
}
