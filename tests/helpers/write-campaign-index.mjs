import fs from 'node:fs';
import path from 'node:path';
import {indexedCampaigns} from './indexed-campaigns.mjs';
import {stringify} from 'yaml';

export function writeCampaignIndex(root, registry={campaigns:{example:{name:'Example',code:'example'}}}) {
  const {index,files}=indexedCampaigns(registry);
  fs.mkdirSync(path.join(root,'_sessions'),{recursive:true});
  fs.writeFileSync(path.join(root,'_sessions/campaign-registry.json'),JSON.stringify(index));
  for (const {path:target,metadata} of files.values()) {
    const file=path.join(root,target);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,'---\n'+stringify(metadata)+'---\n');
  }
}
