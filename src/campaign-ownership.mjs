// Ownership is separate from page availability: campaign articles remain
// directly readable, but their incoming references belong to their campaign.
export function buildBacklinkCampaigns(store, registry) {
  const {identities,folderCampaign} = campaignLookups(registry,{legacyBacklinks:true});
  const ownership = new Map();
  for (const entry of store.bySlug.values()) {
    const metadata = entry.note.metadata, raw = metadata.campaign;
    const declared = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(backlinkKey).filter(Boolean);
    if (declared.length) {
      ownership.set(entry.slug,[...new Set(declared.map(name=>identities.get(name)).filter(Boolean))]);
      continue;
    }
    const owner = folderCampaign(entry.id);
    if (owner) ownership.set(entry.slug,[owner]);
    else {
      const id = backlinkKey(entry.id).replaceAll('\\','/');
      const tags = Array.isArray(metadata.tags) ? metadata.tags : [metadata.tags];
      // An unregistered campaign folder or unassigned session has no matching
      // selectable context. An empty membership excludes it in every context.
      if (/^campaigns\/[^/]+\//.test(id) || tags.includes('session-note')) ownership.set(entry.slug,[]);
    }
  }
  return ownership;
}

const campaignRecordTypes = new Set(['session-note', 'story', 'meta', 'source']);
const folderKnowledgeTypes = new Set(['person', 'object', 'place', 'group', 'power', 'event']);
const noteTypes = new Set([...campaignRecordTypes, ...folderKnowledgeTypes, 'ancestry', 'creature', 'background']);
const typeAliases = new Map([['item', 'object'], ['organization', 'group'], ['primary-source', 'source']]);

const list = value => Array.isArray(value) ? value : value == null ? [] : [value];
const backlinkKey = value => String(value ?? '').trim().toLowerCase();
const normalize = value => typeof value === 'string' ? backlinkKey(value) : '';

function noteType(tags) {
  for (const tag of list(tags).flatMap(value => normalize(value).split(/[\s,]+/))) {
    const root = tag.replace(/^#/, '').split('/')[0];
    const type = typeAliases.get(root) ?? root;
    if (noteTypes.has(type)) return type;
  }
}

function campaignLookups(registry, {legacyBacklinks=false} = {}) {
  const identities = new Map(), codes = new Map(), roots = [];
  const key = legacyBacklinks ? backlinkKey : normalize;
  const pathKey = value => key(value).replaceAll('\\', '/');
  for (const [id, campaign] of Object.entries(registry.campaigns || {})) {
    const code = key(legacyBacklinks ? campaign.code : campaign.code || id);
    if (legacyBacklinks && !code) continue;
    // Linked from retains its historical alias precedence. The note resolver
    // gives registry IDs priority over compatibility names.
    const aliases = legacyBacklinks
      ? [id, code, campaign.name, ...(campaign.aliases || [])]
      : [campaign.name, ...list(campaign.aliases)];
    for (const value of aliases) {
      const name = key(value);
      if (name) identities.set(name, code);
    }
    const root = pathKey(campaign.campaignRoot).replace(/\/+$/, '');
    if (root) roots.push({root, code});
    codes.set(key(id), code);
    codes.set(code, code);
  }
  if (!legacyBacklinks) {
    for (const [id, code] of codes) identities.set(id, code);
  }
  roots.sort((a, b) => b.root.length - a.root.length);
  return {
    identities,
    folderCampaign(path) {
      const normalizedPath = pathKey(path);
      const id = legacyBacklinks ? normalizedPath : normalizedPath.replace(/\/+$/, '');
      return roots.find(({root}) => id.startsWith(root + '/'))?.code;
    },
  };
}

export function noteCampaignResolver(registry) {
  const lookups = campaignLookups(registry);
  const {identities} = lookups;
  return {
    identities,
    resolve(path, metadata) {
      const type = noteType(metadata?.tags);
      const folderCampaign = lookups.folderCampaign(path);
      const campaign = campaignRecordTypes.has(type)
        ? identities.get(normalize(metadata.campaign)) ?? folderCampaign
        : undefined;
      const knownTo = new Set();
      if (!campaignRecordTypes.has(type) || type === 'source') {
        for (const value of list(metadata?.knownTo)) {
          const code = identities.get(normalize(value));
          if (code) knownTo.add(code);
        }
      }
      if (folderCampaign && folderKnowledgeTypes.has(type)) knownTo.add(folderCampaign);
      return {type, campaign, knownTo: [...knownTo], folderCampaign};
    },
  };
}
