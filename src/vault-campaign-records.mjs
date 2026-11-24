import fs from 'node:fs';
import path from 'node:path';
import {parseNote} from './content-store.mjs';
import {readWebsiteMarkdown,stripWebsiteSecrets} from './website-secrets.mjs';
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
        let metadata={};
        try { metadata=parseNote(readWebsiteMarkdown(path.join(root,relative))).metadata; }
        catch { /* Keep unsupported source metadata out of the campaign projection. */ }
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
    readNote:async relative=>stripWebsiteSecrets(await fs.promises.readFile(path.join(root,relative),'utf8'),relative),
    readBundles:campaign=>readCampaignSessionBundles(root,registry,campaign),
  });
}
