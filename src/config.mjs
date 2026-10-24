import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
import {validateDate} from './common.mjs';
export * from './common.mjs';

function readSettings(filename) {
  let input;
  try { input = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (error) { throw new Error('Cannot read settings from ' + filename + ': ' + error.message, {cause: error}); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Settings in ' + filename + ' must be a JSON object');
  }
  // Resolve each path where it was written, before combining the files. An
  // alternate settings file must not move paths inherited from the defaults.
  for (const key of ['vault_dir', 'source_dir', 'runtime_dir', 'nav_source', 'home_source']) {
    const nullable = ['nav_source', 'home_source', 'source_dir'].includes(key);
    if (!Object.hasOwn(input, key) || (nullable && input[key] === null)) continue;
    if (typeof input[key] !== 'string' || !input[key].trim()) {
      throw new Error(key + ' in ' + filename + ' must be a nonempty path' + (nullable ? ' or null' : ''));
    }
    input[key] = path.resolve(path.dirname(filename), input[key]);
  }
  // Keep existing local files usable, but expose one name to the application.
  if (Object.hasOwn(input, 'runtime_dir')) {
    if (input.vault_dir && input.vault_dir !== input.runtime_dir) {
      throw new Error('Use only vault_dir in ' + filename + '; runtime_dir points to a different vault');
    }
    input.vault_dir = input.runtime_dir;
    delete input.runtime_dir;
  }
  for(const key of ['index_registry','index_override']) {
    if(!Object.hasOwn(input,key) || key==='index_override' && input[key]===null)continue;
    const value=input[key];
    if(typeof value!=='string' || !value.trim() || path.isAbsolute(value) || /(^|[\\/])\.\.([\\/]|$)/.test(value))throw new Error(key+' must be a vault-relative path'+(key==='index_override'?' or null':''));
  }
  return input;
}

export function loadSettings(filename, {root = ROOT, env = process.env, vault, vaultOnly = false, liveVault = false} = {}) {
  const defaultsFile = path.resolve(root, 'config.json');
  const localFile = path.resolve(root, 'config.local.json');
  // Explicit selection replaces the automatic local file, not the shared
  // defaults. This keeps alternate configurations independent of this machine.
  const selected = filename || env.TAELGARVERSE_CONFIG || (fs.existsSync(localFile) ? localFile : null);
  const settings = {...readSettings(defaultsFile), ...(selected ? readSettings(path.resolve(selected)) : {})};
  settings.campaigns ??= [];
  if (vault) settings.vault_dir = path.resolve(vault);
  if (typeof settings.vault_dir !== 'string') throw new Error('Missing configuration: vault_dir');
  settings.vault_dir = fs.realpathSync(settings.vault_dir);
  if(vaultOnly)return settings; // Plugin installation needs no website inputs.
  if(liveVault)settings.source_dir=settings.vault_dir;
  settings.source_dir = fs.realpathSync(settings.source_dir ?? settings.vault_dir);
  for (const [key, name] of [['nav_source', 'navigation.md'], ['home_source', 'home.md']]) {
    settings[key] = settings[key] === null ? null : fs.realpathSync(settings[key] ?? path.join(settings.vault_dir, '_website', name));
  }
  if (!Array.isArray(settings.campaigns) || settings.campaigns.some(c => typeof c !== 'string')) {
    throw new Error('campaigns must be an array of strings');
  }
  if (settings.respect_pov_dates === undefined) settings.respect_pov_dates = false;
  if (typeof settings.respect_pov_dates !== 'boolean') throw new Error('respect_pov_dates must be a boolean');
  validateDate(settings.default_date);
  return settings;
}
export function isInside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
