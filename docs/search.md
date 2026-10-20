# Production search index and publication

The D1 compiler, publication lifecycle, Worker search API and results page are
implemented. Local previews use SQLite with the same compiler and query. AI
Search remains independent; production AI integration is deferred and production
search contacts no AI service.

## App search

The header search shows suggestions as you type. Without JavaScript, its form
opens `/?q=...`. `/api/search` returns the
same results as JSON: query, resolved context, source (`full-text` or `page-names`),
fallback status/notice, selected `type`, results, and `hasMore`/`limit`/`offset`. Each result contains
page/title/context URL, a plain-text excerpt, and UTF-16 highlight ranges into that
excerpt. No SQL, provider errors or raw HTML are returned.

Words match together and support word beginnings; double quotes request an exact
phrase, including across paragraph boundaries. Unicode names and aliases use the
FTS tokenizer's accent-insensitive matching. Search puts exact page filenames,
display titles, and metadata names first, exact aliases second, then uses weighted
FTS5 ranking (title 10, aliases 6, prose 1) with a stable page
tie-break. Queries are limited to 256 characters and 16 terms, with 20 results by
default, maximum 50 per page, and offsets through 1,000. FTS operators are always
quoted as literal words. Exact-name preference ignores case, accents, surrounding
phrase quotes, and repeated whitespace. It is applied before pagination; a short
partial-title match cannot displace an exact name because of its FTS score.
Empty queries browse available page names without D1.

The results form offers a **Content type** selector, also supported by `type` on
`/?q=...` and `/api/search`. Omit it or use an empty string for all content. Values
are `person`, `place`, `group`, `session-note`, `event`, `object`, `power`,
`ancestry`, `creature`, and `other`. Types come from existing frontmatter tags,
including scalar/list tags, optional leading `#`, and nested tags such as
`place/settlement`. The first recognized type tag wins; notes without one are
Other. This does not infer types from folders or require new vault metadata.
Unknown filter values return HTTP 400.

Type filtering happens in SQL before ranking and pagination, using a JSON list
of matching page slugs from the active snapshot's metadata. Exact-name ranking
also uses snapshot metadata. Neither needs a database migration, content
republication, or article-body reads. The same filter applies to empty-query
browsing and page-name fallback. Pagination, header searches, and context/Behind
the Curtain controls preserve the selection; changing a query or type starts
at the first page.

`src/search.mjs` builds two read-only queries in one D1 batch: a readiness check
against the active R2 index's search descriptor, and the ranked query restricted
to that revision's matching date/campaign/DM rules **before** ordering/limiting.
The request-local `first-primary` D1 session starts with current readiness data;
results are not cached between contexts or publications. The Worker uses the
`SEARCH_DB` binding directly. It never reads R2 note shards for search. Excerpts
come from the matched visible text version, and page metadata is checked again
before any result is returned.

Missing bindings, legacy/unsupported descriptors, unready/stale indexes or query
errors fall back to visible title/path/alias matches with a clear notice. A valid
full-text query with zero matches stays empty. Raw errors, queries and excerpts
are excluded from fallback logs. Result URLs, pagination, forms and the context
selector retain Custom campaign subsets, dates and Behind the Curtain choices.

Node previews lazily compile and stage an in-memory SQLite index on the first
nonempty search, reusing it until the server closes. This needs `node:sqlite`
(Node 22.12 may need `NODE_OPTIONS=--experimental-sqlite`); if unavailable, page-name
fallback still works. There are no Cloudflare credentials or remote calls in this
path. A full vault can take several seconds to initialize the first search.

Deploy the updated core to add the route and UI, then publish content to stage
the matching production index. Either order is supported because older snapshots
fall back to page names. Local checks do not index the vault remotely. Production
AI enrichment is deferred; the isolated pilot is not
imported into the app.

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

POV filtering is a request-local reader preference: `pov=1` enables it and
`pov=0` disables it. A microsite's authored `enforcePoV` overrides the URL
preference when present. Otherwise, when omitted, `respect_pov_dates` supplies the site default
(`false` in new and older snapshots). See [page visibility](vault.md#when-a-page-is-shown).
The compiler retains text for both POV modes, while keeping birth/creation,
activity, campaign, and DM intervals. At query time, snapshot metadata supplies
the list of available pages for the reader's preference; SQL applies that list
before ranking, pagination, and limits. This works with existing production
indexes without article-body reads, database changes, or republication.
The preference stays in result links, pagination, forms, and floating suggestions.
Changing the configuration default still invalidates the publication fingerprint
and requires publication to store the new default.

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
| `tv_search_meta` | Production ownership marker and SQL schema version, currently 2. |
| `tv_search_documents` | Immutable versions: page, title, aliases, prose, and content-hash ID. |
| `tv_search_fts` | External-content FTS5 index over title, aliases, and prose. |
| `tv_search_revisions` | R2 revision, compiler version/digest, expected counts, and staging/ready state. |
| `tv_search_rules` | Revision membership and context rules. |
| `tv_search_gc` | Transaction-scoped authorization to remove retired ready memberships. |
| `tv_search_publish_lock` | One shared publisher/cleanup owner across machines. |

Staging inserts only missing text versions and resumes incomplete membership in
bounded batches. It reads back every document and rule, verifies content hashes
and the full manifest digest, then checks FTS5 integrity and marks the revision
ready in one final transaction. A failed batch leaves an inactive staging
revision. Triggers prevent updates to text and changes to ready membership or
revisions. Activation and unchanged-publish skips verify ready state, version,
digest, and membership counts. The query service filters on the active
R2 revision and context rules before ranking/limiting; `EXISTS` avoids duplicate
matches from multiple applicable rules.

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
node scripts/prepare-cloudflare.mjs
node scripts/search.mjs stage --dry-run
node scripts/cloudflare.mjs upload-remote
node scripts/search.mjs stage --remote
node scripts/search.mjs verify --remote
node scripts/cloudflare.mjs publish
```

The internal `node scripts/cloudflare.mjs publish` repeats upload/staging and verifies D1 readiness under the shared
publication lock before activating content. Full local preview does the same locally. The search
CLI defaults to `.cache/cloudflare/latest.json`; `--report FILE` selects retained
artifacts. Except with `--dry-run`, select `--local` or `--remote` explicitly.
Search commands never activate R2 content. Interrupted staging can be retried
with the same artifacts; completed text is reused. Confirm a publisher has stopped
before removing its lock. Older snapshots without search remain renderable.

Publication retains **the active snapshot plus one previous successful snapshot**
in both R2 and D1. `published/current.json` records `retentionVersion: 1` and a
single `previous` snapshot without nested history. Only a distinct successful
activation rotates `previous`; failed staging never does. Publishing the same
revision keeps the existing rollback choice. The first publication with this
policy preserves the previously active publication and removes older history;
legacy upload timestamps are never used to guess which snapshot was good.

After activation, cleanup verifies both retained R2 indexes, their referenced
objects and any D1 search descriptors. It removes older note shards/indexes,
unreferenced content-addressed assets, older D1 memberships, and orphaned search
text, including FTS postings. Assets/text shared by the retained revisions stay
stored once. Unknown R2 keys are left alone. Failed/unactivated staging can exist
temporarily and is collected after the next successful publication. Local build
artifacts and the separate AI Search pilot are outside this policy.

A D1 publication lock serializes supported publishers, manual uploads, search
staging, cleanup and rollback across machines. It has no automatic expiry, so a
slow publisher cannot lose its lock while uploading. Normal completion/failure
releases it; after a killed process, confirm **all publishers, staging, cleanup,
and rollback operations have stopped on every computer**, then rerun the full
publisher with `--unblock` added to the existing options, for example
`npm run publish -- --no-strict --unblock`. The flag is that confirmation; it
clears only the observed owner in `tv_search_publish_lock` and acquires the new
lock in one transaction before continuing publication. If a different owner
acquires the lock during recovery, the command stops without stealing it.
There is no automatic retry or expiry. `--local --unblock` targets only local D1;
`--build-only --unblock` is rejected. The full publisher also retains its local
file lock; see [local lock recovery](deploy.md#if-something-goes-wrong).
Direct Wrangler object/SQL writes bypass this coordination.

Full publication and `--assets-only` share the same lock. Assets-only stages
missing media but does not stage D1 search, activate a snapshot, or prune storage.
The normal run rechecks the destination and reuses those assets before staging
search. R2 and D1 share refreshable credentials so a long media transfer does not
leave D1 using the token captured at startup. An unsuccessful lock release
preserves the original failure in the error message and explains `--unblock`.

Cleanup failure reports that the new content is already active and leaves both
retained snapshots available. An unchanged full publication retries cleanup
without rebuilding. Maintenance commands require an explicit destination:

```sh
node scripts/maintain-content.mjs prune --remote --dry-run
node scripts/maintain-content.mjs prune --remote
node scripts/maintain-content.mjs rollback --remote
```

`--local` selects the emulators instead. Dry-run reads and verifies the current
retention plan without deletion or migration. Rollback checks both snapshots,
then swaps active/previous under the same lock; the publication being replaced
becomes the single rollback choice. No local prepared artifacts are required.
Legacy pointers must first pass through a successful retention-enabled publish.

Schema 1 upgrades transactionally to schema 2 without dropping existing ready
generations. Guarded deletion and the FTS delete trigger permit coordinated GC
while preserving ordinary ready-generation immutability. FTS segments are
compacted during cleanup; SQLite can reuse freed database pages. Retention limits
stored content history, not Cloudflare-managed Time Travel history or a guarantee
that the displayed database file size immediately shrinks.

## Verification and measured scope

Publisher progress reports count staged/reused text versions, staged visibility
rules, and read-back verification batches. The integrity check, activation, and
retention phases have explicit status messages, with ten-second reminders during
long requests. A completed upload does not imply activation; `New content is live`
is emitted only after the publication pointer write succeeds.

Image/map recipe records in `build-cache/derivatives-v1.json` are build hints,
not retained content roots. They are saved after successful asset transfers under
the same publication lock; this neither stages search nor activates a revision.
Retention can collect unreferenced derivatives, and the next build regenerates
them when the catalog's output inventory check fails.

Fast tests cover live Worker API/HTML routing, ranking/prefix/phrase/Unicode
queries, escaped highlighted excerpts, bounded pagination, fallback, revision
changes/rollback, request isolation, and renderer parity across dates/subsets/DM modes, date
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
