import fs from 'node:fs';
import path from 'node:path';
import {Store} from './store.mjs';
import {initializeHeaders,renderHeader} from './headers.mjs';
import {RenderEngine} from './render-engine.mjs';
import {ROOT} from './config.mjs';
import {repositoryVersion} from '../scripts/repository-version.mjs';
import {LocalSearch} from './local-search.mjs';
export {document} from './render-engine.mjs';

export class Engine extends RenderEngine {
  constructor(settings) {
    const store = new Store(settings);
    const headers = initializeHeaders({
      runtimeDir: settings.vault_dir,
      pages: store.entries.filter(e => e.note).map(e => ({path: e.id, metadata: e.note.metadata})),
      coreMeta: JSON.parse(fs.readFileSync(path.join(settings.vault_dir, '.obsidian/metadata.json'), 'utf8')),
      registry: JSON.parse(fs.readFileSync(path.join(settings.vault_dir, '_scripts/session_note_campaigns.json'), 'utf8')),
    });
    super({settings,store,headers,renderHeader,
      navigationSource:settings.nav_source ? fs.readFileSync(settings.nav_source,'utf8') : null,
      homeSource:settings.home_source ? fs.readFileSync(settings.home_source,'utf8') : null});
    this.releases = {core:repositoryVersion(ROOT),content:repositoryVersion(settings.vault_dir),local:true};
  }
  search(input,context){this.localSearch ??= new LocalSearch(this.store);return this.localSearch.search(input,context);}
  closeSearch(){this.localSearch?.close();this.localSearch=null;}
}
