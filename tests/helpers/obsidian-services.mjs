// Bundle the real services into the same mocked Obsidian host as each feature.
export const serviceExports="export * from './obsidian/taelgarverse/services/snapshots.mjs'; export * from './obsidian/taelgarverse/services/dates.mjs'; export * from './obsidian/taelgarverse/services/indexes.mjs';";
export function attachServices(plugin,api){
  plugin.snapshots=new api.ObsidianSnapshotService(plugin.app);plugin.snapshots.load?plugin.snapshots.load():plugin.snapshots.onload();
  plugin.dates=new api.ObsidianDateService(plugin.app);plugin.dates.load?plugin.dates.load():plugin.dates.onload();
  return ()=>{plugin.snapshots.unload();plugin.dates.unload();};
}
