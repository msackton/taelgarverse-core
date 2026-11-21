import {RenderError, dateKey, validateDate} from './common.mjs';
import {noteCampaignResolver} from './campaign-ownership.mjs';

const normalize = value => String(value ?? '').trim().toLowerCase();
const asList = value => Array.isArray(value) ? value : value ? [value] : [];
function fullDate(value) {
  const date = String(value ?? '');
  try { return validateDate(date); } catch { return null; }
}
function sessionDate(entry) {
  return fullDate(entry.note.metadata.DR_end) || fullDate(entry.note.metadata.DR);
}
function sessionRank(entry) {
  const metadata = entry.note.metadata;
  return [String(metadata.realWorldDate ?? ''), Number(metadata.sessionNumber) || 0, sessionDate(entry) || '', entry.id];
}
function compareSessions(a,b) {
  const left = sessionRank(a), right = sessionRank(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}
export class Contexts {
  static forWebsite(store, registry, settings) {
    return new Contexts(store,registry,settings,{website:true});
  }

  constructor(store, registry, settings, {website=false} = {}) {
    this.settings = settings;
    this.warnings = [];
    this.byId = new Map();
    const resolver = noteCampaignResolver(registry), campaigns = new Map();
    for (const [slug, campaign] of Object.entries(registry.campaigns || {})) {
      // Snapshots published before the index supplied eligibility keep their saved choices.
      if (website && campaign.websiteSelectable === false) continue;
      const code = normalize(campaign.code || slug);
      campaigns.set(code,{...campaign,code,slug});
    }
    this.campaignIdentities = new Map([...resolver.identities].filter(([,code])=>campaigns.has(code)));
    this.campaignCodes = [...campaigns.keys()].sort();
    const sessions = new Map();
    for (const entry of store.entries) {
      if (!entry.note) continue;
      const {type,campaign:code} = resolver.resolve(entry.id,entry.note.metadata);
      if (type !== 'session-note' || !campaigns.has(code)) continue;
      const list = sessions.get(code) || [];
      list.push(entry); sessions.set(code,list);
    }
    const latest = code => {
      const candidates = [...(sessions.get(code) || [])].sort(compareSessions);
      const entry = candidates.at(-1);
      return entry ? {date:sessionDate(entry),source:entry.id} : {date:null,source:null};
    };
    for (const campaign of campaigns.values()) {
      const state = latest(campaign.code);
      this.byId.set(campaign.slug,{
        id:campaign.slug,label:campaign.name,kind:'campaign',campaigns:[campaign.code],...state,
        dateSource:'latest-session',available:!!state.date,
        unavailableReason:state.date ? undefined : state.source ? 'Latest published session has no full DR date' : 'No published session date',
      });
    }
    const dated = [...this.byId.values()].filter(context => context.available);
    dated.sort((a,b) => dateKey(a.date) - dateKey(b.date));
    const latestContext = dated.at(-1);
    const modern = {id:'modern',label:'Modern',kind:'modern',date:latestContext?.date || settings.default_date,
      campaigns:[],available:true,dateSource:latestContext ? 'latest-campaign' : 'configured-fallback',
      source:latestContext?.source || null};
    const custom = {id:'custom',label:'Custom',kind:'custom',date:null,campaigns:[],available:true};
    this.byId = new Map([['modern',modern],...[...this.byId.entries()].sort((a,b)=>a[1].label.localeCompare(b[1].label)),['custom',custom]]);
  }

  list() { return [...this.byId.values()].map(context => ({...context,campaigns:[...context.campaigns]})); }

  compile() { return {contexts:this.list(),identities:[...this.campaignIdentities],codes:this.campaignCodes,warnings:this.warnings}; }

  static hydrate(compiled,settings) {
    return Object.assign(Object.create(Contexts.prototype),{settings,warnings:compiled.warnings,
      byId:new Map(compiled.contexts.map(context=>[context.id,context])),campaignIdentities:new Map(compiled.identities),campaignCodes:compiled.codes});
  }

  resolve(id, date, selectedCampaigns) {
    const context = this.byId.get(id ?? (date === undefined && selectedCampaigns === undefined ? 'modern' : 'custom'));
    if (!context) throw new RenderError(400,'Unknown context');
    if (!context.available) throw new RenderError(400,context.label + ': ' + context.unavailableReason);
    if (context.kind === 'custom') {
      const selected = asList(selectedCampaigns).flatMap(value=>String(value).split(',')).map(normalize).filter(Boolean);
      const allCampaigns = selected.includes('all');
      const campaigns = new Set();
      for (const name of selected) {
        if (name === 'all') continue;
        const code = this.campaignIdentities.get(name);
        if (!code) throw new RenderError(400,'Unknown campaign selection');
        campaigns.add(code);
      }
      return {...context,date:validateDate(date ?? this.byId.get('modern').date),
        campaigns:allCampaigns ? [...this.campaignCodes] : [...campaigns].sort(),...(allCampaigns ? {allCampaigns:true} : {})};
    }
    if (selectedCampaigns !== undefined) throw new RenderError(400,'Use Custom to select campaigns');
    if (date !== undefined && date !== context.date) throw new RenderError(400,'Use Custom to override a context date');
    return {...context,campaigns:[...context.campaigns]};
  }
}
