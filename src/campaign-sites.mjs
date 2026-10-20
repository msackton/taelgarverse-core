import {RenderError} from './common.mjs';
import {parseNote} from './content-store.mjs';

export const validCampaignHost = name => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name) && !['www','home','navigation'].includes(name);

// Campaign selections come from homepage campaigns metadata.
// Immutable publication data. Host selection and the context lock are request-local.
export class CampaignSites {
  constructor(sources = {}, contexts) {
    if (!sources || typeof sources !== 'object' || Array.isArray(sources)) throw new RenderError(503,'Campaign homes must be an object');
    this.byHost = new Map();
    for (const [host,source] of Object.entries(sources)) {
      if (!validCampaignHost(host) || typeof source !== 'string') throw new RenderError(503,'Invalid campaign homepage: '+host);
      let note;
      try { note = parseNote(source); }
      catch { throw new RenderError(503,'Invalid campaign homepage YAML: '+host); }
      const {campaigns,date,title} = note.metadata;
      const invalid = message => new RenderError(503,'_website/'+host+'.md: '+message);
      if (Object.hasOwn(note.metadata,'context')) throw invalid('context is no longer supported; use campaigns instead');
      if (title !== undefined && (typeof title !== 'string' || !title.trim())) throw invalid('title must be a nonempty string');
      if (!(typeof campaigns === 'string' || Array.isArray(campaigns) && campaigns.every(value=>typeof value === 'string' && value.trim()))) throw invalid('campaigns must be a list of campaign codes or a comma-separated string');
      if (date !== undefined && typeof date !== 'string') throw invalid('date must be YYYY-MM-DD or modern');
      const fixedDate = date === 'modern' ? undefined : date;
      let selection;
      try { selection = contexts.resolve('custom',fixedDate,campaigns); }
      catch (error) { throw invalid(error.message); }
      const selected = contexts.list().filter(context=>context.kind==='campaign' && selection.campaigns.includes(context.campaigns[0]));
      // Count normalized, distinct campaigns, so duplicate names/aliases still
      // follow the single campaign's session date rather than Modern.
      const single = selected.length === 1 ? selected[0] : null;
      this.byHost.set(host,{host,note,label:title?.trim() || (selection.allCampaigns ? 'All campaigns' : selected.map(context=>context.label).join(' + ') || 'Shared world'),
        ...(single ? {contextId:single.id} : {contextId:'custom',date:fixedDate,campaigns:selection.allCampaigns ? 'all' : selection.campaigns})});
    }
  }

  forHost(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/,'');
    if (['taelgar.org','www.taelgar.org','localhost','www.localhost'].includes(host)) return null;
    const suffix = ['.taelgar.org','.localhost'].find(suffix=>host.endsWith(suffix));
    if (!suffix) return null; // workers.dev, ordinary local previews and test hosts.
    const site = this.byHost.get(host.slice(0,-suffix.length));
    if (!site) throw new RenderError(404,'Campaign site not found');
    return site;
  }
}
