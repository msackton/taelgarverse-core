import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {repositoryVersion} from './repository-version.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const release = {...repositoryVersion(root),publishedAt:new Date().toISOString()};
if (!release.commit) throw new Error('Cannot determine the core Git commit for this deployment.');
fs.mkdirSync(path.join(root,'.generated'),{recursive:true});
fs.writeFileSync(path.join(root,'.generated/core-release.mjs'),
  'export default ' + JSON.stringify(release) + ';\n');
