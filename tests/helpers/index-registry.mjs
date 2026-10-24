import fs from 'node:fs';
import {parseIndexRegistry,compileIndexRegistry} from '../../src/index-registry.mjs';
export const registrySource=fs.readFileSync(new URL('../../examples/indexes.yaml',import.meta.url),'utf8');
export const registryDocument=parseIndexRegistry(registrySource);
export const indexRegistry=compileIndexRegistry(registryDocument);
