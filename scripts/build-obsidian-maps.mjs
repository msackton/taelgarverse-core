import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildObsidianMaps(output=path.join(root,'dist/obsidian/taelgar-map-tools')){
  await fs.mkdir(output,{recursive:true});
  await build({absWorkingDir:root,entryPoints:['obsidian/taelgar-map-tools/main.mjs'],outfile:path.join(output,'main.js'),
    bundle:true,platform:'node',format:'cjs',target:'es2022',external:['obsidian'],legalComments:'inline',
    footer:{js:'module.exports = module.exports.default;'},logLevel:'silent'});
  let leaflet=await fs.readFile(path.join(root,'node_modules/leaflet/dist/leaflet.css'),'utf8');
  for(const match of [...leaflet.matchAll(/url\(images\/([^)]+)\)/g)]){
    const bytes=await fs.readFile(path.join(root,'node_modules/leaflet/dist/images',match[1]));
    leaflet=leaflet.replace(match[0],'url(data:image/png;base64,'+bytes.toString('base64')+')');
  }
  const styles=await Promise.all(['public/maps.css','obsidian/taelgar-map-tools/styles.css'].map(file=>fs.readFile(path.join(root,file),'utf8')));
  await fs.writeFile(path.join(output,'styles.css'),[leaflet,...styles].join('\n'));
  await fs.copyFile(path.join(root,'obsidian/taelgar-map-tools/manifest.json'),path.join(output,'manifest.json'));
  return output;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log('Obsidian map plugin built: '+await buildObsidianMaps());
