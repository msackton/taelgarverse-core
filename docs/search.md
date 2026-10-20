# Production search index and publication

The D1 compiler and publication lifecycle are implemented. Worker search API and
UI integration are deferred; the existing page finder continues to operate. AI
Search remains independent and optional. This pipeline contacts no AI service.

## Compiler and visibility

`scripts/compile-search.mjs` uses the shared article availability, comment,
Markdown, and prose-extraction rules. It omits generated headers, executable
query source, Mermaid source, hidden HTML, and UI controls. Note embeds contribute
a reference without expanding another note's body. Materialized query output is
searchable when present in the normal export.

Each note's date transitions, campaign conditions, publication exclusions, and
DM/public modes produce a finite set of visible whole-note text versions.
Identical versions within a note share a content-hashed document. Rules record
inclusive `from`, exclusive `before` (or null), required/forbidden campaign codes,
and `dm` (true, false, or null for either). Unrelated campaigns have no effect.
This supports arbitrary Custom dates/subsets and matches across paragraphs.
The separate campaign-ownership filter used by backlinks is not applied here.

An unsafe comment omits the entire note and records a warning. More than 4,096
candidate states in one note, or a document larger than 1.5 MB, stops compilation.
Sparse notes retain searchable headings, titles, and aliases.

## Artifacts and database

Preparation compiles from the same source snapshot as R2. The local revision
directory contains `search.json`: compiler version, content-hashed documents,
rules, digest, statistics, and warnings. It may contain DM prose and stays under
the ignored cache, excluded from the R2 upload manifest. R2 `index.json` contains
only `search: {version, digest, documents, rules}`. This descriptor participates
in the content revision hash. Build reports add `searchFile` and `searchStats`.
Staging validates the manifest's association with that R2 index before any writes.

The production database is `taelgarverse-search`, binding `SEARCH_DB`, with its
explicit ID in `wrangler.json`. Local overrides support `d1_databases`. Remote
operations check the account/name/ID. The pilot database is incompatible; foreign
ownership or SQL schema versions stop initialization.

| Table | Purpose |
| --- | --- |
| `tv_search_meta` | Production ownership marker and SQL schema version, currently 1. |
| `tv_search_documents` | Immutable versions: page, title, aliases, prose, and content-hash ID. |
| `tv_search_fts` | External-content FTS5 index over title, aliases, and prose. |
| `tv_search_revisions` | R2 revision, compiler version/digest, expected counts, and staging/ready state. |
| `tv_search_rules` | Revision membership and context rules. |

Staging inserts only missing text versions and resumes incomplete membership in
bounded batches. It reads back every document and rule, verifies content hashes
and the full manifest digest, then checks FTS5 integrity and marks the revision
ready in one final transaction. A failed batch leaves an inactive staging
revision. Triggers prevent updates to text and changes to ready membership or
revisions. Activation and unchanged-publish skips verify ready state, version,
digest, and membership counts. The future query service must filter on the active
R2 revision and context rules before ranking/limiting; `EXISTS` avoids duplicate
matches from multiple applicable rules. No public query route is added here.

## Publishing and recovery

The normal publisher exports through Obsidian, prepares images/content/search,
uploads immutable R2 objects, stages and verifies D1, rechecks source/configuration
fingerprints, then updates `published/current.json`. R2 and D1 do not share a
transaction: that existing R2 pointer is the single activation point. Failures
before activation preserve the previous publication. AI readiness is never a gate.

`--build-only` compiles without R2/D1 requests. `--local` uses local R2 and D1.
Remote publication needs D1 Read/Write alongside the existing R2 permissions;
Wrangler OAuth login supports these. Token capture disables file logging and
never prints raw output. The full publisher saves a local search receipt; its
checkpoint includes the search descriptor. Compiler/renderer, locked dependency,
source, and D1 destination changes invalidate the build fingerprint.

The separate maintenance flow is:

```sh
npm run cf:prepare
npm run search:index -- stage --dry-run
npm run cf:upload
npm run search:index -- stage --remote
npm run search:index -- verify --remote
npm run cf:publish
```

`cf:publish` independently verifies D1 readiness before activating search-aware
content. `cf:seed` stages local D1 before moving its local R2 pointer. The search
CLI defaults to `.cache/cloudflare/latest.json`; `--report FILE` selects retained
artifacts. Except with `--dry-run`, select `--local` or `--remote` explicitly.
Search commands never activate R2 content. Interrupted staging can be retried
with the same artifacts; completed text is reused. Confirm a publisher has stopped
before removing its lock. Older snapshots without search remain renderable.

Previous ready revisions and their immutable text remain available for rollback.
Verify retained artifacts with `search:index -- verify --remote --report FILE`
before restoring their R2 pointer. Direct Wrangler pointer writes bypass the
supported activation checks. There is no automatic D1 garbage collection, matching
R2 retention. Text is shared across revisions; membership is retained for each.
Cleanup/migration requires a coordinated retention design before removing any
index used by a retained publication.

## Verification and measured scope

Fast tests cover renderer parity across arbitrary dates/subsets/DM modes, date
availability, exclusions, malformed comments, whole-note matching, resume/reuse,
corruption rejection, immutable revisions, deletion, and publication failure gates.
SQLite tests need `node:sqlite` (Node 22.12: `NODE_OPTIONS=--experimental-sqlite`).
Run real local D1/R2 emulators explicitly:

```sh
node --test tests/search-d1.integration.mjs tests/publish-r2.integration.mjs
```

On 2026-10-19, raw-vault local compilation produced 4,947 text versions and 4,949
rules for 2,944 notes: 9,650,839 prose bytes, about 11.3 seconds to compile and
4.2 seconds to stage/verify locally. An unchanged retry sent zero documents and
wrote zero rows. These are local measurements, not remote timing or full
publication billing estimates. One malformed-comment note was omitted and
reported: `Groups/Cultures/Deno'qai Tribes/Deno'qai.md`. Exports can differ.

The production database was created and its schema initialized on 2026-10-19.
A remote count check confirmed zero documents, rules, and revisions. No vault
content was indexed remotely, no publication activated, and no Worker deployed.

Provider references: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/),
and [FTS5 support](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
