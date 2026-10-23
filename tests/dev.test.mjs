import test from 'node:test';
import assert from 'node:assert/strict';
import {dev,parseDevOptions,shouldRefreshVault} from '../scripts/dev.mjs';

test('quick preview does not materialize, install plugins, or write Cloudflare storage',async()=>{
  let built=false,previewed=false;
  const unexpected=()=>{throw new Error('Unexpected publication or installation');};
  await dev(parseDevOptions(['--port','8888']),{settings:{vault_dir:'/fixture'},build:async()=>{built=true;},
    preview:async options=>{assert.equal(options.port,8888);previewed=true;},publish:unexpected,install:unexpected,worker:unexpected});
  assert.ok(built && previewed);
});

test('full preview always materializes into local storage and explicitly disables remote bindings in Wrangler',async()=>{
  let exported=false,served=false;
  await dev(parseDevOptions(['--full','--vault','/fixture','--port','8888']),{settings:{vault_dir:'/fixture'},build:async()=>{},
    cloudflareConfig:{r2_buckets:[{binding:'CONTENT'}],d1_databases:[{binding:'SEARCH_DB'}]},
    publish:async options=>{assert.equal(options.local,true);assert.equal(options.materializer,'node');assert.equal(options.allowDirty,true);assert.equal(options.noStrict,true);assert.equal(options.vault,'/fixture');exported=true;},
    worker:async args=>{assert.ok(exported);assert.ok(args.includes('--local'));assert.ok(!args.includes('--remote'));assert.equal(args[args.indexOf('--port')+1],'8888');served=true;}});
  assert.ok(exported && served);
  await assert.rejects(dev(parseDevOptions(['--full']),{settings:{vault_dir:'/fixture'},build:async()=>{},
    cloudflareConfig:{r2_buckets:[{remote:true}]},publish:()=>{throw new Error('Should not export');}}),/requires local/);
});

test('plugin development installs into the selected vault and succeeds even when Obsidian is closed',async()=>{
  let installed=false;
  await dev(parseDevOptions(['--plugin']),{settings:{vault_dir:'/selected/vault'},
    install:async(vault,options)=>{assert.equal(vault,'/selected/vault');assert.equal(options.enable,true);installed=true;return vault+'/.obsidian/plugins/taelgarverse';},
    run:async()=>{throw new Error('Obsidian is closed');},build:()=>{throw new Error('Website should not start');}});
  assert.ok(installed);
});

test('preview rejects remote options and watches note/runtime changes without restarting for Git or plugin state',()=>{
  assert.throws(()=>parseDevOptions(['--remote']),/Unknown/);
  assert.throws(()=>parseDevOptions(['--port','0']),/Port/);
  for(const file of ['People/Person.md','assets/map.png','_scripts/customJS/outputs.js','.obsidian/metadata.json','.nopublish','Campaigns/Cleenseau Campaign/Chats/.nopublish'])assert.equal(shouldRefreshVault(file),true,file);
  for(const file of ['.git/index','.obsidian/plugins/taelgarverse/main.js','.secrets-v2/store','_scripts/research-cache.json'])assert.equal(shouldRefreshVault(file),false,file);
});

test('full preview forwards the explicitly selected materializer and rejects unavailable combinations',async()=>{
  const options=parseDevOptions(['--full','--materializer','obsidian','--obsidian-command','fixture-cli']);
  await dev(options,{settings:{vault_dir:'/fixture'},build:async()=>{},cloudflareConfig:{},
    publish:async selected=>{assert.equal(selected.materializer,'obsidian');assert.equal(selected.obsidianCommand,'fixture-cli');assert.equal(selected.local,true);},worker:async()=>{}});
  for(const args of [['--materializer','obsidian'],['--full','--materializer','unknown'],['--full','--materializer','obsidian','--dataview-directory','/bundle']])assert.throws(()=>parseDevOptions(args));
});
