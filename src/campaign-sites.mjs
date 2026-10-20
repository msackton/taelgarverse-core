import {RenderError} from './common.mjs';
import {parseNote} from './content-store.mjs';

export const validCampaignHost = name => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name) && !['www','home','navigation'].includes(name);

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
      const id = note.metadata.context;
      if (typeof id !== 'string' || contexts.byId.get(id)?.kind !== 'campaign') throw new RenderError(503,'_website/'+host+'.md: context must be a registered campaign ID');
      this.byHost.set(host,{host,contextId:id,note});
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
