export const registryPath = '_sessions/campaign-registry.json';

// Adapt the index notes at the Obsidian boundary. Shared rendering code also
// serves the website, which still uses its existing input.
export async function readCampaignRegistry(app) {
  const index = JSON.parse(await app.vault.adapter.read(registryPath));
  if (!index || Array.isArray(index) || typeof index !== 'object' || !Object.keys(index).length)
    throw new Error(registryPath + ': expected a nonempty map of campaign IDs to index notes');
  const campaigns = Object.create(null);
  const usedPaths = new Set();
  for (const [id, path] of Object.entries(index)) {
    if (!/^[a-z][a-z0-9]*$/.test(id) || typeof path !== 'string' || !path.endsWith('.md') ||
        path.split('/').some(part => !part || part === '..' || part === '.') || usedPaths.has(path))
      throw new Error(id + ': invalid or duplicate index path ' + path);
    const file = app.vault.getAbstractFileByPath(path);
    const fields = file && app.metadataCache.getFileCache(file)?.frontmatter;
    if (typeof fields?.name !== 'string' || !fields.name.trim())
      throw new Error(id + ': missing index note or name in ' + path);
    usedPaths.add(path);
    campaigns[id] = {
      name: fields.name, code: id, campaignRoot: fields.campaignDirectory,
      notePattern: fields.notePattern, partyPage: fields.partyPage?.replace(/\.md$/, ''),
      sessionRoot: fields.sessionBundleDirectory?.replace(/^_sessions\//, ''),
      sessionBundleDirectory: fields.sessionBundleDirectory,
    };
  }
  return {campaigns};
}
