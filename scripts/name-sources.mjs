import fs from 'node:fs';
import path from 'node:path';

export const nameDecisionPath = settings => settings.vault_dir ? path.join(settings.vault_dir,'_Plugins','Name Explorer','Name Decisions.jsonl') : null;
export function readNameDecisions(settings) {
  const filename=nameDecisionPath(settings);
  if (!filename || !fs.existsSync(filename)) return [];
  return fs.readFileSync(filename,'utf8').split(/\r?\n/).flatMap((line,index)=>{
    if (!line.trim()) return [];
    try {
      const record=JSON.parse(line);
      if (!record || typeof record!=='object' || Array.isArray(record)) throw new Error('Expected an object');
      return [record];
    } catch { throw new Error('Invalid name explorer decision on line '+(index+1)); }
  });
}
