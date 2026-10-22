# How the site runs on Cloudflare

The live site is [taelgar.org](https://taelgar.org/), also available at
[www.taelgar.org](https://www.taelgar.org/) and
[taelgarverse.msackton.workers.dev](https://taelgarverse.msackton.workers.dev/).
Cloudflare runs the website and stores the published copies of the vault.
Your local Obsidian vault is where you edit the content.

Campaign subdomains use this same Worker. The wildcard route is declared in
`wrangler.json`; wildcard DNS and HTTPS coverage must also be configured before
Markdown-only campaign activation works. See [campaign landing pages](campaign-sites.md)
for setup, the Cleenseau opt-in, and checks for existing subdomains.

Both custom domains are attached to the `taelgarverse` Worker and declared in
`wrangler.json`. Cloudflare manages their DNS records and HTTPS certificates.
On **2026-10-20**, both domains returned HTTP 200 over HTTPS for the homepage
and `/health`; health reported `ok` with 3,029 pages. The domain was already
active on Cloudflare, but had no Worker domain attachment before this setup.

For preview, CI, publication, and account setup, see [Development and publication workflows](deploy.md).

## The pieces

| Piece | What it does |
| --- | --- |
| **Worker: `taelgarverse`** | The program that turns notes into web pages. It chooses what to show for the reader's selected campaign and date. |
| **R2 storage: `taelgarverse-content`** | Holds the published notes, images, audio, homepage, menu, and supporting data. Cloudflare calls this storage container a “bucket.” |
| **D1 database: `taelgarverse-search`** | Stores revision-matched text versions, visibility rules, and the full-text index queried by the Worker search route. |
| **Website files from `public/`** | The styles, browser scripts, icons, and diagram support used by the site. These are uploaded with the website code. Vault images and audio go in R2 instead. |
| **GitHub Actions** | Tests changes to `taelgarverse-core/main`, then deploys the Worker and website files only after success. Requires the [one-time cutover](deploy.md#one-time-github-website-deployment-setup) from Workers Builds. |
| **Logs** | Records of website errors and build failures, available in Cloudflare. Logging is enabled in the project configuration. |

The Worker reaches R2 through a connection named `CONTENT`, and the website
files through one named `ASSETS`. Cloudflare calls these connections “bindings.”
They let the Worker use those resources without a saved API token in its code.
See Cloudflare's [R2 connection guide](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/).

The project declares D1 through `SEARCH_DB` and no scheduled publishing job. Its
configuration is in [wrangler.json](../wrangler.json); the
[settings reference](deploy.md#cloudflare-settings) explains each setting.

## How updates reach the site

**Website code:** merge a change into `main` in GitHub. **Test and deploy website**
runs the shared tests and deployment-package check, then deploys the Worker and
website files only after success. This changes page rendering, styles, and site
features. Tests read sparse public vault inputs; deployment itself needs only
core and its dependencies. Neither job needs running Obsidian.

**Vault content:** run `npm run publish -- --no-strict` on your computer.
The script asks Obsidian to prepare the notes, makes copies of large images
smaller, and uploads a complete saved version to R2. It then stages/verifies the
matching D1 search revision before activating the R2 pointer. No website code
deployment is needed for subsequent content updates.
The homepage and menu come from `taelgar/_website` and are included in the same
publication.

The publisher's asset phase checks the existing `assets/` inventory and uploads
only missing objects or size mismatches. Notes/index objects are uploaded in a
separate phase, followed by D1 verification and activation. `--assets-only` stages
media without activating a revision; it uses the same bucket and publication
lock. These behaviors are implemented by
[`upload-content.mjs`](../scripts/upload-content.mjs) and
[`content-retention.mjs`](../scripts/content-retention.mjs), with per-request
retries, pacing, and refreshable credentials in
[`cloudflare-client.mjs`](../scripts/cloudflare-client.mjs). They require no
Worker deployment or storage migration. See [publishing recovery and asset
staging](deploy.md#incremental-assets-and-interrupted-uploads).

[`derivative-cache.mjs`](../scripts/derivative-cache.mjs) adds an R2 build catalog
for image variants and map tiles. On publication it checks recipe keys and the
current asset inventory before generation, allowing a fresh machine to reference
existing derivatives without encoding or downloading them. Catalog writes follow
successful asset uploads under the publication lock; the Worker does not read it.
This is publisher behavior in this checkout, not evidence of a production rollout.

Publication logs identify search staging/read-back verification, activation,
retained-snapshot checks, R2 inventory/deletion, and D1 cleanup. Long operations
repeat their latest status every ten seconds with elapsed time. Activation is
reported before cleanup so a wait during retention is distinguishable from a
revision that has not yet gone live.

The publisher uses your local Cloudflare login or API token. The GitHub build
has its own Cloudflare authorization. These are separate from how visitors
read the site.

The site footer shows the content publication date (UTC) and abbreviated core
and Taelgar commit IDs. Hover a hash for the full ID and publication timestamp;
click it to copy the full ID. The core timestamp appears only in its tooltip.
An asterisk marks uncommitted changes. Older publications without provenance
show an unavailable date or hash until content is published again.

Wrangler's custom build step generates the Leaflet map script and stylesheet and
the Mermaid diagram bundle in `public/generated/`, then captures the core commit
and timestamp in `.generated/core-release.mjs`. These travel with the Worker
version, including on rollback. Content commits are stored in the immutable
snapshot; activation timestamps come from that request's `published/current.json`
(`completedAt`). Restoring a saved pointer restores its date and commit together.
Local Node previews show checkout hashes and “Local preview” without publication
dates. No Git or GitHub requests occur in the deployed Worker or browser.

For maintainers checking the build setup: both `node scripts/cloudflare.mjs deploy` and
`npx wrangler deploy` generate the browser assets before packaging through the
custom build in [wrangler.json](../wrangler.json). GitHub uses the pinned Wrangler
dependency through `node scripts/cloudflare.mjs deploy`. The destination Worker
is `taelgarverse`, with its existing R2/D1 bindings. Disconnect Cloudflare's Git
build trigger during the [one-time cutover](deploy.md#one-time-github-website-deployment-setup)
so it cannot deploy independently of these checks. Cloudflare documents the
[GitHub authentication setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

## What is stored in R2

Each publication gets a long unique ID, called a **revision**. The storage
contains the following files:

| Location | What it contains |
| --- | --- |
| `published/current.json` | A small file saying which revision the website should use. It also records the Git version and publishing settings so unchanged content can be skipped next time. |
| `revisions/<revision>/index.json`, `notes/`, `transcripts/` | Complete schema-1 snapshot, including optional compiled campaign interaction scenes and polished transcript descriptors, plus original Markdown shards, retained for legacy Workers and publication verification. `transcripts/` holds selected polished beat bodies loaded only by context-filtered transcript views. |
| `revisions/<revision>/runtime.json` | Runtime manifest with precomputed counts, campaign contexts and host policies, plus references to separate route data. |
| `revisions/<revision>/runtime/` | Compiled renderer lookups, interaction projections and transcript descriptors, header indexes, backlink ownership/shard references, compact search metadata and navigation structure/views. `notes/` holds parsed bodies in roughly 64 KiB shards; `backlinks/` groups destination pages into roughly 32 KiB shards. An individual larger note or backlink list remains intact. `assets/` partitions media entries by the first two hex digits of the SHA-256 of their URL target. |
| `assets/` | Images, audio, and other published attachments. Identical files share one stored copy, even across publications. |
| `build-cache/derivatives-v1.json` | Disposable recipe-to-output catalog with dimensions, generated asset targets, content hashes, and sizes; no source paths or image bytes. |

Successful publication retains the active and previous good snapshots and
collects other revision objects and unreferenced media. The build catalog does
not protect assets from cleanup: reuse checks their existence, and later catalog
writes discard stale records. Deleting the catalog only loses build reuse.
The metadata index now includes a search descriptor (version, digest, and counts),
while search text/rules and revision-specific ranking/visibility metadata live in D1. The local `search.json` compiler payload is
excluded from R2 upload manifests. Older indexes without search still render.
The JavaScript that generates note headers is part of the Worker code, so changing
those rules requires a [code update](architecture.md#change-and-release-rules).

## What happens when someone opens a page

1. The Worker reads the current publication pointer. For an article or homepage,
   it checks the response cache using the full URL and publication/build identity.
   A hit returns HTML or an ETag-based `304` without loading the snapshot.
2. On a miss, it loads the runtime manifest, falling back to the complete index
   for older publications. It finds the requested note and checks availability for the
   selected campaign and date.
3. For articles it loads renderer data and the prepared note, creates the header
   for the selected date, and turns the Markdown into a web page. Successful
   article/homepage GET responses are stored using `waitUntil`.
4. The browser loads the page's images and audio through the Worker from R2.

Visible note embeds load their note shards on demand, using the same selected
campaign/date as the parent. Request-local note data avoids repeated loads during
nested expansion. Hidden embeds and nested embeds outside a requested section do
not trigger body reads. No HTML is prerendered. Prepared records preserve body
text and header-block boundaries; metadata comes from the compiled render index.

Health, contexts, docs and the API schema use only the runtime manifest. Media
requests load their asset partition without initializing headers, Markdown or
navigation. Search loads compact page metadata, adding navigation for HTML
results. Articles reuse their renderer catalog for navigation and do not load
the search catalog. Search-only fields are omitted from renderer entries.
Generated image
variants and map tile entries are omitted from renderer lookups; their entries
remain in the asset partitions used to serve them.

Runtime format 2 gives each page a numeric ID within that revision's renderer
entry table. Backlink shards use these IDs instead of repeating slugs; public
URLs and navigation IDs remain unchanged. After checking page availability,
the Worker fetches at most one backlink shard for the article, alongside its
note shard. It applies date, campaign, DM and source-availability filters to
the selected references. Embeds and homepages do not fetch their own backlinks.
Concurrent requests keep their selected references separate.

Note records reference a shared table of shard filenames and hashes. Navigation
stores visible/linkable flags as two bits per node and deduplicates identical
preset views. Only requested views are materialized; arbitrary dates/campaigns
retain dynamic filtering. The reader also supports format-1 compiled snapshots.

Compiled artifact descriptors contain hashes. The loader validates each object
before caching it, deduplicates concurrent loads, and retries failures without
keeping rejected promises. Retention verifies that every referenced runtime
object exists before cleanup or rollback. New revisions replace all in-memory
caches. Complete indexes and raw shards remain alongside compiled data, adding
publication storage in exchange for backward compatibility.

The homepage uses the published `_website/home.md` text, with links and marked
content adjusted for the reader's campaign and date. Submitting its search box
opens search at `/?q=...`. An older publication without homepage text
shows the search/browse page until content is published again.

### Page response caching

`src/page-cache.mjs` uses Cloudflare's Cache API for successful HTML articles
(`/page/...`) and homepages (`/` without `q`, including campaign hosts). Search,
APIs, browse pages, errors and a homepage that falls back to search remain
`no-store`. Node previews and Workers without a build identity or Cache API also
retain the uncached behavior. Requests with `Authorization`, range requests, and explicit
request `Cache-Control: no-store` bypass the page cache. Responses that set cookies,
private cache policy or unsupported `Vary` headers are not stored.

Internal cache copies use `public, max-age=86400`. Browser responses instead use
`public, max-age=0, must-revalidate` and a weak ETag. Conditional GET/HEAD requests
can receive `304`; HEAD misses never store an empty response over a GET entry.
The Worker checks the publication pointer even for a cache hit or `304`, so a
missing/unreadable pointer cannot serve stale cached HTML. Cache failures fall
back to rendering. The `X-Taelgar-Page-Cache: HIT|MISS` response header describes
this cache; the generic Cloudflare cache-status header is not its diagnostic.

Keys hash the full origin, path and query, preserving repeated parameter order
and empty values, plus the content revision/commit/dirty flag/activation timestamp
and the core commit/dirty flag/build timestamp. Changed dates, campaigns, DM/POV
preferences, host policies, links, publications, rollbacks and website builds
therefore cannot accidentally reuse another representation. URL fragments do
not affect server output. Publishing or deploying switches the namespace;
obsolete entries expire without a purge. The unchanged small publication-pointer
read remains on every content request.

Cache entries are local to Cloudflare locations and may be evicted. A miss still
pays the normal rendering cost; this does not precompute HTML or guarantee a
CPU budget for first visits. The policy is implemented in code and needs a
website deployment to become active; it is not evidence of a live rollout.

In `src/http-assets.mjs`, generated map tiles and responsive image variants use
`Cache-Control: public, max-age=31536000, immutable`; their URLs include a source
and recipe hash, so a changed image gets a new URL. Original images and audio
still revalidate before reuse. This describes the configured policy; deploying
core is required to apply a changed policy to the live site. See
[map delivery](maps.md#delivery-and-maintenance) for tile selection and publication.

Readers do not need a login. **Behind the Curtain is also available to everyone.**
Hiding a note from a campaign view does not make its media private, and its
metadata may still contribute to names and relationships shown elsewhere.
See [when a page is shown](vault.md#when-a-page-is-shown).

The site does not offer a raw Markdown or full index download. R2 does not need
public access: the Worker serves the content. Keep the bucket private.

## Check the site

Open the [health page](https://taelgarverse.msackton.workers.dev/health) to see the
current revision, page count, and warnings. The
[campaign information page](https://taelgarverse.msackton.workers.dev/api/contexts)
shows the available campaign views, their dates, and which session notes supplied
those dates.

- `ok` means the content index loaded. Still check the pages and media you changed.
- `awaiting-content` means no publication has been selected yet.
- A `503` error can mean required published files are missing or invalid.
- A `404` or `422` on an article can come from the note or selected campaign/date;
  check [vault usage](vault.md) as well as the error message.

For code deployment failures, look at the GitHub Actions job log. For errors while
reading the website, look at the Worker's logs.

## Restore older content

Usually, the easiest fix is to correct the vault, commit it, and publish again.

Publication keeps the **active content and one previous successful snapshot** in
R2 and D1. Older revisions and unused media/search text are removed after a
successful activation. Failed builds never replace the rollback choice. Assets
shared by the two retained snapshots are stored once.

Run `node scripts/maintain-content.mjs rollback --remote` to verify and restore the retained
previous snapshot. It becomes active and the replaced publication becomes the
single rollback choice. `node scripts/maintain-content.mjs prune --remote --dry-run` reports
cleanup candidates; omit `--dry-run` to retry cleanup. These commands share the
publisher's D1 lock. Avoid direct pointer writes, which bypass this coordination.
The first publish using this policy records the previously active snapshot;
older pointers do not supply a trustworthy rollback history on their own.

Restoring an older Worker deployment changes website code only. It does not
change which vault publication is selected in R2.

## What was checked

On **2026-10-19**, the public health page reported `ok`, `cloudflare-worker`,
**3,029 pages**, and no index or campaign warnings. The maintainer confirmed
automatic deployment from `main`.

Resource names and settings above come from the repository. Dashboard-only
settings, including the live bucket connection and exact build commands, were
not independently checked because the local Cloudflare login had expired.
The move to vault-authored homepage and menu files is implemented in this checkout;
the live site needs the updated core deployment and a new content publication.

## Production D1 publication

The `SEARCH_DB` binding declares database `taelgarverse-search` with ID
`983f12bb-3952-4ff1-9224-a87f6d5c0b4f` in `wrangler.json`. Creation and schema
initialization were verified through the Cloudflare API on 2026-10-19 in the
Taelgar account. A count check found zero documents, visibility rules, and index
revisions. The binding is configured in source; no Worker deployment or live
content publication was performed for this change.

The publisher stages whole-note text versions and visibility rules for the exact
R2 revision, verifies stored content and FTS integrity, then marks the D1 revision
ready. Only afterward can the supported publication flow move the R2 pointer.
The active generation and one previous successful generation remain available
for rollback; coordinated cleanup removes older memberships and orphaned text.
AI Search is independent and is never part of this gate. The Worker now queries
`SEARCH_DB` through its binding for `/api/search` and `/?q=...`, matching the active
R2 descriptor and filtering context before ranking. It falls back to page-name
matches if the corresponding index is unavailable. Search reads no R2 note shards.
These are source-code behaviors; deploying this change and publishing content
are still required to enable production full-text results. See
[search publication](search.md) for the schema, lifecycle, and local/remote commands.

## Isolated search pilot

The separate `taelgarverse-search-pilot` instance uses built-in storage and hybrid
keyword/vector indexing. Its creation and initial 22-note indexing were verified
through the AI Search API on 2026-10-19. It uses the default
`@cf/qwen/qwen3-embedding-0.6b` embedding model, 800-token managed chunks, and zero
managed overlap. Fixed pilot views use `owner`, `run`, `view`, and `sha256` text
metadata; raw publication shards are not a data source.

The [pilot client](../experiments/ai-search/cloudflare.mjs) fixes the instance
name and uses the existing Wrangler login or an environment token. The
[operating guide](../experiments/ai-search/README.md) owns commands, limits,
artifacts, and cleanup. No binding to this instance has been added to the
production Worker; the local pilot viewer performs the experiment's queries.

An independent D1 database, also named `taelgarverse-search-pilot`, was created
and tested through the D1 REST API on 2026-10-19. Its FTS5 index contains the same
22-note whole-note/passage exports and the four-note visibility sample. The
[baseline client](../experiments/ai-search/baseline.mjs) fixes this resource name,
checks the ownership/schema marker before mutations, applies run/view filters in
SQL, and validates the active digest and excerpts against the local export.
Incremental updates, deletions and the active digest commit in one transaction;
live rollback, visibility, and edit/delete probes passed.

D1 requires no AI instance or AI credentials/scopes. The local server uses the
existing Cloudflare login with D1 access, while the optional AI request uses
AI Search permissions. `--no-ai` prevents AI requests; per-search disabling and
provider/timeout fallback return the D1 results. No D1 binding or search route has
been added to the production Worker. Neither index is updated by the production
publisher. Uploading to either remains an explicit pilot command.
