# Dynamic Taelgarverse architecture

## Current runtime

The reference preview is a pure Node.js application; the hosted adapter now
runs the same rendering and routing modules in Cloudflare Workers. See
[Cloudflare publishing](cloudflare.md) for the deployment workflow.

~~~text
Browser / API client
  → Node HTTP server
  → in-memory page + metadata + link indexes
  → original CustomJS header rules in a fresh VM context
  → Node comment/campaign/date filtering
  → markdown-it and Obsidian-specific extensions
  → HTML fragment or Material-style preview
~~~

src/application.mjs handles requests through Fetch Request/Response APIs.
server.mjs adapts that handler to a local Node HTTP server; worker.mjs and
worker-handler.mjs adapt it to Cloudflare. store.mjs scans the local filesystem;
content-store.mjs supplies shared metadata, YAML parsing, and lookup indexes.
headers.mjs is the VM reference adapter; header-runtime.mjs runs generated
ordinary header modules in Workers. render-engine.mjs joins the shared filters,
Markdown, navigation, and HTML document. engine.mjs initializes the Node preview.

The content snapshot and compiled header code load once. Node renders get a
fresh VM context; Worker renders get fresh instances of the generated header
classes. Shared metadata is frozen, with per-request display/date state. The
Node VM is a compatibility adapter for trusted scripts, not a security boundary
for arbitrary code. No Python subprocess, database, external header service,
or full site build is in the request path.

The adapter supplies metadata/file lookup, a small Dataview DataArray surface,
and array/string helpers. Helpers do not modify the application's global
prototypes. A reverse affiliation index narrows leadership candidates; original
rules decide type/dates/text. Unexpected affiliation shapes retain a full scan.

Body queries are data: unsupported Dataview/Leaflet blocks show warnings and
placeholders. Arbitrary body JavaScript is not executed.

## Navigation

The bundled navigation.md starts from the existing website's curated source
template. Node expands its directory directives at startup against the same
indexed Markdown as the renderer. Note titles, directory indexes, and curated
labels form a tree; uncovered pages appear under More pages. The nav_source
setting can select another template, or null for a directory-based tree.

Each request filters the tree by campaign exclusions, born/created, and activeYear. The HTML
shell renders the selected page's ancestors and immediate siblings, opens its
branch, marks the active link, and supplies breadcrumbs. Collapsed branches load
one level at a time through /api/navigation. Native details, server-rendered
Browse section links, and /browse/:section routes provide keyboard navigation
and a JavaScript-free fallback. Section IDs derive from their ancestry and
target/label, so adding unrelated notes does not invalidate section URLs.

The article TOC follows the rendered heading hierarchy and excludes the first
title heading and comment popup headings. It appears on the right on wide
screens and becomes a collapsible panel above the article on smaller screens.
Site links and branch requests carry the selected date/campaign and Behind the
Curtain preference. Navigation does not render every article to build its tree.

## Original publishing pipeline

Investigated October 18, 2026 using the local repositories and
[the public site](https://tsackton.github.io/taelgarverse/).

1. The taelgar Obsidian vault contains YAML, wikilinks, compact headers,
   CustomJS views, queries, conditional blocks, and private comments.
2. taelgarverse/autobuild_website.sh materialize invokes the vault's
   _scripts/materialize-dataview/materialize-dataview.mjs. Obsidian's plugin
   renders supported content into taelgar-static/. The wrapper deletes prior
   output before this step.
3. taelgar-utils/website/build_site.py export builds the link index, filters
   content, converts Obsidian syntax, processes assets, and writes docs/.
4. MkDocs renders docs/ with Material, Python-Markdown, and plugins.
   .github/workflows/gh-pages.yml builds on pushes/pull requests and deploys
   the default branch's site/ artifact to GitHub Pages.

The dynamic engine does not run or modify these stages.

## Why original Markdown matters

The vault's outputs.js generates headers through DateManager,
WhereaboutsManager, NameManager, AffiliationManager, EventManager, TokenParser,
display defaults, and the campaign registry. Related notes provide names,
parent locations, and reverse relationships: a single requested file is
insufficient without the metadata index.

The materializer accepts --date, but the current wrapper does not pass it.
website.json separately sets export_date to 1750-01-01. These stages can use
different dates. The dynamic engine uses one date for both stages.

Rendering the old exported docs/ would leave headers frozen and could not recover
prose already removed. The API supports original compact headers and Markdown
prepared by the vault materializer's `--dynamic-website` option. Prepared notes
retain YAML and a leading `<!-- taelgar:header -->` marker. The renderer consumes
that marker and inserts a fresh header without treating the first body heading
as an old header. Source and runtime directories may differ, so prepared DQL
results can coexist with original CustomJS header rules and metadata indexes.

## Pure Node migration and performance

The initial Python/Node prototype took 209–335 ms per sample render. Keeping
a Node worker alive and indexing reverse affiliations reduced it to 20–63 ms.
The Node migration removes the process bridge. Filters/link resolution were
ported into local Node modules. markdown-it uses attrs, footnotes, definition
lists, emoji, and local extensions for Obsidian links/callouts/icons and Markdown
inside HTML cards. Bundled CSS/icons retain the preview appearance.

Warm uncached engine medians on this Windows machine:

| Page / date | Optimized Python + Node | Pure Node |
| --- | ---: | ---: |
| Zahara / 1730-01-20 | 20 ms | 20 ms |
| Zahara / 1730-02-01 | 25 ms | 16 ms |
| Seeker / 1748-01-01 | 63 ms | 27 ms |
| Melusa / 1730-01-20 | 22 ms | 14 ms |
| Dunmar Fellowship / 1750-01-01 | 27 ms | 15 ms |
| Vindristjarna / 1750-01-01 | 32 ms | 22 ms |

These medians use ten measurements per request. Startup, HTTP, assets, browser
rendering, and high-concurrency queueing are excluded. No HTML cache is used.
The npm benchmark script repeats the measurement.

All six samples preserved links and warnings. Text matched exactly on four;
Seeker and Dunmar Fellowship differ in list markers because markdown-it parses
lists that Python-Markdown left as literal hyphens. Byte-for-byte HTML parity
is not promised across engines. The same 2,685 pages index without warnings.

## Publication and content boundaries

Campaign context selects a date and marker-filter campaign set. Modern follows
the latest campaign date; Custom supplies a manual date. Both select no
campaigns, so campaign-specific blocks stay hidden. Campaign presets use their own campaign
codes. Page availability is checked server-side for every request. Dates are in-world DR.
knownTo, POV, inferred historical coverage, viewer knowledge, and player
authorization remain future design work.

Contexts are derived at startup from published session notes and the existing
registry. The registry supplies identity; session-note DR_end (falling back to
DR) supplies the date. See [campaign date derivation](campaign-contexts.md) for
ordering and missing-date behavior. No separate website metadata or landing-page
date overrides are used.

The snapshot includes all supported Markdown and assets except those under
underscore-prefixed or Worldbuilding folders, at any depth (Worldbuilding is
case-insensitive). Dot-prefixed tooling paths, AGENTS.md, and symlinks are also
omitted, as are assets/dm and asset/dm with all descendants (case-insensitive).
Legacy ignore-file rules, tags, and excludePublish do not prune the index.

One availability check handles page rendering, search, and navigation. It rejects
excludePublish: all, exclusions matching the request's campaign code, and future
born/created or activeYear dates. Website and API requests return 404; the Worker
checks indexed metadata before fetching Markdown. DM mode does not bypass this
check. Modern and Custom have no campaign-specific exclusions. Birth/creation
dates follow CustomJS's existing partial-date conventions: numeric years start
January 1, quoted years and year-month strings use the period's last day. Unknown
birth/creation dates do not establish a future date. Death/destruction dates do
not hide historical subjects.

Links may reference an unavailable page; following them still applies the same
404 check. The full metadata index remains available to header calculations.
Assets are served independently of referring pages; page exclusions do not act
as asset permissions.

The raw vault has an unterminated comment in
Groups/Cultures/Deno'qai Tribes/Deno'qai.md. Full export scans fail there. The API
indexes metadata independently and rejects that note when requested.
Source notes were not changed.

Comment parsing validates discarded as well as retained blocks, rejects
unknown/nested/unbalanced markers, and treats fenced/inline code as literal.
Date:X is visible on/after X; Date:Xb is visible strictly before X.
Metadata, POV notes, and Lint are always removed. Ordinary comments and
Campaign:none are removed by default. With `dm=1`, visible ordinary comments
become numbered paragraph-end references with native HTML popovers, and
Campaign:none renders inside panels labeled Behind the Curtain. Notes inside filtered-out
campaign/date/administrative blocks are never collected. Comment popups render
Markdown with raw HTML and arbitrary attributes disabled, and their local
heading/footnote IDs are scoped to avoid collisions with the article. Popup
headings do not appear in the article TOC. Date/campaign/DM context survives
navigation. The UI calls this See Behind the Curtain: a viewing preference
available to every visitor. Hosted deployment does not require a DM role or
login to enable it. The `dm` API parameter remains compatible with existing URLs.

## Next increments

1. Complete the first workers.dev deployment after refreshing account sign-in.
   Versioned content packaging, the R2 snapshot store, generated header modules,
   local Workers runtime, and reference parity checks are implemented.
2. Evolve generated header classes into a maintained library with explicit lookup
   functions and RenderContext, retaining parity with the vault rules.
3. Define header/body boundaries and supported query adapters. Materialized
   bodies can supply unsupported queries once dates/boundaries are explicit.
4. Resolve authorized campaign POV server-side and apply it to every derived
   surface, including metadata lookups and errors.
5. Cache by content revision, renderer version, page, date, and authorized POV.
   A bounded cache within the immutable snapshot is a smaller first step.
6. Restore search ranking/maps/backlinks and deploy. Measure load
   before choosing worker threads, multiple Node processes, or a CDN.

The API shape can stay stable as these internals change.
