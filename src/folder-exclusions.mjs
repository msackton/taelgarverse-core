import fs from 'node:fs';
import path from 'node:path';

export const NO_PUBLISH_MARKER = '.nopublish';

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
      if (!entry.isDirectory() || entry.isSymbolicLink() || /^[._]/.test(entry.name) || entry.name.toLowerCase()==='worldbuilding') continue;
      const child = relative ? relative+'/'+entry.name : entry.name;
      if (/^assets?\/dm(?:\/|$)/i.test(child)) continue;
      walk(path.join(directory,entry.name),child);
    }
  };
  walk(root,'');
  return excluded.sort();
}
