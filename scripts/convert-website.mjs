import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {convertWebsiteNote} from '../src/website-compatibility.mjs';
import {cleanupPublicationNote} from '../src/publication-markdown.mjs';
import {loadSettings,isInside,ROOT} from '../src/config.mjs';
import {Store} from '../src/store.mjs';

export async function convertWebsiteStore(store,{log=()=>{}}={}) {
  const report={schemaVersion:1,changes:[],unconverted:[],dataviewJsBlocksRemoved:0,sectionsRemoved:0};
  for(const entry of store.entries)if(entry.note) {
    try {
      const converted=convertWebsiteNote(entry.note,{sourcePath:entry.id,resolveTarget:target=>store.lookup(target).entry?.note?.metadata}),cleaned=cleanupPublicationNote(converted.note);
      entry.note=cleaned.note;report.changes.push(...converted.changes);report.unconverted.push(...converted.unconverted);
      report.dataviewJsBlocksRemoved+=cleaned.dataviewJsBlocksRemoved;report.sectionsRemoved+=cleaned.sectionsRemoved;
    } catch(error){throw new Error(entry.id+': '+error.message,{cause:error});}
  }
  log('Website conversion: '+report.changes.length+' known patterns converted; '+report.dataviewJsBlocksRemoved+' unmatched JavaScript blocks omitted by publication policy.');
  return report;
}

export async function saveWorkingNotes(store) {
  const original=await fs.realpath(store.settings.vault_dir),working=await fs.realpath(store.settings.source_dir);
  if(!isInside(ROOT,working) || working===ROOT || isInside(original,working) || isInside(working,original))throw new Error('Converted notes must be written to a separate working vault inside core.');
  for(const entry of store.entries)if(entry.note)await fs.writeFile(entry.filename,entry.note.source);
}

// Standalone conversion can only target a prepared copy, never source notes.
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--source')throw new Error('Use node scripts/convert-website.mjs --source PATH-TO-WORKING-VAULT');
  const settings={...loadSettings(),source_dir:path.resolve(args[1])},store=new Store(settings);
  const report=await convertWebsiteStore(store,{log:console.log});await saveWorkingNotes(store);
  await fs.writeFile(path.join(settings.source_dir,'.website-conversion-report.json'),JSON.stringify(report,null,2)+'\n');
}
