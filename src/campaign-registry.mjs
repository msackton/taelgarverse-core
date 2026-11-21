export const registryPath = '_sessions/campaign-registry.json';

// Both Obsidian and the publication build project only the fields used for rendering.
export function campaignRegistry(index, frontmatter) {
  if (!index || Array.isArray(index) || typeof index !== 'object' || !Object.keys(index).length)
    throw new Error(registryPath + ': expected a nonempty map of campaign IDs to index notes');
  const campaigns = Object.create(null), paths = new Set(), bundleDirectories = new Map();
  for (const [id, path] of Object.entries(index)) {
    if (!/^[a-z][a-z0-9]*$/.test(id) || typeof path !== 'string' || !path.endsWith('.md') ||
        path.includes('\\') || path.split('/').some(part => !part || part === '..' || part === '.') || paths.has(path))
      throw new Error(id + ': invalid or duplicate index path ' + path);
    const fields = frontmatter(path);
    if (typeof fields?.name !== 'string' || !fields.name.trim())
      throw new Error(id + ': missing index note or name in ' + path);
    const directory = fields.sessionBundleDirectory;
    if (directory !== undefined && directory !== null && directory !== '') {
      if (typeof directory !== 'string' || directory.includes('\\') ||
          directory.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error(id + ': invalid sessionBundleDirectory ' + directory);
      }
      for (const [other, owner] of bundleDirectories) {
        if (directory === other || directory.startsWith(other + '/') || other.startsWith(directory + '/')) {
          throw new Error('Overlapping session bundle directories for ' + id + ' and ' + owner);
        }
      }
      bundleDirectories.set(directory, id);
    }
    paths.add(path);
    const continuities = Array.isArray(fields.continuity) ? fields.continuity : [fields.continuity];
    campaigns[id] = {
      name: fields.name, code: id, campaignRoot: fields.campaignDirectory,
      notePattern: fields.notePattern, partyPage: fields.partyPage?.replace(/\.md$/, ''),
      sessionBundleDirectory: fields.sessionBundleDirectory,
      websiteSelectable: fields.canon === 'canonical' && continuities.length > 0 &&
        continuities.every(continuity => continuity === 'main'),
    };
  }
  return {campaigns};
}
