import {parseNote,publicationExclusions} from '../src/content-store.mjs';
import {migrateLegacyHeader} from '../src/header-rewrite.mjs';

// Convert publication inputs in memory. Only saveWorkingNotes may persist these
// notes, and it refuses the original vault. No runtime renderer imports this pass.
export function convertWebsiteHeaders(store,{coreMeta,log=()=>{}}={}) {
  const report={schemaVersion:1,counts:{changed:0,unchanged:0,skipped:0,error:0},applied:0,files:[],problems:[]},plans=[];
  for(const entry of store.entries)if(entry.note) {
    let result;
    try {
      result=publicationExclusions(entry.note.metadata).includes('all') ? {status:'skipped',reason:'Excluded from publication.'} :
        migrateLegacyHeader(entry.note.source,{filename:entry.id,coreMeta});
      if(result.status==='changed')plans.push({entry,note:parseNote(result.source)});
    } catch(error){result={status:'error',reason:error.message};}
    const {source,...details}=result;
    report.files.push({file:entry.id,...details});report.counts[result.status]++;
    if(result.problem || result.status==='error')report.problems.push({file:entry.id,reason:result.reason});
  }
  // Review all boundaries before replacing any note. An unsafe legacy header is
  // a publication error even when DQL is allowed to run with --no-strict.
  if(!report.problems.length)for(const {entry,note} of plans){entry.note=note;report.applied++;}
  log(`Header conversion: ${report.counts.changed} legacy headers; ${report.counts.unchanged} native headers preserved; ${report.problems.length} problems.`);
  for(const problem of report.problems)log(problem.file+': '+problem.reason);
  return report;
}
