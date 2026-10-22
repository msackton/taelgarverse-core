import fs from 'node:fs';
import path from 'node:path';
import {parseNote} from './content-store.mjs';
import {validCampaignHost} from './campaign-sites.mjs';

export function readCampaignHomes(settings) {
  const sources = {};
  const filenames = new Map();
  if (!settings.vault_dir) return sources;
  const directory = path.join(settings.vault_dir,'_website');
  if (!fs.existsSync(directory)) return sources;
  for (const file of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (!file.isFile() || !file.name.endsWith('.md') || ['home.md','navigation.md','AGENTS.md'].includes(file.name)) continue;
    const source = fs.readFileSync(path.join(directory,file.name),'utf8');
    // Other website planning/support files are not publication inputs.
    const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
    // Detect the removed context field too, so validation reports a migration
    // error instead of silently dropping an existing campaign homepage.
    if (!frontmatter || !/^(?:context|campaigns)\s*:/m.test(frontmatter[1])) continue;
    const {metadata} = parseNote(source); // Fail publication on malformed opted-in YAML.
    const explicitHost = Object.hasOwn(metadata,'subdomain');
    const host = explicitHost ? metadata.subdomain : file.name.slice(0,-3);
    if (typeof host !== 'string' || !validCampaignHost(host)) {
      throw new Error(explicitHost ? '_website/'+file.name+': subdomain must be a lowercase DNS label (excluding www, home and navigation)' : 'Invalid campaign homepage filename: '+file.name);
    }
    if (filenames.has(host)) throw new Error('Duplicate campaign subdomain "'+host+'": _website/'+filenames.get(host)+' and _website/'+file.name);
    filenames.set(host,file.name);
    sources[host] = source;
  }
  return sources;
}
