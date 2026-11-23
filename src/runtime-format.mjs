import {createHash} from 'node:crypto';
export const RUNTIME_VERSION=2;
export const runtimeHash=value=>createHash('sha256').update(value).digest('hex');
export const assetPartition=target=>runtimeHash(target).slice(0,2);
export const runtimeFilePattern=/^runtime\/(?:render|navigation|headers|backlinks|search-metadata|maps|asset-keys|assets\/[a-f0-9]{2}|(?:notes|backlinks)\/[0-9]{4,}|campaigns\/[a-z][a-z0-9]*)\.json$/;
export function validRuntimeDescriptor(value){return value && runtimeFilePattern.test(value.file || '') && /^[a-f0-9]{64}$/.test(value.sha256 || '');}

export function validRuntimeManifest(manifest,revision) {
  if (!manifest || manifest.version!==RUNTIME_VERSION || manifest.revision!==revision ||
      !Number.isSafeInteger(manifest.pages) || manifest.pages<0 || !manifest.contexts || !Array.isArray(manifest.sites) ||
      !manifest.parts || !manifest.assets || typeof manifest.assets!=='object' || Array.isArray(manifest.assets)) return false;
  const names={search:'search-metadata',navigation:'navigation',headers:'headers',backlinks:'backlinks',render:'render',maps:'maps'};
  return Object.entries(names).every(([name,file])=>manifest.parts[name]?.file==='runtime/'+file+'.json') &&
    Object.values(manifest.parts).every(validRuntimeDescriptor) &&
    Object.entries(manifest.assets).every(([key,part])=>/^[a-f0-9]{2}$/.test(key) &&
      validRuntimeDescriptor(part) && part.file==='runtime/assets/'+key+'.json') &&
    (manifest.assetKeys===undefined || (validRuntimeDescriptor(manifest.assetKeys) && manifest.assetKeys.file==='runtime/asset-keys.json'));
}

export function validInteractionIndex(index) {
  return index?.version===2 && index.byTarget!==null && typeof index.byTarget==='object' && !Array.isArray(index.byTarget);
}
