import {campaignWikiLink} from '../../../src/campaign-roster.mjs';
import {createHeaderContext} from '../../../src/header-core/index.mjs';

export function installNoteQueryAPI(plugin, globals=globalThis) {
  const previous = globals.Taelgarverse;
  let active = true;
  const api = Object.freeze({
    apiVersion: 1,
    async getNoteQueries() {
      if (!active) throw new Error('Taelgarverse has unloaded.');
      const {runtime,fallback} = await plugin.snapshots.getSnapshot();
      if (!active) throw new Error('Taelgarverse has unloaded.');
      const {dates,locations,names,templates} = createHeaderContext(runtime,{date:fallback});

      return Object.freeze({
        getCampaigns() {
          return runtime.campaigns.map(({code,name,campaignRoot})=>({code,name,campaignRoot}));
        },
        normalizeDR(value, {boundary='start'}={}) {
          if (boundary !== 'start' && boundary !== 'end') {
            throw new Error('DR date boundary must be start or end.');
          }
          if (value instanceof Date) {
            if (!Number.isFinite(value.getTime())) return null;
            value = value.toISOString().slice(0,10);
          } else if (typeof value?.toISODate === 'function') {
            value = value.toISODate();
          }
          const result = dates.normalizeDate(value,boundary === 'end');
          return Number.isFinite(result?.sort) ? {...result} : null;
        },
        formatNoteText(template, notePath, {date}={}) {
          const page = runtime.getPageByPath(notePath);
          if (!page) return null;
          const at = date ?? plugin.dates.getDate(page.metadata,fallback);
          return templates.formatDisplayString(template,{name:page.name,frontmatter:page.metadata},at);
        },
        getRecordedOrigin(notePath) {
          const page = runtime.getPageByPath(notePath);
          return page ? locations.getOrigin(page.metadata)?.location ?? null : null;
        },
        isResolvable(reference, sourcePath='') {
          if (typeof reference !== 'string') return false;
          const text = reference.trim();
          const target = (campaignWikiLink(text)?.target ?? text).split('#',1)[0].trim();
          if (!target) return false;

          const file = plugin.app.metadataCache.getFirstLinkpathDest(target,sourcePath);
          if (file) return file.path.toLowerCase().endsWith('.md');
          return Boolean(names.getFileForTarget(target));
        },
      });
    },
  });
  globals.Taelgarverse = api;
  plugin.register(()=>{
    active = false;
    if (globals.Taelgarverse !== api) return;
    if (previous === undefined) delete globals.Taelgarverse;
    else globals.Taelgarverse = previous;
  });
}
