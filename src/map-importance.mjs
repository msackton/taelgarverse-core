import {hexLevel} from './map-hex-hierarchy.mjs';

// Importance is display prominence, not settlement type or population. Match
// marker thresholds to readable grid scales, independent of crops and DPR.
export const DEFAULT_MAP_IMPORTANCE='local';
export const MAP_IMPORTANCE=Object.freeze([
  Object.freeze({value:'world',label:'World',detail:'Overview',depth:null}),
  Object.freeze({value:'regional',label:'Regional',detail:'24-mile view',depth:0}),
  Object.freeze({value:'local',label:'Local',detail:'9-mile view',depth:1}),
  Object.freeze({value:'detail',label:'Detail',detail:'3-mile view',depth:2}),
]);
export function mapImportance(value=DEFAULT_MAP_IMPORTANCE){
  const tier=MAP_IMPORTANCE.find(tier=>tier.value===value);
  if(!tier)throw new Error('Importance must be world, regional, local or detail.');
  return tier;
}
export function importanceVisible(value,scale){
  const tier=mapImportance(value);
  return tier.depth===null || hexLevel(tier.depth).hexPixels*scale>=18-1e-9;
}
