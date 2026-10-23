// Versioned request/result contract shared by Node and the desktop plugin.
export const DATAVIEW_EXPORT_VERSION=1;

export function validateDataviewRequest(request) {
  if(request?.schemaVersion!==DATAVIEW_EXPORT_VERSION || typeof request.id!=='string' || !request.id ||
      typeof request.vaultPath!=='string' || !Array.isArray(request.queries) ||
      !Number.isInteger(request.blockTimeoutMs) || request.blockTimeoutMs<1)throw new Error('Invalid Dataview export request.');
  const ids=new Set();
  for(const query of request.queries) {
    if(typeof query.id!=='string' || !query.id || ids.has(query.id) || typeof query.query!=='string' ||
        typeof query.sourcePath!=='string' || !query.sourcePath.endsWith('.md') ||
        query.sourcePath.includes('\\') || query.sourcePath.startsWith('/') || query.sourcePath.includes(':') ||
        query.sourcePath.split('/').some(part=>!part || part==='.' || part==='..'))throw new Error('Invalid Dataview query in export request.');
    ids.add(query.id);
  }
}

export function validateMaterializationReport(report,request) {
  if(report?.schemaVersion!==DATAVIEW_EXPORT_VERSION || report.id!==request.id || report.status!=='ok' ||
      !report.outputComplete || !Array.isArray(report.results))throw new Error('Taelgarverse did not produce a complete Dataview export: '+(report?.error || 'invalid or stale result.'));
  const pending=new Set(request.queries.map(query=>query.id));
  for(const result of report.results) {
    if(!pending.delete(result.id) || !['ok','error'].includes(result.status) ||
        (result.status==='ok' ? typeof result.markdown!=='string' : typeof result.message!=='string'))throw new Error('Invalid or duplicate Dataview query result.');
  }
  if(pending.size)throw new Error('Dataview export is missing query results.');
}
