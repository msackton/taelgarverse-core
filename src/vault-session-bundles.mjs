import fs from 'node:fs';
import path from 'node:path';
import {indexSessionBundles} from './session-bundles.mjs';

export function readVaultSessionBundles(vault, registry) {
  return indexSessionBundles(registry, directory => {
    let current = vault;
    for (const part of directory.split('/')) {
      current = path.join(current, part);
      if (!fs.lstatSync(current, {throwIfNoEntry: false})?.isDirectory()) return [];
    }
    return fs.readdirSync(current, {withFileTypes: true})
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  });
}
