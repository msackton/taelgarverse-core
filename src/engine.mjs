import fs from 'node:fs';
import path from 'node:path';
import {Store} from './store.mjs';
import {initializeHeaders,renderHeader} from './headers.mjs';
import {RenderEngine} from './render-engine.mjs';
export {document} from './render-engine.mjs';

export class Engine extends RenderEngine {
  constructor(settings) {
    const store = new Store(settings);
    const headers = initializeHeaders({
      runtimeDir: settings.runtime_dir,
      pages: store.entries.filter(e => e.note).map(e => ({path: e.id, metadata: e.note.metadata})),
      coreMeta: JSON.parse(fs.readFileSync(path.join(settings.runtime_dir, '.obsidian/metadata.json'), 'utf8')),
      registry: JSON.parse(fs.readFileSync(path.join(settings.runtime_dir, '_scripts/session_note_campaigns.json'), 'utf8')),
    });
    super({settings,store,headers,renderHeader,navigationSource:settings.nav_source ? fs.readFileSync(settings.nav_source,'utf8') : null});
  }
}
