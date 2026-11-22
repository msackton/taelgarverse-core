import {readVaultCampaignRegistry} from './vault-campaigns.mjs';
import {readVaultCampaignSource} from './vault-campaign-records.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {Store} from './store.mjs';
import {createHeaderSnapshot} from './header-core/index.mjs';
import {RenderEngine} from './render-engine.mjs';
import {ROOT} from './config.mjs';
import {repositoryVersion} from '../scripts/repository-version.mjs';
import {LocalSearch} from './local-search.mjs';
import {readCampaignHomes} from './website-sources.mjs';
import {readInteractionBundles} from './session-interactions.mjs';
export {document} from './render-engine.mjs';

export class Engine extends RenderEngine {
  constructor(settings) {
    const store = new Store(settings);
    const {indexes,registry}=readVaultCampaignRegistry(settings.vault_dir);
    const interactions=readInteractionBundles(settings,registry);
    store.warnings.push(...interactions.warnings);
    const headers = createHeaderSnapshot({
      pages: store.entries.filter(e => e.note).map(e => ({path: e.id, metadata: e.note.metadata})),
      coreMeta: JSON.parse(fs.readFileSync(path.join(settings.vault_dir, '.obsidian/metadata.json'), 'utf8')),
      registry,
    });
    super({settings,store,headers,
      navigationSource:settings.nav_source ? fs.readFileSync(settings.nav_source,'utf8') : null,
      homeSource:settings.home_source ? fs.readFileSync(settings.home_source,'utf8') : null,
      campaignHomes:readCampaignHomes(settings),interactionBundles:interactions.bundles,
      campaignSource:readVaultCampaignSource(settings.vault_dir,{indexes,registry})});
    this.releases = {core:repositoryVersion(ROOT),content:repositoryVersion(settings.vault_dir),local:true};
  }
  search(input,context){this.localSearch ??= new LocalSearch(this.store);return this.localSearch.search(input,context);}
  closeSearch(){this.localSearch?.close();this.localSearch=null;}
}
