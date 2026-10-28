import {fileURLToPath} from 'node:url';
import {loadSettings} from '../../src/config.mjs';

export const fixtureVault=fileURLToPath(new URL('../fixtures/legacy-vault/',import.meta.url));
export const fixtureConfig=fileURLToPath(new URL('../fixtures/test-config.json',import.meta.url));

// Explicit fixture config bypasses config.local.json and TAELGARVERSE_CONFIG.
// Callers may replace source_dir with their own disposable notes directory.
export const testSettings=()=>loadSettings(fixtureConfig,{env:{}});
