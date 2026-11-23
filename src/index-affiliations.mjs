import {getPageType} from './header-core/metadata.mjs';
import {HeaderDataError} from './header-core/index.mjs';

// Records come from the same dated affiliation service used by note headers.
// The most recent qualifying day selects the term; its start breaks ties.
export function matchAffiliation(records, sourcePath, {target, lookup, recursive, scope, affiliationTypes, first, until}) {
  const roles = new Set();
  let date, term, cycle;
  function reachesTarget(org) {
    const seen = new Set();
    let group = lookup(org,sourcePath);
    while (group) {
      if (group.path === target.path) return true;
      if (!recursive || getPageType(group.metadata) !== 'group' || !group.metadata.partOf) return false;
      if (seen.has(group.path)) {
        cycle = new HeaderDataError('organization',[...seen,group.path]);
        return false;
      }
      seen.add(group.path);
      group = lookup(group.metadata.partOf,group.path);
    }
    return false;
  }
  for (const record of records) {
    if (affiliationTypes && !affiliationTypes.has(record.type)) continue;
    const last = record.endDate.sort < until.sort ? record.endDate : until;
    const start = Math.max(first,record.startDate.sort);
    if (start > last.sort || (scope !== 'ever' && last.sort < until.sort)) continue;
    if (!reachesTarget(record.org)) continue;
    roles.add(record.title);
    if (!term || last.sort > date.sort || (last.sort === date.sort && record.startDate.sort > term.startDate.sort)) {
      date = last;
      term = record;
    }
  }
  if (term) return {date,term,roles:[...roles]};
  if (cycle) throw cycle;
}
