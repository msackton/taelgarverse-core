export const registryPath = '_sessions/campaign-registry.json';

// Both Obsidian and the publication build project only the fields used for rendering.
export function campaignRegistry(index, frontmatter) {
  if (!index || Array.isArray(index) || typeof index !== 'object' || !Object.keys(index).length)
    throw new Error(registryPath + ': expected a nonempty map of campaign IDs to index notes');
  const campaigns = Object.create(null), paths = new Set();
  for (const [id, path] of Object.entries(index)) {
    if (!/^[a-z][a-z0-9]*$/.test(id) || typeof path !== 'string' || !path.endsWith('.md') ||
        path.includes('\\') || path.split('/').some(part => !part || part === '..' || part === '.') || paths.has(path))
      throw new Error(id + ': invalid or duplicate index path ' + path);
    const fields = frontmatter(path);
    if (typeof fields?.name !== 'string' || !fields.name.trim())
      throw new Error(id + ': missing index note or name in ' + path);
    paths.add(path);
    campaigns[id] = {
      name: fields.name, code: id, campaignRoot: fields.campaignDirectory,
      notePattern: fields.notePattern, partyPage: fields.partyPage?.replace(/\.md$/, ''),
      sessionRoot: fields.sessionBundleDirectory?.replace(/^_sessions\//, ''),
      sessionBundleDirectory: fields.sessionBundleDirectory,
    };
  }
  return {campaigns};
}
