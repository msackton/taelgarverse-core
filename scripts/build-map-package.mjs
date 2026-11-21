import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildMapPackage(output=path.join(root,'.cache/packages/maps')) {
  await fs.mkdir(path.join(output,'dist'),{recursive:true});
  await build({absWorkingDir:root,entryPoints:{viewer:'src/browser/map-view.mjs',coordinates:'packages/maps/coordinates.mjs',sketch:'src/map-sketch.mjs'},
    outdir:path.join(output,'dist'),bundle:true,format:'esm',platform:'browser',target:'es2022',external:['leaflet'],
    legalComments:'inline',logLevel:'silent'});
  let leaflet=await fs.readFile(path.join(root,'node_modules/leaflet/dist/leaflet.css'),'utf8');
  for(const match of [...leaflet.matchAll(/url\(images\/([^)]+)\)/g)]){
    const bytes=await fs.readFile(path.join(root,'node_modules/leaflet/dist/images',match[1]));
    leaflet=leaflet.replace(match[0],'url(data:image/png;base64,'+bytes.toString('base64')+')');
  }
  await fs.writeFile(path.join(output,'dist/styles.css'),leaflet+'\n'+await fs.readFile(path.join(root,'public/maps.css'),'utf8'));
  for(const name of ['viewer.d.ts','sketch.d.ts'])await fs.copyFile(path.join(root,'packages/maps',name),path.join(output,'dist',name));
  for(const name of ['package.json','README.md'])await fs.copyFile(path.join(root,'packages/maps',name),path.join(output,name));
  await fs.copyFile(path.join(root,'LICENSE'),path.join(output,'LICENSE'));
  return output;
}
export async function packMapPackage() {
  const output=await buildMapPackage(),destination=path.dirname(output);
  const result=JSON.parse(execFileSync(process.platform==='win32'?'npm.cmd':'npm',['pack',output,'--json','--pack-destination',destination],{cwd:root,encoding:'utf8',windowsHide:true}));
  return path.join(destination,result[0].filename);
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  console.log(process.argv.includes('--pack')?await packMapPackage():await buildMapPackage());
