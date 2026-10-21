import {createHash} from 'node:crypto';
export const RUNTIME_VERSION=2;
export const supportedRuntimeVersion=version=>version===1 || version===RUNTIME_VERSION;
export const runtimeHash=value=>createHash('sha256').update(value).digest('hex');
export const assetPartition=target=>runtimeHash(target).slice(0,2);
export const runtimeFilePattern=/^runtime\/(?:render|navigation|headers|backlinks|search-metadata|assets\/[a-f0-9]{2}|(?:notes|backlinks)\/[0-9]{4,})\.json$/;
export function validRuntimeDescriptor(value){return value && runtimeFilePattern.test(value.file || '') && /^[a-f0-9]{64}$/.test(value.sha256 || '');}
