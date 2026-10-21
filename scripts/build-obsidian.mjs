import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {repositoryVersion} from './repository-version.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const pluginSource=path.join(root,'obsidian/taelgarverse');
export const releaseFiles=['main.js','manifest.json','styles.css'];
export async function buildObsidian(output=path.join(root,'dist/obsidian/taelgarverse')){
  const manifest=JSON.parse(await fs.readFile(path.join(pluginSource,'manifest.json'),'utf8'));
  const versions=JSON.parse(await fs.readFile(path.join(pluginSource,'versions.json'),'utf8'));
  if(manifest.id!=='taelgarverse' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || versions[manifest.version]!==manifest.minAppVersion){
    throw new Error('Keep the Taelgarverse manifest and versions.json in agreement; use an x.y.z release version');
  }
  await fs.mkdir(output,{recursive:true});
  await build({absWorkingDir:root,entryPoints:['obsidian/taelgarverse/main.mjs'],outfile:path.join(output,'main.js'),
    bundle:true,platform:'node',format:'cjs',target:'es2022',external:['obsidian','@codemirror/view'],legalComments:'inline',
    footer:{js:'module.exports = module.exports.default;'},logLevel:'silent'});
  let leaflet=await fs.readFile(path.join(root,'node_modules/leaflet/dist/leaflet.css'),'utf8');
  for(const match of [...leaflet.matchAll(/url\(images\/([^)]+)\)/g)]){
    const bytes=await fs.readFile(path.join(root,'node_modules/leaflet/dist/images',match[1]));
    leaflet=leaflet.replace(match[0],'url(data:image/png;base64,'+bytes.toString('base64')+')');
  }
  const styles=await Promise.all(['public/maps.css','public/image-viewer.css','obsidian/taelgarverse/images.css','obsidian/taelgarverse/styles.css','obsidian/taelgarverse/pronunciation.css'].map(file=>fs.readFile(path.join(root,file),'utf8')));
  await fs.writeFile(path.join(output,'styles.css'),[leaflet,...styles].join('\n'));
  for(const file of ['manifest.json','versions.json'])await fs.copyFile(path.join(pluginSource,file),path.join(output,file));
  await fs.copyFile(path.join(root,'LICENSE'),path.join(output,'LICENSE'));
  await fs.copyFile(path.join(pluginSource,'distribution-readme.md'),path.join(output,'README.md'));
  const source=repositoryVersion(root);
  await fs.writeFile(path.join(output,'release.json'),JSON.stringify({plugin:manifest.id,version:manifest.version,
    sourceRepository:'msackton/taelgarverse-core',sourceCommit:source.commit ?? null,sourceDirty:source.dirty ?? null},null,2)+'\n');
  return output;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log('Taelgarverse plugin built: '+await buildObsidian());
