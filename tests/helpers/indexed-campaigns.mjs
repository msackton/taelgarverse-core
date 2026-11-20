// Present the same test campaigns through the vault's ID-to-note index.
export function indexedCampaigns(registry) {
  const index={}, files=new Map();
  for(const [slug,campaign] of Object.entries(registry.campaigns)) {
    const path='Campaigns/_Index/'+campaign.code+'.md';
    index[campaign.code]=path;
    files.set(path,{path,metadata:{name:campaign.name,campaignDirectory:campaign.campaignRoot,
      partyPage:campaign.partyPage && campaign.partyPage+'.md',notePattern:campaign.notePattern,
      sessionBundleDirectory:'_sessions/'+(campaign.sessionRoot || slug)}});
  }
  return {index,files};
}
