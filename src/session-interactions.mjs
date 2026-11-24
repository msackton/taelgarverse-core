// The Worker receives a compiled projection. Registered bundle paths supply session identity.
import fs from 'node:fs';
import path from 'node:path';
import {parseSessionRecap} from './recap-parser.mjs';
import {readMappedSession} from './mapped-sessions.mjs';
import {readVaultSessionBundles} from './vault-session-bundles.mjs';
import {registryPath} from './campaign-registry.mjs';
import {readVaultCampaigns} from './vault-campaigns.mjs';
import {stripWebsiteSecrets} from './website-secrets.mjs';

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
    const files = fs.readdirSync(cleaned, {withFileTypes: true})
      .filter(file => file.isFile() && /-(?:session-recap\.md|entity-map\.json|interactions\.json)$/.test(file.name))
      .map(file => file.name).sort((a,b) => a.localeCompare(b));
    const recaps = [], maps = [];
    for (const file of files) {
      const key = directory + '/cleaned/' + file;
      const filename = path.join(cleaned, file);
      if (fs.statSync(filename).size > 8 * 1024 * 1024) throw new Error('Session artifact is too large: ' + key);
      if (!file.endsWith('-session-recap.md')) {
        if (!file.endsWith('-interactions.json') || !files.includes(file.replace(/-interactions\.json$/, '-entity-map.json'))) maps.push(key);
        continue;
      }
      const text = stripWebsiteSecrets(fs.readFileSync(filename,'utf8'),key);
      try {
        recaps.push(parseSessionRecap(text, key, identity));
      } catch (error) {
        warnings.push(key + ': ' + error.message);
        recaps.push({key, ...identity, invalid: true});
      }
    }
    if (!maps.length) {
      bundles.push(...recaps);
      continue;
    }
    // A mapped session reserves its identity even when its artifacts are invalid.
    const validRecaps = recaps.filter(recap => !recap.invalid);
    const recap = validRecaps.length === 1 ? validRecaps[0] : null;
    for (const key of maps) {
      try {
        if (!key.endsWith('-entity-map.json')) throw new Error('Interactions are missing their entity map');
        bundles.push(readMappedSession(settings, key, identity, recap));
      } catch (error) {
        warnings.push(key + ': ' + error.message);
        bundles.push({key, ...identity, mapped: true, invalid: true});
      }
    }
  }
  return {bundles, warnings};
}
