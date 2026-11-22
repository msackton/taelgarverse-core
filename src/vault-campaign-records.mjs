import fs from 'node:fs';
import path from 'node:path';
import {parseNote} from './content-store.mjs';
import {campaignSourceEntry,createCampaignSource,isCampaignSourcePath} from './campaign-source.mjs';
import {readCampaignSessionBundles} from './vault-campaign-sessions.mjs';
import {readVaultCampaignRegistry} from './vault-campaigns.mjs';

function campaignEntries(root) {
  const entries=[];
  function walk(folder) {
    for(const file of fs.readdirSync(path.join(root,folder),{withFileTypes:true})) {
      const relative=folder ? folder+'/'+file.name : file.name;
      if(file.isDirectory()) {
        if(isCampaignSourcePath(relative+'/')) walk(relative);
      } else if(file.isFile() && /\.md$/i.test(relative) && isCampaignSourcePath(relative)) {
        const source=fs.readFileSync(path.join(root,relative),'utf8');
        let metadata={};
        try { metadata=parseNote(source).metadata; } catch { /* Matches an uncached Obsidian frontmatter entry. */ }
        entries.push(campaignSourceEntry(relative,metadata));
      }
    }
  }
  walk('');
  return entries;
}

export function readVaultCampaignSource(vault,{indexes,registry}=readVaultCampaignRegistry(vault)) {
  const root=fs.realpathSync(vault);
  return createCampaignSource({
    indexes,registry,entries:()=>campaignEntries(root),
    readNote:relative=>fs.promises.readFile(path.join(root,relative),'utf8'),
    readBundles:campaign=>readCampaignSessionBundles(root,registry,campaign),
  });
}
