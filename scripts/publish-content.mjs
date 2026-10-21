import fs from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ROOT, loadSettings, isInside} from '../src/config.mjs';
import {prepareContent, loadCloudflareConfig} from './prepare-cloudflare.mjs';
import {DerivativeCache} from './derivative-cache.mjs';
import {withPublicationProgress} from './publication-progress.mjs';
import {readCampaignHomes} from '../src/website-sources.mjs';
import {readFolderExclusions} from '../src/folder-exclusions.mjs';
import {IMAGE_DEFAULTS, IMAGE_VERSION} from './optimize-images.mjs';
import {createSearchDatabase,searchBinding} from './search-database.mjs';
import {SearchIndex,readPreparedSearch,validateSearchDescriptor} from './search-index.mjs';
import {activationPointer,validatePointer,createRetentionStorage,prunePublication} from './content-retention.mjs';
import {createCloudflareClient} from './cloudflare-client.mjs';
import {uploadContent} from './upload-content.mjs';

export const CHECKPOINT_KEY = 'published/current.json';
const CACHE = path.join(ROOT, '.cache/publish');
const json = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');

export function parseOptions(argv) {
  const options = {force: false, allowDirty: false, noStrict: false, local: false, buildOnly: false, unblock: false, assetsOnly: false,
    maxSize: IMAGE_DEFAULTS.maxSize, quality: IMAGE_DEFAULTS.quality};
  const flags = {'--force': 'force', '--allow-dirty': 'allowDirty', '--no-strict': 'noStrict',
    '--local': 'local', '--build-only': 'buildOnly', '--unblock': 'unblock', '--assets-only': 'assetsOnly', '--help': 'help', '-h': 'help'};
  const values = {'--config': 'config', '--vault': 'vault', '--obsidian-command': 'obsidianCommand',
    '--obsidian-vault': 'obsidianVault', '--max-image-size': 'maxSize', '--image-quality': 'quality'};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags[arg]) options[flags[arg]] = true;
    else if (values[arg]) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg);
      options[values[arg]] = ['maxSize', 'quality'].includes(values[arg]) ? Number(value) : value;
    } else throw new Error('Unknown argument: ' + arg);
  }
  if (!Number.isInteger(options.maxSize) || options.maxSize < 1 ||
      !Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100) {
    throw new Error('Image size must be a positive integer and quality must be 1–100.');
  }
  if (options.local && options.buildOnly) throw new Error('Choose --local or --build-only.');
  if (options.unblock && options.buildOnly) throw new Error('--unblock requires publication; it cannot be combined with --build-only.');
  if (options.assetsOnly && options.buildOnly) throw new Error('Choose --assets-only or --build-only.');
  return options;
}

// No shell, npx, platform-specific quoting, or .cmd launchers required.
export function runCommand(command, args, {cwd = ROOT, live = false, env = {}} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true', ...env}});
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-1024 * 1024); if (live) process.stdout.write(data); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-1024 * 1024); if (live) process.stderr.write(data); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({stdout, stderr});
      else reject(Object.assign(new Error(`${path.basename(command)} exited ${code}: ${(stderr || stdout).trim()}`), {code, stdout, stderr}));
    });
  });
}

export function repositoryIdentity(remote) {
  remote = remote.trim().replace(/\.git\/?$/, '').replace(/\/$/, '');
  if (/^[^/@]+@[^:]+:/.test(remote)) remote = 'https://' + remote.replace(/^[^@]+@/, '').replace(':', '/');
  try {
    const url = new URL(remote);
    return url.host.toLowerCase() + url.pathname;
  } catch { throw new Error('Taelgar origin must be a hosted Git remote, not a local machine path.'); }
}

export async function repositoryState(vault, run = runCommand) {
  const git = async args => (await run('git', ['-C', vault, ...args])).stdout.trim();
  const root = await fs.realpath(await git(['rev-parse', '--show-toplevel']));
  if (root !== await fs.realpath(vault)) throw new Error('--vault must name the Taelgar repository root.');
  const commit = await git(['rev-parse', 'HEAD']);
  const repository = repositoryIdentity(await git(['config', '--get', 'remote.origin.url']));
  const status = await git(['status', '--porcelain', '--untracked-files=normal']);
  return {commit, repository, dirty: Boolean(status)};
}

export function findObsidianCommand(explicit, platform = process.platform, env = process.env, exists = existsSync) {
  if (explicit || env.OBSIDIAN_COMMAND) return explicit || env.OBSIDIAN_COMMAND;
  const candidates = platform === 'win32' ? [
    path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'Obsidian', 'Obsidian.com'),
    path.win32.join(env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Obsidian', 'Obsidian.com'),
  ] : platform === 'darwin' ? [
    '/Applications/Obsidian.app/Contents/MacOS/Obsidian',
    path.join(os.homedir(), 'Applications/Obsidian.app/Contents/MacOS/Obsidian'),
  ] : [];
  return candidates.find(exists) || 'obsidian';
}

export function validateCheckpoint(value) {
  if (value?.schemaVersion !== 1 || typeof value.repository !== 'string' ||
      !/^[a-f0-9]{40,64}$/.test(value.commit || '') || !/^[a-f0-9]{64}$/.test(value.revision || '') ||
      !/^[a-f0-9]{64}$/.test(value.fingerprint || '') || typeof value.dirty !== 'boolean') {
    throw new Error('Invalid R2 build checkpoint; inspect ' + CHECKPOINT_KEY + ' before rebuilding.');
  }
  if(value.search)validateSearchDescriptor(value.search);
  validatePointer(value);
  return value;
}

export function createStorage({storage,log=()=>{}}) {
  return {
    async readCheckpoint(filename) {
      const value=await (await storage()).getJSON(CHECKPOINT_KEY);
      if(value===null)return null;
      await json(filename,value);
      // Manual pointers do not carry a build fingerprint that permits skipping.
      if (value && Object.keys(value).every(key=>['revision','completedAt','search','previous','retentionVersion'].includes(key)) &&
          /^[a-f0-9]{64}$/.test(value.revision || '')) {validatePointer(value);return null;}
      return validateCheckpoint(value);
    },
    async upload(report,options) {return uploadContent(report,await storage(),{log,...options});},
    async writeCheckpoint(value,filename) {
      validateCheckpoint(value);await json(filename,value);
      await (await storage()).putPointer(value);
    },
  };
}

// Separating orchestration lets tests prove that failures never advance R2 state.
export async function publishContent(options, deps) {
  if(!options.buildOnly && deps.withPublicationLock)return deps.withPublicationLock(()=>publishContent(options,{...deps,withPublicationLock:null}),{unblock:options.unblock === true});
  const before = await deps.repositoryState();
  if (before.dirty && !options.allowDirty) {
    throw new Error('Taelgar has uncommitted changes. Commit them first, or use --allow-dirty for a build marked dirty that will never skip subsequent builds.');
  }
  const previous = options.buildOnly || options.assetsOnly ? null : await deps.readCheckpoint();
  if (!options.force && !before.dirty && previous?.dirty === false && previous?.commit === before.commit &&
      previous.repository === before.repository && previous.fingerprint === options.fingerprint) {
    if(previous.search){
      if(!deps.verifySearch)throw new Error('Search readiness verification is required before skipping this publication');
      await withPublicationProgress('Verifying the published search index',()=>deps.verifySearch(previous),deps.log);
    }
    await deps.prune?.(previous);
    deps.log(`Taelgar ${before.commit.slice(0, 12)} is already in R2; skipping export, images, and upload.`);
    return {skipped: true, ...previous};
  }
  deps.log(`Building Taelgar ${before.commit.slice(0, 12)}${before.dirty ? ' (uncommitted changes)' : ''}.`);
  const build = await deps.build(before);
  const unchanged = async () => {
    const state = await deps.repositoryState();
    if (state.commit !== before.commit || state.repository !== before.repository || (!before.dirty && state.dirty)) {
      throw new Error('Taelgar changed during publishing. This run did not activate new content. Finish saving, syncing, and any Git changes, then rerun the publish command.');
    }
    await deps.verifyInputs?.();
  };
  await unchanged();
  if(options.assetsOnly){
    const uploaded=await deps.upload(build,{assetsOnly:true});
    await unchanged();
    return {assetsOnly:true,revision:build.revision,...uploaded};
  }
  let result = {schemaVersion: 1, repository: before.repository, commit: before.commit,
    dirty: before.dirty, fingerprint: options.fingerprint, revision: build.revision,
    headerRevision: build.headerRevision, images: build.images, queries: build.queries,
    completedAt: new Date().toISOString()};
  if (!options.buildOnly) {
    await deps.upload(build);
    if(build.search){
      if(!deps.stageSearch || !deps.verifySearch)throw new Error('Search indexing and readiness verification are required before activation');
      await deps.stageSearch(build);
      await withPublicationProgress('Verifying search readiness before activation',()=>deps.verifySearch(build),deps.log);
      result.search=validateSearchDescriptor(build.search);
    }
    await withPublicationProgress('Checking source files and publishing settings before activation',unchanged,deps.log);
    result.completedAt = new Date().toISOString();
    // Manual pointers identify the previous good snapshot even without a
    // publisher fingerprint that could justify skipping this build.
    await withPublicationProgress('Activating the new content revision',async()=>{
      result=activationPointer(deps.readPointer?await deps.readPointer():previous,result);
      await deps.writeCheckpoint(result);
    },deps.log);
    deps.log('New content is live. Finishing publication cleanup…');
    if(deps.prune){
      try{await deps.prune(result);}catch(error){throw new Error('Content is published, but retention cleanup failed. Rerun to retry cleanup: '+error.message);}
    }
    if (before.dirty) deps.log('Published uncommitted content, marked dirty in R2; the next run will rebuild.');
  }
  await deps.recordBuild(result, build);
  return result;
}

export function validateMaterializationReport(report, output) {
  if (report.status !== 'ok' || !report.outputComplete || !report.dynamicWebsite ||
      typeof report.outputPath !== 'string' || path.resolve(report.outputPath) !== path.resolve(output)) {
    throw new Error('Materializer did not produce a complete dynamic website export.');
  }
  if (report.publicationPolicy !== 'context-v1') {
    throw new Error('Update the vault materializer and reload its Obsidian plugin to export all context-filtered content.');
  }
}

export function buildFingerprint(settings, options, config={}) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({excludedFolders:readFolderExclusions(settings.vault_dir)}));
  for (const [host,source] of Object.entries(readCampaignHomes(settings))) hash.update(JSON.stringify([host,source.replace(/\r\n/g,'\n')]));
  hash.update(JSON.stringify({version: 1, image: {maxSize: options.maxSize, quality: options.quality, ...IMAGE_VERSION},
    strict: !options.noStrict, default_date: settings.default_date, respect_pov_dates: settings.respect_pov_dates === true,searchDestination:{account:config.account_id,databases:config.d1_databases || []}}));
  for (const filename of [settings.nav_source, settings.home_source,
    new URL('./publish-content.mjs', import.meta.url), new URL('./optimize-images.mjs', import.meta.url),
    new URL('./build-images.mjs', import.meta.url), new URL('./derivative-cache.mjs', import.meta.url), new URL('../src/images.mjs', import.meta.url),
    new URL('./image-usage.mjs', import.meta.url),
    new URL('../src/website-sources.mjs', import.meta.url), new URL('../src/campaign-sites.mjs', import.meta.url),
    new URL('../src/folder-exclusions.mjs', import.meta.url),
    new URL('./build-maps.mjs', import.meta.url), new URL('../src/maps.mjs', import.meta.url),
    new URL('../src/map-distance.mjs', import.meta.url),
    new URL('./prepare-cloudflare.mjs', import.meta.url), new URL('../src/store.mjs', import.meta.url),
    new URL('../src/content-store.mjs', import.meta.url), new URL('../src/bio-block.mjs', import.meta.url), new URL('../src/backlinks.mjs', import.meta.url),
    new URL('../src/markdown.mjs', import.meta.url), new URL('../src/comments.mjs', import.meta.url),
    new URL('../src/common.mjs', import.meta.url), new URL('./build-runtime.mjs', import.meta.url)]) {
    // A Windows checkout may use CRLF while macOS uses LF. That alone must not
    // invalidate the shared R2 checkpoint for an otherwise identical build.
    hash.update(filename ? readFileSync(filename, 'utf8').replace(/\r\n/g, '\n') : '<no-website-source>');
  }
  for(const filename of ['./compile-search.mjs','./compile-runtime.mjs','./search-index.mjs','./search-database.mjs','./content-retention.mjs','./cloudflare-client.mjs','./upload-content.mjs','./publication-progress.mjs','../src/search-text.mjs','../src/search-metadata.mjs','../src/search-types.mjs','../src/runtime-format.mjs','../src/navigation.mjs','../src/contexts.mjs','../src/header-core/snapshot.mjs','../src/header-core/campaigns.mjs','../src/dm.mjs','../package-lock.json'])hash.update(readFileSync(new URL(filename,import.meta.url),'utf8').replace(/\r\n/g,'\n'));
  return hash.digest('hex');
}

async function removeWorkingDirectory(directory) {
  // Only this invocation's mkdtemp directory can be recursively deleted.
  const resolved = await fs.realpath(directory);
  const parent = await fs.realpath(CACHE);
  if (!isInside(parent, resolved) || path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('run-')) {
    throw new Error('Refusing to remove unexpected export path: ' + resolved);
  }
  await fs.rm(resolved, {recursive: true});
}

export async function main(options) {
  const settings = loadSettings(options.config, {vault: options.vault});
  const vault = settings.vault_dir;
  const config = loadCloudflareConfig();
  const binding = config.r2_buckets?.find(item => item.binding === 'CONTENT');
  if (!binding?.bucket_name || binding.jurisdiction) throw new Error('Configure a standard CONTENT R2 bucket in wrangler.local.json.');
  if(!options.buildOnly)searchBinding(config,{local:options.local});
  await fs.mkdir(CACHE, {recursive: true});
  const lockFile = path.join(CACHE, 'publish.lock');
  let lock;
  try { lock = await fs.open(lockFile, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('A publish lock exists at ' + lockFile + '. If no publisher is running, remove that file and retry.');
    throw error;
  }
  let working,searchDatabase,retentionStorage;
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}) + '\n');
    const fingerprint = buildFingerprint(settings, options, config);
    let publicationIndex,clientPromise;
    const client=()=>options.local?undefined:(clientPromise ??=createCloudflareClient(config,{log:console.log}));
    const index=async()=>{searchDatabase ??=await createSearchDatabase(config,{local:options.local,client:await client()});return new SearchIndex(searchDatabase,{log:console.log});};
    const retainedStorage=async()=>retentionStorage ??=await createRetentionStorage(config,{local:options.local,client:await client(),log:console.log});
    const storage=createStorage({storage:retainedStorage,log:console.log});
    const result = await publishContent({...options, fingerprint}, {
      withPublicationLock:async (action,lockOptions)=>{publicationIndex=await index();return publicationIndex.withPublicationLock(action,lockOptions);},
      readPointer:async()=>(await retainedStorage()).getJSON(CHECKPOINT_KEY),
      prune:async pointer=>prunePublication(await retainedStorage(),publicationIndex,pointer,{log:console.log}),
      repositoryState: () => repositoryState(vault),
      readCheckpoint: () => storage.readCheckpoint(path.join(CACHE, 'previous-checkpoint.json')),
      writeCheckpoint: value => storage.writeCheckpoint(value, path.join(CACHE, 'checkpoint.json')),
      log: console.log,
      stageSearch:async report=>{
        const receipt=await (await index()).stage(report.revision,readPreparedSearch(report));
        await json(path.join(CACHE,'search-receipt.json'),receipt);
      },
      verifySearch:async report=>{await (await index()).verify(report.revision,report.search);},
      async verifyInputs() {
        const current = loadCloudflareConfig();
        const currentSettings = loadSettings(options.config, {vault: options.vault});
        if (currentSettings.vault_dir !== vault || buildFingerprint(currentSettings, options, current) !== fingerprint || current.name !== config.name ||
            current.account_id !== config.account_id || current.r2_buckets?.find(item => item.binding === 'CONTENT')?.bucket_name !== binding.bucket_name) {
          throw new Error('Publisher code, settings, website files, or destination changed during the build. This run did not activate new content. Let edits, syncing, and repository updates finish, then rerun the publish command.');
        }
      },
      async build(sourceVersion) {
        working = await fs.mkdtemp(path.join(CACHE, 'run-'));
        if (isInside(vault, working)) throw new Error('The export directory must be outside the Taelgar vault.');
        const output = path.join(working, 'vault');
        const materializer = path.join(vault, '_scripts/materialize-dataview/materialize-dataview.mjs');
        const args = [materializer, '--vault', vault, '--out', output, '--dynamic-website',
          '--obsidian-command', findObsidianCommand(options.obsidianCommand), '--progress-interval', '5'];
        if (options.obsidianVault) args.push('--obsidian-vault', options.obsidianVault);
        if (options.noStrict) args.push('--no-strict');
        console.log('Exporting dynamic website Markdown from ' + vault);
        await runCommand(process.execPath, args, {cwd: vault, live: true});
        const reportFile = path.join(output, '.dataview-materialization-report.json');
        const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
        validateMaterializationReport(report, output);
        await fs.copyFile(reportFile, path.join(CACHE, 'materialization-report.json'));
        const preparedSettings = {...settings, source_dir: output};
        console.log('Preparing responsive images; preserving full-resolution exports…');
        const derivativeCache=options.buildOnly ? new DerivativeCache() : await DerivativeCache.load(await retainedStorage());
        let lastLog = 0;
        const prepared = await prepareContent(preparedSettings,undefined,sourceVersion,
          {maxSize: options.maxSize, quality: options.quality}, progress => {
            if (Date.now() - lastLog > 5000) {
              console.log(`Images: ${progress.images} processed | ${progress.currentFile}`);
              lastLog = Date.now();
            }
          },derivativeCache);
        const images = prepared.images;
        console.log(`R2 recipes reused: ${derivativeCache.hits.images} image(s), ${derivativeCache.hits.maps} map pyramid(s); no derivative downloads or encoding for these.`);
        console.log(`Images: ${images.images} originals retained; ${images.variants} responsive variants (${(images.variantBytes / 1048576).toFixed(1)} MiB stored)`);
        const preparedConfig = JSON.parse(await fs.readFile(prepared.configFile, 'utf8'));
        if (prepared.bucket !== binding.bucket_name || preparedConfig.account_id !== config.account_id || preparedConfig.name !== config.name) {
          throw new Error('Cloudflare destination changed during preparation.');
        }
        return {...prepared, images, queries: {errors: report.counts.errors, unsupported: report.counts.unsupported}};
      },
      upload: (report,uploadOptions) => storage.upload(report,uploadOptions),
      async recordBuild(value, report) {
        await json(path.join(CACHE, 'latest.json'), value);
        if (!options.local && !options.buildOnly) await json(path.join(ROOT, '.cache/cloudflare/remote-upload.json'), {
          revision: report.revision, bucket: report.bucket, worker: config.name, account: config.account_id,
          uploadedAt: value.completedAt,
        });
      },
    });
    if (working) { await withPublicationProgress('Removing temporary export files',()=>removeWorkingDirectory(working),console.log); working = undefined; }
    if(result.assetsOnly)console.log('Assets staged. Published notes and search are unchanged; run the normal publish command to activate them.');
    else if (!result.skipped) console.log(options.buildOnly ?
      'Prepared content and search locally; no R2/D1 reads or writes. Run node scripts/cloudflare.mjs check to verify the Worker package.' :
      `Content published (${result.revision.slice(0, 12)}). The Worker will read the new revision from R2.`);
    return result;
  } catch (error) {
    if (working) console.error('Export files retained for inspection: ' + working);
    throw error;
  } finally {
    try{try{await retentionStorage?.close();}finally{await searchDatabase?.close();}}
    finally{await lock.close();await fs.rm(lockFile, {force: true});}
  }
}

const help = `Usage: npm run publish -- [options]
Checks the Taelgar commit in R2, exports via Obsidian, optimizes images, uploads, and verifies D1 search before activation.
Requires Node 22+, Git, the vault open in Obsidian with Dataview ready, and Wrangler login.
Settings: config.json, plus config.local.json automatically when present.

  --config FILE            Alternative to automatic config.local.json (or TAELGARVERSE_CONFIG)
  --vault PATH             Taelgar Git checkout for this run (overrides vault_dir)
  --obsidian-command PATH   Override automatic Windows/macOS CLI detection
  --obsidian-vault NAME     Optional Obsidian vault name or ID
  --no-strict               Permit failed/unsupported queries, reporting each one
  --assets-only             Upload missing images/media without activating notes, search, or cleanup
  --force                   Rebuild even when the R2 commit/settings match
  --unblock                 Clear a stale D1 publication lock and continue publishing
                            Confirms no publisher, staging, cleanup, or rollback is running on any computer
  --allow-dirty             Publish uncommitted changes, marked dirty; subsequent runs rebuild
  --max-image-size PIXELS   Largest responsive image edge; default 2560; originals retained
  --image-quality 1-100     JPEG/WebP derivative quality; default 82 (PNG derivatives are lossless)
  --build-only              Export, optimize, compile search, and package without contacting R2/D1
  --local                   Use local R2/D1 emulators instead of remote resources
  --help                    Show this help
`;
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log(help);
    else await main(options);
  } catch (error) {
    const title = 'ERROR: PUBLISH COMMAND FAILED';
    const heading = process.stderr.isTTY && !('NO_COLOR' in process.env) ? '\x1b[1;31m' + title + '\x1b[0m' : title;
    console.error('\n' + heading + '\n\n' + error.message + '\n');
    process.exitCode = 1;
  }
}
