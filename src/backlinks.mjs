import {dateKey, pageUrl} from './common.mjs';
import {availableInContext} from './content-store.mjs';
import {filterComments} from './comments.mjs';
import {createMarkdown, renderMarkdown} from './markdown.mjs';

// Backlinks describe authored references. Remove the generated header slot,
// including legacy saved headers, before indexing the remaining article body.
// The legacy boundary matches OutputHandler.regenerateHeader in CustomJS.
export function authoredBody(note) {
  const marker = /^[ \t\r\n]*<!-- taelgar:header -->[ \t]*(?:\r?\n|$)/;
  if (marker.test(note.body)) return note.body.replace(marker,'');
  if (!note.metadata.headerVersion || !note.metadata.tags) return note.body;
  const lines = note.body.split('\n');
  let end = lines.findIndex(line => line.trim() === '');
  if (end < 0) end = lines.length;
  const next = lines.findIndex((line,index) => index > end && line.trim() !== '');
  if (next >= 0) end = next - 1;
  return lines.slice(0,end).some(line => line.trim().startsWith('#')) ? lines.slice(end).join('\n') : note.body;
}

const firstDate = 10101;
const fullDate = key => String(Math.floor(key / 10000)).padStart(4,'0') + '-' +
  String(Math.floor(key / 100) % 100).padStart(2,'0') + '-' + String(key % 100).padStart(2,'0');

// Compile the finite comment states, rather than treating a link inside a
// hidden campaign/date/comment block as a public reference. Parsing the whole
// filtered article also preserves Markdown reference definitions and literals.
export function buildBacklinkIndex(store) {
  const md = createMarkdown(), notesMarkdown = createMarkdown({html:false});
  const incoming = new Map(), warnings = [];
  for (const entry of store.bySlug.values()) {
    if (typeof entry.note.body !== 'string') continue;
    const source = authoredBody(entry.note), conditions = [];
    try {
      filterComments(source,{date:'0001-01-01',source:entry.id,conditions});
      const campaigns = [...new Set(conditions.map(rule => rule.campaign).filter(code => code && code !== 'none'))].sort();
      const dates = [...new Set([firstDate,...conditions.map(rule => rule.date).filter(Boolean)])].sort((a,b) => a-b);
      const states = campaigns.reduce((states,code)=>[...states,...states.map(state=>[...state,code])],[[]]);
      const targets = new Map(), cache = new Map();
      for (let i = 0; i < dates.length; i++) {
        const from = dates[i], before = dates[i+1], date = fullDate(from), masks = new Map();
        for (let j = 0; j < states.length; j++) for (const dm of [false,true]) {
          const context = {date,campaigns:states[j],dm}, dmNotes = [];
          const body = filterComments(source,{...context,source:entry.id,notes:dmNotes});
          const key = JSON.stringify([body,dmNotes]);
          let links = cache.get(key);
          if (!links) {
            links = new Set();
            renderMarkdown(md,body,{store,entry,date,context,dmNotes,notesMarkdown,warnings:[],pageLinks:links});
            cache.set(key,links);
          }
          for (const target of links) {
            if (target === entry.slug) continue;
            const mask = masks.get(target) || new Set();
            mask.add(j*2+Number(dm)); masks.set(target,mask);
          }
        }
        for (const [target,mask] of masks) {
          const rules = [];
          if (mask.size === states.length*2) rules.push({});
          else for (let j = 0; j < states.length; j++) {
            const publicLink = mask.has(j*2), dmLink = mask.has(j*2+1);
            if (!publicLink && !dmLink) continue;
            const excluded = campaigns.filter(code=>!states[j].includes(code));
            const rule = {...(states[j].length ? {campaigns:states[j]} : {}),...(excluded.length ? {exceptCampaigns:excluded} : {})};
            if (publicLink !== dmLink) rule.dm = dmLink;
            rules.push(rule);
          }
          const merged = targets.get(target) || new Map();
          for (const rule of rules) {
            const key = JSON.stringify(rule), intervals = merged.get(key) || [];
            const previous = intervals.at(-1);
            if (previous && previous.before === from) previous.before = before;
            else intervals.push({...rule,from,before});
            merged.set(key,intervals);
          }
          targets.set(target,merged);
        }
      }
      for (const [target,rules] of targets) {
        const when = [...rules.values()].flat().map(({from,before,...rule}) => ({...rule,
          ...(from !== firstDate ? {from} : {}),...(before !== undefined ? {before} : {})}));
        const sources = incoming.get(target) || [];
        sources.push({source:entry.slug,when}); incoming.set(target,sources);
      }
    } catch (error) {
      if (error.status !== 422) throw error;
      // The article itself still reports 422. Never publish partial references
      // from an unsafe source or turn an unrelated article into an error page.
      warnings.push('Backlinks omitted for ' + entry.id + ': ' + error.reason);
    }
  }
  return {version:2,byTarget:Object.fromEntries([...incoming].sort(([a],[b]) => a.localeCompare(b))),warnings};
}

// Ownership is separate from page availability: campaign articles remain
// directly readable, but their incoming references belong to their campaign.
export function buildBacklinkCampaigns(store, registry) {
  const normalize = value => String(value ?? '').trim().toLowerCase();
  const identities = new Map(), roots = [];
  for (const [slug,campaign] of Object.entries(registry.campaigns || {})) {
    const code = normalize(campaign.code);
    if (!code) continue;
    for (const name of [slug,code,campaign.name,...(campaign.aliases || [])]) {
      if (normalize(name)) identities.set(normalize(name),code);
    }
    const root = normalize(campaign.campaignRoot).replace(/\\/g,'/').replace(/\/+$/,'');
    if (root) roots.push({root,code});
  }
  roots.sort((a,b)=>b.root.length-a.root.length);
  const ownership = new Map();
  for (const entry of store.bySlug.values()) {
    const metadata = entry.note.metadata, raw = metadata.campaign;
    const declared = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(normalize).filter(Boolean);
    if (declared.length) {
      ownership.set(entry.slug,[...new Set(declared.map(name=>identities.get(name)).filter(Boolean))]);
      continue;
    }
    const id = normalize(entry.id).replace(/\\/g,'/');
    const owner = roots.find(({root})=>id.startsWith(root+'/'));
    if (owner) ownership.set(entry.slug,[owner.code]);
    else {
      const tags = Array.isArray(metadata.tags) ? metadata.tags : [metadata.tags];
      // An unregistered campaign folder or unassigned session has no matching
      // selectable context. An empty membership excludes it in every context.
      if (/^campaigns\/[^/]+\//.test(id) || tags.includes('session-note')) ownership.set(entry.slug,[]);
    }
  }
  return ownership;
}

export function linkedFrom(index, store, target, context, sourceCampaigns) {
  if (!index || !availableInContext(store.bySlug.get(target),context)) return [];
  const date = dateKey(context.date), campaigns = new Set(context.campaigns.map(code => code.toLowerCase()));
  const incoming = Object.hasOwn(index.byTarget,target) ? index.byTarget[target] : [];
  return incoming.filter(link => {
    const source = store.bySlug.get(link.source);
    const ownership = sourceCampaigns?.get(link.source);
    return (context.allCampaigns || !ownership || ownership.some(code=>campaigns.has(code))) &&
      source?.slug !== target && availableInContext(source,context) && link.when.some(rule =>
      (!rule.campaign || campaigns.has(rule.campaign)) &&
      (!rule.campaigns || rule.campaigns.every(code=>campaigns.has(code))) &&
      (!rule.exceptCampaigns || !rule.exceptCampaigns.some(code => campaigns.has(code))) &&
      (rule.dm === undefined || rule.dm === Boolean(context.dm)) &&
      (rule.from === undefined || date >= rule.from) && (rule.before === undefined || date < rule.before));
  }).map(link => {
    const source = store.bySlug.get(link.source);
    return {page:source.slug,title:source.title,url:pageUrl(source.slug,context.date,context)};
  }).sort((a,b) => a.title.localeCompare(b.title) || a.page.localeCompare(b.page));
}
