import fs from 'node:fs';
import path from 'node:path';

export const NO_PUBLISH_MARKER = '.nopublish';

// Walkers pass vault-relative paths with forward slashes and prune directories
// before visiting their children. An underscore on a filename is allowed.
export function isPublicationEntry(entry, relative) {
  if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'AGENTS.md') return false;
  if (/^assets?\/dm(?:\/|$)/i.test(relative)) return false;
  if (entry.isDirectory()) return !entry.name.startsWith('_') && entry.name.toLowerCase() !== 'worldbuilding';
  return entry.isFile();
}

// Read original-vault policy separately: materialized exports omit dotfiles.
// Relative paths also make publication fingerprints independent of the machine.
export function readFolderExclusions(root) {
  if (!root || !fs.existsSync(root)) return [];
  const excluded = [];
  const walk = (directory,relative) => {
    if (fs.existsSync(path.join(directory,NO_PUBLISH_MARKER))) {
      excluded.push(relative);
      return; // A child cannot opt back into an excluded ancestor.
    }
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const child = relative ? relative+'/'+entry.name : entry.name;
      if (entry.isDirectory() && isPublicationEntry(entry,child)) walk(path.join(directory,entry.name),child);
    }
  };
  walk(root,'');
  return excluded.sort();
}
