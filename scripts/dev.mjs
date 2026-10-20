import fs from 'node:fs/promises';
import {watch} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {ROOT,loadSettings} from '../src/config.mjs';
import {buildBrowser} from './build-browser.mjs';
import {installObsidian} from './install-obsidian.mjs';
import {main as publishContent,parseOptions,findObsidianCommand,runCommand} from './publish-content.mjs';
import {loadCloudflareConfig} from './prepare-cloudflare.mjs';
import {NO_PUBLISH_MARKER} from '../src/folder-exclusions.mjs';

export const help=`Usage: npm run dev -- [options]
  (no options)             Preview the live vault at http://127.0.0.1:8765; no Obsidian required
  --full                   Materialize and process the vault, then preview using LOCAL R2/D1
  --plugin                 Build/install/enable Taelgarverse in the configured vault, then exit
  --full --plugin          Install the plugin, then run the full local preview
  --vault PATH             Override the configured vault for this run
  --config FILE            Override automatic config.local.json selection
  --port NUMBER            Preview port (default 8765, or PORT)
  --obsidian-command PATH  Override Obsidian CLI detection
  --obsidian-vault NAME    Obsidian vault name when different from its directory name
  --help                   Show this help

Quick preview restarts when notes or source change; refresh your browser afterward.
Full preview needs running Obsidian with Dataview and the materializer. It accepts
uncommitted notes and reports unsupported queries. Rerun it after changing notes.
Neither preview updates the live site. --plugin only changes the local installation.
`;

export function parseDevOptions(args){
  const options={full:false,plugin:false,port:Number(process.env.PORT || 8765)};
  const values={'--vault':'vault','--config':'config','--port':'port','--obsidian-command':'obsidianCommand','--obsidian-vault':'obsidianVault'};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(['--full','--plugin','--help'].includes(arg))options[arg.slice(2)]=true;
    else if(values[arg]){
      const value=args[++i];if(!value || value.startsWith('--'))throw new Error('Missing value for '+arg);
      options[values[arg]]=arg==='--port'?Number(value):value;
    }else throw new Error('Unknown dev option: '+arg+'; use --help');
  }
  if(!Number.isInteger(options.port) || options.port<1 || options.port>65535)throw new Error('Port must be between 1 and 65535');
  return options;
}

function foreground(args,env={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd:ROOT,windowsHide:true,stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false',...env}});
    const stop=()=>child.kill('SIGTERM');
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    child.once('error',reject);
    child.once('close',(code,signal)=>{
      process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
      code && !signal?reject(new Error('Preview exited '+code)):resolve();
    });
  });
}

export function shouldRefreshVault(filename){
  const file=String(filename || '').replaceAll('\\','/'),first=file.split('/')[0];
  if(file===NO_PUBLISH_MARKER)return true;
  if(first==='.obsidian')return file==='.obsidian/metadata.json';
  if(first==='_scripts')return file.startsWith('_scripts/customJS/') || file==='_scripts/session_note_campaigns.json';
  return !first.startsWith('.') && !['_DM_','node_modules'].includes(first) && !file.endsWith('AGENTS.md');
}

async function livePreview(options){
  const cache=path.join(ROOT,'.cache/dev');await fs.mkdir(cache,{recursive:true});
  const filename=path.join(cache,'settings-'+process.pid+'.json');
  let child,closing=false,restarting=false,timer,queued=Promise.resolve(),finish;
  const finished=new Promise(resolve=>{finish=resolve;});
  const watchers=[];
  const stopChild=()=>new Promise(resolve=>{
    if(!child || child.exitCode!==null || child.signalCode!==null)return resolve();
    child.once('close',resolve);child.kill('SIGTERM');
  });
  const close=async()=>{
    if(closing)return;closing=true;clearTimeout(timer);
    for(const watcher of watchers)watcher.close();
    await stopChild();await fs.rm(filename,{force:true});finish();
  };
  const start=async()=>{
    const settings=loadSettings(options.config,{vault:options.vault,liveVault:true});
    // Always preview the live source vault, regardless of a previous export setting.
    await fs.writeFile(filename,JSON.stringify({...settings,source_dir:settings.vault_dir}));
    child=spawn(process.execPath,['src/server.mjs'],{cwd:ROOT,windowsHide:true,stdio:'inherit',
      env:{...process.env,TAELGARVERSE_CONFIG:filename,PORT:String(options.port)}});
    child.once('error',error=>{console.error(error.message);process.exitCode=1;void close();});
    child.once('close',code=>{if(!closing && !restarting){if(code)process.exitCode=code;void close();}});
  };
  const refresh=()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>{
      queued=queued.then(async()=>{
        if(closing)return;restarting=true;
        console.log('Refreshing local preview…');
        await stopChild();await buildBrowser();if(!closing)await start();restarting=false;
      }).catch(error=>{console.error(error.message);process.exitCode=1;void close();});
    },500);
  };
  const onSignal=()=>{void close();};
  process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  try{
    await start();
    const settings=loadSettings(options.config,{vault:options.vault,liveVault:true});
    watchers.push(watch(settings.vault_dir,{recursive:true},(_event,file)=>{if(shouldRefreshVault(file))refresh();}));
    for(const directory of ['src','public','scripts'])watchers.push(watch(path.join(ROOT,directory),{recursive:true},(_event,file)=>{
      if(!String(file || '').replaceAll('\\','/').startsWith('generated/'))refresh();
    }));
    watchers.push(watch(ROOT,(_event,file)=>{if(['config.json','config.local.json'].includes(String(file)))refresh();}));
    console.log('Preview reads the live vault. Dataview blocks may be incomplete; use --full to materialize them.');
    await finished;
  }finally{
    await close();process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
  }
}

export async function dev(options,dependencies={}){
  const settings=dependencies.settings || loadSettings(options.config,{vault:options.vault,vaultOnly:options.plugin && !options.full,liveVault:!options.full});
  const install=dependencies.install || installObsidian,run=dependencies.run || runCommand;
  if(options.plugin){
    const target=await install(settings.vault_dir,{enable:true});console.log('Installed Taelgarverse: '+target);
    try{
      const result=await run(findObsidianCommand(options.obsidianCommand),[
        'vault='+(options.obsidianVault || path.basename(settings.vault_dir)),'plugin:reload','id=taelgarverse']);
      if(/not found|unable|error/i.test(result.stdout))throw new Error('Reload unavailable');
      console.log('Reloaded Taelgarverse in Obsidian.');
    }catch{console.log('Restart Obsidian, or reload Taelgarverse in Community plugins, to load this build.');}
    if(!options.full)return;
  }
  await (dependencies.build || buildBrowser)();
  if(!options.full)return (dependencies.preview || livePreview)(options);
  const config=dependencies.cloudflareConfig || loadCloudflareConfig();
  if([...(config.r2_buckets || []),...(config.d1_databases || [])].some(binding=>binding.remote)){
    throw new Error('Full local preview requires local R2/D1 bindings; remove remote:true from the local configuration');
  }
  const local=parseOptions(['--local','--allow-dirty','--no-strict']);
  Object.assign(local,{config:options.config,vault:options.vault,obsidianCommand:options.obsidianCommand,obsidianVault:options.obsidianVault});
  console.log('Full dry run: materialization, images, maps, search, and LOCAL R2/D1 activation.');
  await (dependencies.publish || publishContent)(local);
  const args=['node_modules/wrangler/bin/wrangler.js','dev','--local','--config','.cache/cloudflare/wrangler.json',
    '--ip','127.0.0.1','--port',String(options.port),'--persist-to','.wrangler/state'];
  await (dependencies.worker || foreground)(args);
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const options=parseDevOptions(process.argv.slice(2));if(options.help)console.log(help);else await dev(options);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
