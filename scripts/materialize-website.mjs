import {materializeWebsiteDataview} from './materialize-website-dataview.mjs';
import {exportDataview} from './export-dataview.mjs';

// Both engines replace only DQL. Website conversion and native rendering remain
// separate from the desktop materializer's full static-site export mode.
export async function materializeWebsite(store,options,dependencies={}) {
  const backend=options.materializer ?? 'node';
  if(backend==='node')return materializeWebsiteDataview(store,options,dependencies);
  if(backend==='obsidian')return exportDataview(store,options,dependencies);
  throw new Error('Unknown website materializer: '+backend+'. Choose node or obsidian.');
}
