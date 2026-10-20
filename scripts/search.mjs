import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../src/config.mjs';
import {loadCloudflareConfig} from './prepare-cloudflare.mjs';
import {createSearchDatabase} from './search-database.mjs';
import {SearchIndex,readPreparedSearch} from './search-index.mjs';

export async function stagePreparedSearch(report,{config=loadCloudflareConfig(),local=false,persistTo,verifyOnly=false,log=console.log}={}){
  // Verify the local immutable artifacts before authentication or remote writes.
  const manifest=readPreparedSearch(report),db=await createSearchDatabase(config,{local,persistTo});
  try{
    const index=new SearchIndex(db,{log});
    return verifyOnly?await index.verify(report.revision,report.search):await index.withPublicationLock(()=>index.stage(report.revision,manifest));
  }finally{await db.close();}
}
export async function main(argv=process.argv.slice(2)){
  const [command='help',...args]=argv;
  if(command==='help' || command==='--help'){
    console.log('Search publication: node scripts/search.mjs stage|verify [--local|--remote] [--report FILE] [--dry-run]\nDefaults to .cache/cloudflare/latest.json. Remote operations require --remote explicitly.\nConfigure SEARCH_DB (database_name taelgarverse-search) in wrangler.json or wrangler.local.json.\nAI services are never contacted. This command does not activate R2 content.');return;
  }
  if(!['stage','verify'].includes(command))throw new Error('Use search stage or verify');
  let file=path.join(ROOT,'.cache/cloudflare/latest.json'),local=false,remote=false,dry=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--local')local=true;else if(args[i]==='--remote')remote=true;else if(args[i]==='--dry-run')dry=true;
    else if(args[i]==='--report' && args[i+1])file=path.resolve(args[++i]);else throw new Error('Unknown or missing search option: '+args[i]);
  }
  if(local && remote)throw new Error('Choose --local or --remote');
  const report=JSON.parse(fs.readFileSync(file,'utf8')),manifest=readPreparedSearch(report);
  if(dry){console.log(JSON.stringify({revision:report.revision,search:report.search,stats:manifest.stats,warnings:manifest.warnings,remoteCalls:0},null,2));return;}
  if(!local && !remote)throw new Error('Select --local or --remote explicitly');
  const result=await stagePreparedSearch(report,{local,verifyOnly:command==='verify'});console.log(JSON.stringify(result,null,2));
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
