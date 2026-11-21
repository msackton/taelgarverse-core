// The Worker receives the compiled projection. Only the recap header and Cast
// are read here, with identity supplied by the registered bundle path.
import fs from 'node:fs';
import path from 'node:path';
import {parseSessionRecap} from './recap-parser.mjs';
import {readVaultSessionBundles} from './vault-session-bundles.mjs';
import {registryPath} from './campaign-registry.mjs';
import {readVaultCampaigns} from './vault-campaigns.mjs';

export function readInteractionBundles(settings, registry) {
  const bundles = [], warnings = [];
  const vault = settings.vault_dir;
  if (!vault) return {bundles, warnings};
  if (!registry) {
    if (!fs.existsSync(path.join(vault, registryPath))) return {bundles, warnings};
    registry = readVaultCampaigns(vault);
  }
  for (const [directory, identity] of readVaultSessionBundles(vault, registry).entries()) {
    const cleaned = path.join(vault, directory, 'cleaned');
    if (!fs.lstatSync(cleaned, {throwIfNoEntry: false})?.isDirectory()) continue;
    for (const file of fs.readdirSync(cleaned, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || !file.name.endsWith('-session-recap.md')) continue;
      const key = directory + '/cleaned/' + file.name;
      const filename = path.join(cleaned, file.name);
      if (fs.statSync(filename).size > 8 * 1024 * 1024) throw new Error('Session recap is too large: ' + key);
      const text = fs.readFileSync(filename, 'utf8');
      try {
        bundles.push(parseSessionRecap(text, key, identity));
      } catch (error) {
        warnings.push(key + ': ' + error.message);
        bundles.push({key, ...identity, invalid: true});
      }
    }
  }
  return {bundles, warnings};
}
