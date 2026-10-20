// Website filters use the vault's existing type tags, including nested tags.
export const searchTypes = [
  ['person','People'],['place','Places'],['group','Groups and organizations'],
  ['session-note','Session notes'],['event','Events'],['object','Objects'],
  ['power','Powers'],['ancestry','Ancestries'],['creature','Creatures'],['other','Other'],
];
export function searchType(entry) {
  const raw = entry.note.metadata.tags ?? [];
  const tags = (Array.isArray(raw) ? raw : [raw]).filter(tag=>typeof tag==='string')
    .flatMap(tag=>tag.split(/[\s,]+/)).map(tag=>tag.replace(/^#/,'').toLowerCase().split('/')[0]);
  return tags.find(tag=>tag!=='other' && searchTypes.some(([type])=>type===tag)) || 'other';
}
