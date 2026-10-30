import fs from 'node:fs/promises';
import path from 'node:path';

// Embed the maintained sources in main.js: BRAT only needs its usual assets.
export const exporterFiles=[
  'scripts/map-export/export_core.py',
  'scripts/map-export/map_coordinates.py',
  'scripts/map-export/dropbox_link.py',
  'scripts/map-export/taelgar-core.recipe.json',
  'scripts/map-export/requirements.txt',
  'src/map-geometry.json',
];
export const bundledExporter=typeof __TAELGAR_MAP_EXPORTER__==='undefined'?null:__TAELGAR_MAP_EXPORTER__;

export async function unpackExporter(directory,files=bundledExporter){
  if(!files || Object.keys(files).length!==exporterFiles.length || exporterFiles.some(name=>typeof files[name]!=='string'))
    throw new Error('The bundled Photoshop exporter is missing or incomplete. Reinstall the plugin, or configure an exporter override.');
  // Paths are fixed by the plugin, never supplied by notes or downloaded files.
  for(const name of exporterFiles){
    const target=path.join(directory,'exporter',name);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,files[name],{flag:'wx'});
  }
  return path.join(directory,'exporter','scripts','map-export','export_core.py');
}
