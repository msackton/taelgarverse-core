import fs from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ROOT, loadSettings, isInside} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {prepareContent, loadCloudflareConfig} from './prepare-cloudflare.mjs';
import {IMAGE_DEFAULTS, IMAGE_VERSION, optimizeImages} from './optimize-images.mjs';

export const CHECKPOINT_KEY = 'published/current.json';
const CACHE = path.join(ROOT, '.cache/publish');
const WRANGLER = path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const json = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');

export function parseOptions(argv) {
  const options = {force: false, allowDirty: false, noStrict: false, local: false, buildOnly: false,
    maxSize: IMAGE_DEFAULTS.maxSize, quality: IMAGE_DEFAULTS.quality};
  const flags = {'--force': 'force', '--allow-dirty': 'allowDirty', '--no-strict': 'noStrict',
    '--local': 'local', '--build-only': 'buildOnly', '--help': 'help', '-h': 'help'};
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
  return value;
}

export function isMissingCheckpoint(error) {
  // Match the pinned Wrangler command's object-404 error specifically. Auth,
  // network, bucket, or account failures must never be mistaken for first build.
  return /The specified key does not exist\./.test((error.stderr || '') + (error.stdout || ''));
}

export function createStorage({bucket, configFile, local = false, persistTo = path.join(ROOT, '.wrangler/state'), run = runCommand}) {
  const target = local ? ['--local', '--persist-to', persistTo] : ['--remote'];
  const invoke = (args, live = false) => run(process.execPath,
    [WRANGLER, ...args, '--config', configFile, ...target], {live});
  return {
    async readCheckpoint(filename) {
      try { await invoke(['r2', 'object', 'get', `${bucket}/${CHECKPOINT_KEY}`, '--file', filename]); }
      catch (error) { if (isMissingCheckpoint(error)) return null; throw error; }
      const value = JSON.parse(await fs.readFile(filename, 'utf8'));
      // A pointer published by the older manual command has no Git metadata.
      if (value && Object.keys(value).length === 1 && /^[a-f0-9]{64}$/.test(value.revision || '')) return null;
      return validateCheckpoint(value);
    },
    async upload(report) {
      const manifest = JSON.parse(await fs.readFile(report.manifestFile, 'utf8'));
      const allowed = new RegExp('^(?:assets/[a-f0-9]{64}|revisions/' + report.revision + '/(?:index\\.json|notes/[a-f0-9]{2}\\.json))$');
      if (!manifest.length || manifest.some(item => !allowed.test(item.key))) throw new Error('Upload manifest contains unexpected object keys.');
      await invoke(['r2', 'bulk', 'put', bucket, '--filename', report.manifestFile, '--concurrency', '8', '--force'], true);
    },
    async writeCheckpoint(value, filename) {
      validateCheckpoint(value);
      await json(filename, value);
      await invoke(['r2', 'object', 'put', `${bucket}/${CHECKPOINT_KEY}`, '--file', filename, '--content-type', 'application/json', '--force'], true);
    },
  };
}

// Separating orchestration lets tests prove that failures never advance R2 state.
export async function publishContent(options, deps) {
  const before = await deps.repositoryState();
  if (before.dirty && !options.allowDirty) {
    throw new Error('Taelgar has uncommitted changes. Commit them first, or use --allow-dirty for a build marked dirty that will never skip subsequent builds.');
  }
  const previous = options.buildOnly ? null : await deps.readCheckpoint();
  if (!options.force && !before.dirty && previous?.dirty === false && previous?.commit === before.commit &&
      previous.repository === before.repository && previous.fingerprint === options.fingerprint) {
    deps.log(`Taelgar ${before.commit.slice(0, 12)} is already in R2; skipping export, images, and upload.`);
    return {skipped: true, ...previous};
  }
  deps.log(`Building Taelgar ${before.commit.slice(0, 12)}${before.dirty ? ' (uncommitted changes)' : ''}.`);
  const build = await deps.build(before);
  const unchanged = async () => {
    const state = await deps.repositoryState();
    if (state.commit !== before.commit || state.repository !== before.repository || (!before.dirty && state.dirty)) {
      throw new Error('Taelgar changed during publishing; the R2 commit checkpoint was not updated. Run again.');
    }
    await deps.verifyInputs?.();
  };
  await unchanged();
  const result = {schemaVersion: 1, repository: before.repository, commit: before.commit,
    dirty: before.dirty, fingerprint: options.fingerprint, revision: build.revision,
    headerRevision: build.headerRevision, images: build.images, queries: build.queries,
    completedAt: new Date().toISOString()};
  if (!options.buildOnly) {
    await deps.upload(build);
    await unchanged();
    result.completedAt = new Date().toISOString();
    await deps.writeCheckpoint(result);
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

export function buildFingerprint(settings, options) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({version: 1, image: {maxSize: options.maxSize, quality: options.quality, ...IMAGE_VERSION},
    strict: !options.noStrict, default_date: settings.default_date}));
  for (const filename of [settings.nav_source,
    new URL('./publish-content.mjs', import.meta.url), new URL('./optimize-images.mjs', import.meta.url),
    new URL('./prepare-cloudflare.mjs', import.meta.url), new URL('../src/store.mjs', import.meta.url),
    new URL('../src/content-store.mjs', import.meta.url), new URL('../src/backlinks.mjs', import.meta.url),
    new URL('../src/markdown.mjs', import.meta.url), new URL('../src/comments.mjs', import.meta.url),
    new URL('../src/common.mjs', import.meta.url), new URL('./build-runtime.mjs', import.meta.url)]) {
    // A Windows checkout may use CRLF while macOS uses LF. That alone must not
    // invalidate the shared R2 checkpoint for an otherwise identical build.
    hash.update(filename ? readFileSync(filename, 'utf8').replace(/\r\n/g, '\n') : '<no-navigation>');
  }
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
  const settings = loadSettings(options.config);
  const vault = await fs.realpath(path.resolve(options.vault || settings.runtime_dir));
  const config = loadCloudflareConfig();
  const binding = config.r2_buckets?.find(item => item.binding === 'CONTENT');
  if (!binding?.bucket_name || binding.jurisdiction) throw new Error('Configure a standard CONTENT R2 bucket in wrangler.local.json.');
  await fs.mkdir(CACHE, {recursive: true});
  const lockFile = path.join(CACHE, 'publish.lock');
  let lock;
  try { lock = await fs.open(lockFile, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('A publish lock exists at ' + lockFile + '. If no publisher is running, remove that file and retry.');
    throw error;
  }
  let working;
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}) + '\n');
    const destinationFile = path.join(CACHE, 'destination.json');
    await json(destinationFile, {name: config.name, account_id: config.account_id, r2_buckets: config.r2_buckets});
    const storage = createStorage({bucket: binding.bucket_name, configFile: destinationFile, local: options.local});
    const fingerprint = buildFingerprint(settings, options);
    const result = await publishContent({...options, fingerprint}, {
      repositoryState: () => repositoryState(vault),
      readCheckpoint: () => storage.readCheckpoint(path.join(CACHE, 'previous-checkpoint.json')),
      writeCheckpoint: value => storage.writeCheckpoint(value, path.join(CACHE, 'checkpoint.json')),
      log: console.log,
      async verifyInputs() {
        const current = loadCloudflareConfig();
        if (buildFingerprint(loadSettings(options.config), options) !== fingerprint || current.name !== config.name ||
            current.account_id !== config.account_id || current.r2_buckets?.find(item => item.binding === 'CONTENT')?.bucket_name !== binding.bucket_name) {
          throw new Error('Publisher code, settings, or destination changed during the build; run again before publishing.');
        }
      },
      async build() {
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
        const preparedSettings = {...settings, source_dir: output, runtime_dir: vault};
        const store = new Store(preparedSettings);
        console.log('Optimizing exported JPEG, PNG, and WebP images…');
        let lastLog = 0;
        const images = await optimizeImages(store.entries, path.join(CACHE, 'images'),
          {maxSize: options.maxSize, quality: options.quality}, progress => {
            if (Date.now() - lastLog > 5000) {
              console.log(`Images: ${progress.images} processed | ${progress.currentFile}`);
              lastLog = Date.now();
            }
          });
        console.log(`Images: ${images.optimized}/${images.images} smaller; ${(images.inputBytes / 1048576).toFixed(1)} → ${(images.outputBytes / 1048576).toFixed(1)} MiB`);
        const prepared = await prepareContent(preparedSettings);
        const preparedConfig = JSON.parse(await fs.readFile(prepared.configFile, 'utf8'));
        if (prepared.bucket !== binding.bucket_name || preparedConfig.account_id !== config.account_id || preparedConfig.name !== config.name) {
          throw new Error('Cloudflare destination changed during preparation.');
        }
        return {...prepared, images, queries: {errors: report.counts.errors, unsupported: report.counts.unsupported}};
      },
      upload: report => storage.upload(report),
      async recordBuild(value, report) {
        await json(path.join(CACHE, 'latest.json'), value);
        if (!options.local && !options.buildOnly) await json(path.join(ROOT, '.cache/cloudflare/remote-upload.json'), {
          revision: report.revision, bucket: report.bucket, worker: config.name, account: config.account_id,
          uploadedAt: value.completedAt,
        });
      },
    });
    if (working) { await removeWorkingDirectory(working); working = undefined; }
    if (!result.skipped) console.log(options.buildOnly ?
      'Prepared locally; no R2 reads or writes. Run npm run cf:check to verify the Worker package.' :
      `Content published (${result.revision.slice(0, 12)}). The Worker will read the new revision from R2.`);
    return result;
  } catch (error) {
    if (working) console.error('Export files retained for inspection: ' + working);
    throw error;
  } finally {
    await lock.close();
    await fs.rm(lockFile, {force: true});
  }
}

const help = `Usage: npm run content:publish -- [options]
Checks the Taelgar commit in R2, exports via Obsidian, optimizes images, then uploads.
Requires Node 22+, Git, the vault open in Obsidian with Dataview ready, and Wrangler login.

  --config FILE            Website settings (or TAELGARVERSE_CONFIG)
  --vault PATH             Taelgar Git checkout (defaults to runtime_dir)
  --obsidian-command PATH   Override automatic Windows/macOS CLI detection
  --obsidian-vault NAME     Optional Obsidian vault name or ID
  --no-strict               Permit failed/unsupported queries, reporting each one
  --force                   Rebuild even when the R2 commit/settings match
  --allow-dirty             Publish uncommitted changes, marked dirty; subsequent runs rebuild
  --max-image-size PIXELS   Longest image edge; default 2560, no enlargement
  --image-quality 1-100     JPEG/WebP quality; default 82 (PNG uses lossless compression)
  --build-only              Export, optimize, package locally without contacting R2
  --local                   Use local R2 emulator instead of remote R2
  --help                    Show this help
`;
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log(help);
    else await main(options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
