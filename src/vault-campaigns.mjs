import fs from 'node:fs';
import path from 'node:path';
import {parseNote} from './content-store.mjs';
import {registryPath, campaignRegistry} from './campaign-registry.mjs';

export function readVaultCampaigns(vault) {
  const root = fs.realpathSync(vault);
  const index = JSON.parse(fs.readFileSync(path.join(root, registryPath), 'utf8'));
  return campaignRegistry(index, target => {
    const file = fs.realpathSync(path.join(root, target));
    if (path.relative(root, file).split(path.sep)[0] === '..') throw new Error('External campaign index note: ' + target);
    return parseNote(fs.readFileSync(file, 'utf8')).metadata;
  });
}
