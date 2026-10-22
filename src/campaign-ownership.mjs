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
