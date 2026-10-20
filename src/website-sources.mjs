import fs from 'node:fs';
import path from 'node:path';
import {parseNote} from './content-store.mjs';
import {validCampaignHost} from './campaign-sites.mjs';

export function readCampaignHomes(settings) {
  const sources = {};
  if (!settings.vault_dir) return sources;
  const directory = path.join(settings.vault_dir,'_website');
  if (!fs.existsSync(directory)) return sources;
  for (const file of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (!file.isFile() || !file.name.endsWith('.md') || ['home.md','navigation.md','AGENTS.md'].includes(file.name)) continue;
    const source = fs.readFileSync(path.join(directory,file.name),'utf8');
    // Other website planning/support files are not publication inputs.
    const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
    if (!frontmatter || !/^context\s*:/m.test(frontmatter[1])) continue;
    const host = file.name.slice(0,-3);
    if (!validCampaignHost(host)) throw new Error('Invalid campaign homepage filename: '+file.name);
    parseNote(source); // Fail publication on malformed opted-in YAML.
    sources[host] = source;
  }
  return sources;
}
