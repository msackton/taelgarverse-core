import fs from 'node:fs';
import path from 'node:path';
import {parseNote} from './content-store.mjs';
import {readWebsiteMarkdown} from './website-secrets.mjs';
import {registryPath, campaignRegistry} from './campaign-registry.mjs';

export function readVaultCampaignRegistry(vault) {
  const root = fs.realpathSync(vault);
  const index = JSON.parse(fs.readFileSync(path.join(root, registryPath), 'utf8'));
  const registry=campaignRegistry(index, target => {
    const file = fs.realpathSync(path.join(root, target));
    if (path.relative(root, file).split(path.sep)[0] === '..') throw new Error('External campaign index note: ' + target);
    return parseNote(readWebsiteMarkdown(file)).metadata;
  });
  return {indexes:index,registry};
}

export function readVaultCampaigns(vault) {
  return readVaultCampaignRegistry(vault).registry;
}
