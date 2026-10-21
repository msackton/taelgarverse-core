import fs from 'node:fs';
import {headerFixture} from './header-fixture.mjs';

export const vaultCases=JSON.parse(fs.readFileSync(new URL('../fixtures/header-vault-cases.json',import.meta.url),'utf8'));
export const vaultOutputs=JSON.parse(fs.readFileSync(new URL('../fixtures/header-vault-outputs.json',import.meta.url),'utf8'));
const baseNotes=Object.fromEntries(vaultCases.pages.map(p=>[p.path,p.metadata]));

export function vaultHeaderFixture(date='1752-01-01') {
  return headerFixture({date,baseNotes,displayRules:vaultCases.coreMeta,campaignRegistry:vaultCases.registry});
}

export function vaultCasePath(name) {
  const example=vaultCases.pages.find(c=>c.path.split('/').at(-1)===name+'.md');
  if(!example)throw new Error('Missing tagged vault fixture: '+name);
  return example.path;
}
