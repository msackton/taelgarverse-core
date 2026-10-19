import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
import {validateDate} from './common.mjs';
export * from './common.mjs';

export function loadSettings(filename = process.env.TAELGARVERSE_CONFIG || path.join(ROOT, 'config.example.json')) {
  filename = path.resolve(filename);
  const input = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const settings = {...input, default_date: input.default_date ?? '1750-01-01', campaigns: input.campaigns ?? []};
  for (const key of ['source_dir', 'runtime_dir']) {
    if (typeof input[key] !== 'string') throw new Error('Missing configuration: ' + key);
    settings[key] = fs.realpathSync(path.resolve(path.dirname(filename), input[key]));
  }
  settings.nav_source = input.nav_source === null ? null : fs.realpathSync(
    input.nav_source ? path.resolve(path.dirname(filename),input.nav_source) : path.join(ROOT,'navigation.md'));
  if (!Array.isArray(settings.campaigns) || settings.campaigns.some(c => typeof c !== 'string')) {
    throw new Error('campaigns must be an array of strings');
  }
  validateDate(settings.default_date);
  return settings;
}
export function isInside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
