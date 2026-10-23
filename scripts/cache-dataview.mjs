import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DATAVIEW_RELEASE,ensureCachedDataview} from '../src/dataview-node/bundle.mjs';

const help='Usage: node scripts/cache-dataview.mjs\nDownload and verify pinned Dataview '+DATAVIEW_RELEASE.version+' in the local cache, without building or publishing content.';
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if(process.argv.length===3 && ['--help','-h'].includes(process.argv[2]))console.log(help);
    else {
      if(process.argv.length!==2)throw new Error(help);
      const directory=await ensureCachedDataview({log:console.log});
      console.log('Dataview cache ready: '+directory);
    }
  } catch(error){console.error(error.message);process.exitCode=1;}
}
