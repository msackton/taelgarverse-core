import {registryPath, campaignRegistry} from '../../../src/campaign-registry.mjs';
export {registryPath};

export async function readCampaignRegistrySource(app) {
  const index = JSON.parse(await app.vault.adapter.read(registryPath));
  const registry=campaignRegistry(index, path => {
    const file = app.vault.getAbstractFileByPath(path);
    return file && app.metadataCache.getFileCache(file)?.frontmatter;
  });
  return {index,registry};
}

export async function readCampaignRegistry(app) {
  return (await readCampaignRegistrySource(app)).registry;
}
