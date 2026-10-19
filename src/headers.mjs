// In-process adapter for trusted CustomJS. Note bodies remain data.
// Shared indexes/code are loaded once; every render gets a fresh VM context.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const helpers = `
Array.prototype.last = function () { return this[this.length - 1]; };
Array.prototype.first = function () { return this[0]; };
String.prototype.contains = String.prototype.includes;
`;
// Host arrays use DataArray below; helpers only extend VM-local prototypes.
const helperScript = new vm.Script(helpers);
const renderScript = new vm.Script(
  "customJS.OutputHandler.regenerateHeader(request.source, request.name, request.metadata, 'website').join('\\n')",
);
const classes = {
  DateManager: 'dataUtil.js', NameManager: 'nameManager.js',
  WhereaboutsManager: 'whereabouts.js', TokenParser: 'tokenParser.js',
  AffiliationManager: 'affiliationManager.js', EventManager: 'eventManager.js',
  OutputHandler: 'outputs.js', util: 'metadataUtils.js', init: 'loadMetadata.js',
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

class DataArray extends Array {
  where(predicate) { return this.filter(predicate); }
  first() { return this[0]; }
  last() { return this[this.length - 1]; }
}

function adaptArrays(value) {
  if (Array.isArray(value)) return DataArray.from(value.map(adaptArrays));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, adaptArrays(v)]));
  return value;
}

export function initializeHeaders(rawInput) {
  const input = adaptArrays(rawInput);
  const files = deepFreeze(input.pages.map(p => ({
    path: p.path, basename: path.posix.basename(p.path, '.md'), frontmatter: p.metadata,
  })));
  const byTarget = new Map();
  for (const file of files) {
    for (const key of [file.path, file.path.replace(/\.md$/, ''), file.basename, `${file.basename}.md`]) {
      const normalized = key.toLowerCase();
      const candidates = byTarget.get(normalized) ?? new Set();
      candidates.add(file);
      byTarget.set(normalized, candidates);
    }
  }
  const pages = deepFreeze(DataArray.from(files.map(file => ({
    ...file.frontmatter, file: {name: file.basename, path: file.path, frontmatter: file.frontmatter},
  }))));
  // getLeadBy currently scans every page and normalizes every affiliation.
  // Index a superset of possible targets; the original code still decides
  // leadership type, dates, and display text. Unexpected field shapes retain
  // the full scan so this optimization cannot silently omit relationships.
  const affiliationsByTarget = new Map();
  // A reference full-scan mode is retained for differential tests/benchmarks.
  let canIndexAffiliations = input.indexAffiliations !== false;
  for (const page of pages) {
    const targets = new Set();
    for (const field of [page.leaderOf, page.affiliations]) {
      if (!field) continue;
      if (!Array.isArray(field)) { canIndexAffiliations = false; continue; }
      for (const item of field) {
        if (typeof item === 'string') targets.add(item);
        else if (item && typeof item === 'object') targets.add(item.org || item.place);
        else canIndexAffiliations = false;
      }
    }
    for (const target of targets) {
      if (target === undefined || target === null) continue;
      const candidates = affiliationsByTarget.get(String(target)) ?? new DataArray();
      candidates.push(page);
      affiliationsByTarget.set(String(target), candidates);
    }
  }
  for (const candidates of affiliationsByTarget.values()) Object.freeze(candidates);
  const app = deepFreeze({
    vault: {getRoot: () => ({path: ''}), getMarkdownFiles: () => files},
    metadataCache: {
      getFirstLinkpathDest: target => {
        const matches = byTarget.get(target.toLowerCase());
        return matches?.size === 1 ? [...matches][0] : undefined;
      },
      getFileCache: file => ({frontmatter: file.frontmatter}),
    },
    plugins: {plugins: {dataview: {api: {pages: () => pages}}}},
  });
  const scripts = Object.entries(classes).map(([name, filename]) => {
    const code = fs.readFileSync(path.join(input.runtimeDir, '_scripts/customJS', filename), 'utf8');
    return [name, new vm.Script(`(${code})`, {filename})];
  });
  return {app, scripts, pages, affiliationsByTarget, canIndexAffiliations,
    coreMeta: deepFreeze(input.coreMeta), registry: deepFreeze(input.registry)};
}

export function renderHeader(snapshot, rawRequest) {
  const request = adaptArrays(rawRequest);
  const customJS = {state: {overrideDate: request.date, coreMeta: adaptArrays(structuredClone(snapshot.coreMeta))}};
  let queryPages = snapshot.pages;
  const app = {...snapshot.app,
    plugins: {plugins: {dataview: {api: {pages: () => queryPages}}}},
  };
  const context = vm.createContext({
    customJS, request, app, window: {app},
    console: {log() {}, warn() {}},
  });
  helperScript.runInContext(context);
  for (const [name, script] of snapshot.scripts) {
    const Constructor = script.runInContext(context, {timeout: 2000});
    customJS[name] = new Constructor();
  }
  customJS.state.campaignRegistry = customJS.init.normalizeCampaignRegistry(snapshot.registry);
  customJS.state.coreMeta.campaigns = customJS.state.campaignRegistry;
  if (snapshot.canIndexAffiliations) {
    const originalGetLeadBy = customJS.AffiliationManager.getLeadBy.bind(customJS.AffiliationManager);
    customJS.AffiliationManager.getLeadBy = (target, date) => {
      const previous = queryPages;
      queryPages = snapshot.affiliationsByTarget.get(String(target)) ?? new DataArray();
      try { return originalGetLeadBy(target, date); }
      finally { queryPages = previous; }
    };
  }
  return renderScript.runInContext(context, {timeout: 10000});
}
