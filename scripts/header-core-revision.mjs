import fs from 'node:fs';
import {createHash} from 'node:crypto';

// Publication diagnostics identify the maintained implementation, independently
// of the frozen legacy CustomJS revision and the vault content revision.
export function headerCoreRevision() {
  const directory=new URL('../src/header-core/',import.meta.url),hash=createHash('sha256');
  for(const filename of fs.readdirSync(directory).filter(name=>name.endsWith('.mjs')).sort()) {
    hash.update(filename+'\0'+fs.readFileSync(new URL(filename,directory),'utf8').replace(/\r\n/g,'\n'));
  }
  return hash.digest('hex');
}
