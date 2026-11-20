import {registryPath, campaignRegistry} from '../../../src/campaign-registry.mjs';
export {registryPath};

export async function readCampaignRegistry(app) {
  const index = JSON.parse(await app.vault.adapter.read(registryPath));
  return campaignRegistry(index, path => {
    const file = app.vault.getAbstractFileByPath(path);
    return file && app.metadataCache.getFileCache(file)?.frontmatter;
  });
}
