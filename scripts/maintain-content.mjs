import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadCloudflareConfig} from './prepare-cloudflare.mjs';
import {createSearchDatabase} from './search-database.mjs';
import {SearchIndex} from './search-index.mjs';
import {createRetentionStorage,prunePublication,rollbackPublication,POINTER_KEY} from './content-retention.mjs';

export async function main(argv=process.argv.slice(2)){
  const [command,...args]=argv;
  if(!command || command==='--help' || args.includes('--help')){
    console.log('Usage: node scripts/maintain-content.mjs prune --local|--remote [--dry-run]\n       node scripts/maintain-content.mjs rollback --local|--remote\nPrune keeps the active publication plus one previous good snapshot in R2/D1.\nRollback swaps those two snapshots after verifying their content and search.');return;
  }
  if(!['prune','rollback'].includes(command) || args.some(a=>!['--local','--remote','--dry-run'].includes(a)) || args.includes('--local')===args.includes('--remote') || (command==='rollback' && args.includes('--dry-run')))throw new Error('Choose prune [--dry-run] or rollback, with exactly one of --local / --remote');
  const config=loadCloudflareConfig(),options={local:args.includes('--local')};
  const db=await createSearchDatabase(config,options);let storage;
  try{
    storage=await createRetentionStorage(config,options);const index=new SearchIndex(db);
    const prune=async()=>prunePublication(storage,index,await storage.getJSON(POINTER_KEY),{dryRun:args.includes('--dry-run'),log:console.log});
    const result=command==='rollback'?await rollbackPublication(storage,index,{log:console.log}):args.includes('--dry-run')?await prune():await index.withPublicationLock(prune);
    console.log(JSON.stringify(result,null,2));
  }finally{try{await storage?.close();}finally{await db.close();}}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
