import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildBrowser() {
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
  console.log('Browser diagrams ready: ' + Math.round(result.bytes / 1024) + ' KiB (loaded only on diagram pages)');
}
