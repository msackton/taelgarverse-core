# taelgarverse-core

A pure Node.js API that renders Taelgarverse pages from original vault Markdown
for a requested in-world DR date. The API, YAML parser, filters, header adapter,
Markdown renderer, tests, and benchmark all run in Node. Rendering needs no Python,
MkDocs build, or running Obsidian application. The content publisher uses Obsidian
to materialize vault queries before uploading content.

The live [Cloudflare site](https://taelgarverse.msackton.workers.dev/) runs the same
application in a Worker with R2-backed content. Merges to this repository's `main`
branch run GitHub tests before deploying the web core to Cloudflare; vault content
and the Obsidian plugin have separate publication workflows.

| Workflow | Entry point |
| --- | --- |
| Website preview from the live vault, without Obsidian | `npm run dev` |
| Full materialization, image/search processing, and local Cloudflare preview | `npm run dev -- --full` |
| Build/install the Obsidian plugin for local testing | `npm run dev -- --plugin` |
| Automated tests | GitHub on pull requests and pushes to `main`; `npm test` locally |
| Website code deployment | GitHub's **Test and deploy website**, after tests pass on `main` |
| Obsidian release | GitHub's **Release Taelgarverse for Obsidian** workflow, or a tag named `obsidian/<version>` |
| Update live vault content | `npm run publish -- --no-strict` |

Both previews use http://127.0.0.1:8765/. Full preview and content publication
need running Obsidian with Dataview and the materializer. The plugin release
workflow needs its one-time GitHub credential setup; see the plugin guide below.
Website deployment also needs [one-time GitHub/Cloudflare setup](docs/deploy.md#one-time-github-website-deployment-setup),
including removal of the independent Cloudflare Git deployment trigger.
The core documentation is:

- [Deploy](docs/deploy.md): publish vault content, configure authorization, and recover from failures.
- [Architecture](docs/architecture.md): components, release boundaries, and documentation maintenance rules.
- [Vault usage](docs/vault.md): input files, metadata, contexts, and rendering behavior.
- [Cloudflare](docs/cloudflare.md): hosted resources, bindings, and snapshot storage.
- [Taelgarverse for Obsidian](obsidian/taelgarverse/README.md): the Maps feature, local development, and BRAT releases.

## Run locally

For the cross-platform Obsidian export, web image optimization, and R2 publication
pipeline, use `npm run publish -- --no-strict`. Unchanged Taelgar commits
skip the build. See [content publishing](docs/deploy.md) for prerequisites,
the R2 commit checkpoint, image settings, and offline testing.

Requires Node.js 22.12+ and an adjacent checkout of the Taelgar vault:

~~~powershell
cd C:\Users\msack\taelgarverse-core
npm ci
npm run dev
~~~

Open [the preview](http://127.0.0.1:8765/),
[a sample page](http://127.0.0.1:8765/page/people/zimkovans/zahara?date=1730-02-01),
or [the API explorer](http://127.0.0.1:8765/docs).

The server reports its URL and indexed page count when ready. Press Ctrl+C to
stop it. Quick preview automatically restarts after vault notes, supporting
scripts, metadata, or application code change; refresh the browser afterward.
It reads the original notes directly, so unmaterialized Dataview blocks can be
incomplete. Use `npm run dev -- --full` to export and process a local snapshot;
rerun full preview after changing vault content. Neither mode updates the live site.

The server defaults to localhost port 8765. To choose another port:

~~~powershell
npm run dev -- --port 8766
~~~

## Configuration

[config.json](config.json) contains the shared defaults for the sibling vault.
To use another vault location on this computer, create `config.local.json` with:

~~~json
{
  "vault_dir": "D:/notes/taelgar"
}
~~~

Replace the path with your vault location. The local file is loaded automatically
and excluded from Git; settings you omit keep their shared defaults. Paths are
relative to the file containing them. See [configuration settings](docs/deploy.md#configuration-settings)
for navigation, dates, alternative files, and Cloudflare settings.

Runtime scripts are trusted server code; Markdown body queries are not executed.

For prepared Markdown, run the vault materializer with `--dynamic-website`, set
`source_dir` to its output directory (for example, `../taelgar-dynamic`), and keep
`vault_dir` pointing at `../taelgar`. That mode materializes Dataview queries,
removes DataviewJS blocks and sections left empty by them, and replaces generated
note headers with `<!-- taelgar:header -->`. A leading marker is replaced with a
header for the requested date and campaign. The original-vault configuration
above continues to work.

CSS and icons are bundled in public/. They do not require Python or a sibling
utilities repository at runtime. Sources/licenses are in public/vendor/NOTICE.md.

## API

~~~http
GET /api/page?page=Zahara&date=1730-02-01
GET /api/page?page=People%2FZimkovans%2FZahara.md&date=1730-02-01
GET /page/people/zimkovans/zahara?date=1730-02-01
~~~

The JSON response contains page, title, date, dm, campaigns, context, html, toc, backlinks, and warnings.
The html field is an article fragment; /page/... wraps it in the Material-style
preview. Internal links preserve the selected date.

Dates use full YYYY-MM-DD values in the 365-day DR calendar, with no leap days.
Omitting both date and context selects Modern, the latest campaign date.
A date-only request selects Custom. Campaign presets select a date and campaign
codes together. An explicit request date overrides note pageTargetDate,
following the existing CustomJS rules.

~~~http
GET /api/contexts
GET /api/page?page=Zahara&context=modern
GET /api/page?page=Zahara&context=into-the-chasm
GET /api/page?page=Zahara&context=custom&date=1730-01-20
GET /api/page?page=Zahara&context=custom&date=1730-01-20&campaigns=all
~~~

The context selector lives in the header on article and page-finder pages.
Selecting Custom reveals the date and campaign pickers, with All campaigns or
an individual subset. See [Custom campaign selections](docs/custom-contexts.md).
Named context links retain their ID,
so campaign dates advance after the source snapshot is refreshed. Custom links
retain the explicit date and campaign selection. Unknown/undated presets or mismatched date overrides
return 400; use Custom for manual dates. Unavailable article dates retain the
header so a visitor can switch context again.

Presets use the campaign registry for identity and session-note frontmatter as
the sole source of campaign dates. The latest session supplies DR_end, falling
back to DR. See [campaign date derivation](docs/vault.md#campaigns-and-dates) for session
ordering, limitations, and source dates. No extra vault metadata is needed.

The **See Behind the Curtain** checkbox in the header adds `dm=1` to the request. Ordinary
`%% comments %%` become numbered superscripts at paragraph ends. Click a number
to open the comment popup; close it with ×, Escape, or a click outside. Comments
on their own lines attach to the preceding paragraph. Comment Markdown and
wikilinks are supported; raw HTML is shown as text.

This view also reveals `%%^Campaign:none%% ... %%^End%%` in amber panels labeled
**Behind the Curtain**. Campaign and date filters still apply, and
Metadata, povNotes, and Lint blocks remain hidden. The toggle is preserved in
page links, searches, and context changes. It is off by default; comment
text is omitted entirely from the default responses. This is a viewing
preference available to every visitor, with no login or special role required.
The existing `dm` API parameter is retained for compatibility.

~~~http
GET /api/page?page=Zahara&context=dunmar-frontier&dm=1
GET /page/people/zimkovans/zahara?context=dunmar-frontier&dm=1
~~~

## Homepage

Edit `_website/home.md` in the `taelgar` vault to change the homepage text and
links within the introduction. Core owns the dedicated Quiet Library homepage
template, decorative map, and prominent Current Games, Gazetteer, and World Map
buttons. The heading and first paragraph from `home.md` appear in the banner;
the remaining prose appears below the buttons. The buttons and header search
retain the selected context. Use the header field for search suggestions, or
open the page finder directly at `/?q=...`.
Publish homepage changes with the usual [content publishing command](docs/deploy.md).

## Site navigation and page TOC

Articles have a site sidebar, breadcrumbs, and a separate **On this page** TOC.
The current branch opens automatically and the current page is highlighted.
Section titles open their overview or browse page; the adjacent chevron expands
the branch. Search, navigation, and breadcrumbs retain the date/campaign and
See Behind the Curtain setting. Future-active and context-excluded pages are
omitted from navigation and page-finder results.

Edit **`_website/navigation.md` in the `taelgar` vault** to change the site hierarchy.
Publish menu changes with the notes; the core supplies the navigation behavior.
Indented Markdown lists accept links to exported-style note paths, plain section
labels, and directory expansions:

~~~markdown
- [People](people/people.md)
    - Humans
        - {glob: people/addermarians/}
- Items
    - {glob: things/magic-items/;things/artifacts-of-power/;flatten, exclude: example.md}
~~~

Expansions include indexed Markdown only, use note titles, sort numerically
within titles, and recognize folder-name index pages. Empty or unavailable
leaves disappear. The curated definition is the entire site TOC; unlisted notes
remain available through search and direct links, without a catch-all section
or invented breadcrumbs. An empty curated definition stays empty. Section
identifiers remain stable when unrelated notes are added. With `nav_source`
explicitly set to null, navigation follows the content directory tree.

Only the current branch's immediate siblings and ancestors are sent with the
article. Expanding another branch loads its children through `/api/navigation`.
Without JavaScript, **Browse section** links provide ordinary section pages.
Quiet Library uses serif prose, neutral article surfaces, and a sage green header
with the original dragon home icon and top-level section links. Generated bio
summaries use slightly larger text for readability. At 1100px the left navigation becomes a
hamburger drawer and header search becomes a magnifying-glass button. At 800px
page contents disappear, while backlinks remain available below the article.
Search results appear in a dropdown beneath the field as you type, keeping the
selected viewing context and content-type filter. Escape or a click outside
dismisses the suggestions. On phones, the search icon reveals the field in the
header. Regular search URLs and forms still work without JavaScript. The header gear offers System (default), Light, and Dark appearance and remembers
the selection in the browser. On smaller screens it also contains the context
and Behind the Curtain controls. The page title replaces the wordmark after
scrolling while the home icon stays visible, and upward scrolling reveals a Back to top button.
Notes and the authored homepage can use `hide: [navigation, toc]` to omit either
or both navigation areas; see [vault usage](docs/vault.md#links-navigation-and-media).
`hide: toc` also hides page contents, and hidden contents are omitted from the page API.
The page TOC uses a plain **On this page** title without a collapse control.
It nests subheadings, omits the article title, and highlights the current section.
The right contents list scrolls with the page rather than using a separate scroll
area. Desktop header rows and the gap above the article are compact; wider screens
give both sidebars more room. Comment popup headings stay outside the TOC.

| Status | Meaning |
| --- | --- |
| 200 | Rendered page, possibly with unsupported-block/link warnings |
| 400 | Invalid date, missing page, or malformed input |
| 404 | Missing, excluded, or future-active page |
| 409 | Ambiguous page name; use its full relative path |
| 422 | Header failure or comments that cannot be safely filtered |

`/health` reports runtime, page count, indexing warnings, and context warnings.
`/` shows the homepage; `/?q=...` searches filenames and titles. `/docs` contains
a request form; `/openapi.json` describes the API.
Only indexed assets are served, with byte-range support for media/PDFs.
Responses use Cache-Control: no-store.

## Images and audio

Click an unlinked article image or its expand icon to open a screen-filling
viewer. Keyboard users can activate the expand button with Enter or Space.
The default view fits the image to the screen. **Download** saves the original
full-resolution export. **Pan / zoom** loads that original for detailed inspection,
with dragging, zoom buttons, arrow keys, wheel/pinch zoom, and **Fit to screen**.
Close with the Close button, Escape, or the fitted view's backdrop. Keyboard
focus stays within the viewer and returns to the expand button when closed.
Images with authored links retain their destinations; inline images still
render without JavaScript. Exported Excalidraw PNGs use the same presentation.

Publication preserves originals and generates cached WebP sizes from actual
authored widths and layout roles, plus a popup version. Reused images share their
needed sizes; unused assets get no derivatives. Articles use responsive small images and defer offscreen loading;
screen-sized images load on opening the viewer, and originals load only for
pan/zoom or download. See [image delivery and verification](docs/images.md) and
[publication settings](docs/deploy.md#image-settings).

Obsidian audio embeds such as `![[song.mp3]]` and
`![[assets/session-audio/session/clip.m4a]]` render native audio players.
MP3, M4A, WAV, OGG, and FLAC assets are indexed and served with their audio MIME
types and byte-range support for seeking. Codec playback depends on the browser;
the current vault's MP3 and M4A examples have been checked in the local browser.
The publication pipeline already copies and packages eligible audio assets
without transcoding or image optimization; no separate audio publication step
is needed.

## Note embeds

`![[Another Note]]` inserts the authored note body in a bordered panel with a
link to the source. `![[Another Note#Heading]]` includes that section and its
subheadings; `![[Another Note#^block-id]]` includes a referenced block. Paragraphs
and list items can be named with a trailing `^block-id` marker. Generated note
headers are omitted. Embedded headings stay out of the host page's TOC.

Nested embeds, links, media, footnotes, and Behind the Curtain popups retain their
source-note context. Campaign/date comments and page availability are checked
before content is included. Cycles, missing sections, and malformed child comments
fall back to a source link with a render note. Expansion stops after eight levels
or 32 included notes per page. See [vault rendering rules](docs/vault.md#links-navigation-and-media).

The existing publication format already retains notes and embed syntax. Deploying
the renderer enables embeds in existing snapshots. No new embed index is needed.

## Mermaid diagrams

Mermaid fences render in the browser as SVG diagrams, including the existing
House of Sewick and House of Lils family trees. Authored styles are retained.
Diagrams fit the article width and viewport height without inline scrolling.
**See bigger** opens a popup at full size, with a **Fit to window** option;
**See source** opens the Mermaid text in a separate popup. Both popups support
Close, Escape, backdrop dismissal, and returning keyboard focus to the button.
Readable inline source remains available without JavaScript. A rendering error
keeps the source accessible and does not prevent other diagrams from rendering.

The [Mermaid library](https://mermaid.js.org/config/usage) is pinned and bundled
locally with strict rendering and authored callbacks disabled. Family-tree nodes
marked `internal-link` and explicit Mermaid URL destinations become ordinary,
context-aware links. Internal links open an article preview with **Open page**;
uncheck **Preview linked pages** for direct navigation. Links work in the enlarged
diagram too. Missing, ambiguous, or unavailable pages stay unlinked. See
[diagram link behavior](docs/vault.md#links-navigation-and-media).
The library is loaded only on pages containing visible diagrams. The API returns
the escaped source and diagram containers; the article shell loads the browser renderer.

`npm start`, `npm run dev`, `npm test`, `node scripts/cloudflare.mjs dev`, `node scripts/cloudflare.mjs check`, and
`node scripts/cloudflare.mjs deploy` rebuild the Leaflet and Mermaid browser assets automatically.
Wrangler's custom build also generates them for plain `npx wrangler deploy`,
including deployments from a clean GitHub Actions checkout. Quick preview
also rebuilds them when source changes. Output lives in ignored `public/generated/`; application
code and dependency pins are the source of truth. After pulling dependency
changes, run `npm ci` before starting or deploying.

## Rendering architecture

~~~text
Startup: content snapshot + link/affiliation indexes + compiled CustomJS
Request: resolve page → date-aware header → filters → markdown-it → HTML
~~~

The Node preview runs in one process. Its headers use a fresh VM context per
request; the Cloudflare adapter uses generated JavaScript classes. Both share
immutable metadata and use the original header classes to
determine ages, lifecycle, affiliations, locations, names, and display defaults.
A reverse affiliation index narrows leadership candidates; the original code
evaluates dates and display text.

Node modules implement public comment/campaign/date filtering, publish flags,
birth/creation dates, activeYear, links, images, Obsidian callouts, tables, footnotes, definition lists,
attributes, inline date fields, headings, and TOC generation.

Rendering uses markdown-it rather than Python-Markdown. HTML serialization and
some list/typographic details differ. Migration samples preserved all links;
ordinary text matched exactly apart from list-marker formatting on two pages.
Header relationships are tested against the original CustomJS full-scan behavior.

## Scope

The Cloudflare site is live, and the Node preview remains a local reference.
The original GitHub Pages pipeline is independent. Rendering does not write the
vault; the content publisher exports disposable copies and updates R2. Core
merges deploy automatically, while vault publication uses the explicit command
in [Deploy](docs/deploy.md).

Campaign presets show only matching campaign blocks, using their canonical
registry codes (case-insensitive). Modern shows no campaign-specific blocks;
Custom shows blocks for its selected campaigns. Legacy date-only links select none.
For example, content inside %%^Campaign:dufr%% ... %%^End%% appears only when
the context includes dufr. Campaign:none is removed unless See Behind the Curtain is enabled.
The snapshot includes all supported notes and assets outside underscore-prefixed
and Worldbuilding folders, at any depth, and excludes assets/dm (also asset/dm)
with all descendants. Worldbuilding and DM asset paths match case-insensitively;
hidden tooling paths and AGENTS.md are also omitted. Tags and legacy ignore files
do not restrict publication. excludePublish and date metadata remain in the snapshot.
The website and API return 404 for excludePublish: all, a matching campaign
exclusion, or a subject whose born/created date or activeYear is still in the
future. Search and navigation apply the same check. Modern and Custom without a
campaign selection apply no campaign-specific exclusions. See Behind the Curtain does not bypass page availability.
Explicit campaign/date markers are filtered, but knownTo, POV, inferred spoilers,
viewer permissions, and the chronology of ordinary prose are not interpreted.

Leaflet image-map blocks render with pan, keyboard/touch zoom, a Fit map control,
and an original-image fallback. Large maps use locally generated WebP tiles,
packaged as ordinary content-addressed assets for the Worker. Leaflet is pinned
and bundled locally, and map scripts/styles load only on pages containing maps.
Publication preserves the resolution of images referenced by map blocks.

General Dataview/DataviewJS body queries show placeholders and warnings.
Search ranking, advanced map exploration, and session zoom remain future work.

The process renders synchronously. Warm single-request latency measurements do
not establish concurrent-load throughput. No HTML response cache is enabled.
Workers or context-aware caching can follow measurements of the intended load.

## Test and benchmark

~~~powershell
npm test
node scripts/benchmark.mjs
~~~

Tests use synthetic notes with the configured real CustomJS code. They cover
dates/lifecycle/locations, leadership parity, private and malformed comments,
campaign filtering, links, Markdown extensions, assets, HTTP errors, and date
isolation. Integration tests require the configured sibling vault. Fixtures are
created and cleaned under ignored .cache/.

The benchmark renders six real-vault requests without an HTML cache. It reports
startup separately. REPEATS sets the default ten iterations. Save JSON with:

~~~powershell
node scripts/benchmark.mjs -- .cache/node-benchmark.json
~~~

In the migration measurement, warm engine medians were approximately 14–27 ms,
compared with 20–63 ms in the optimized Python/Node version. Startup varies with
filesystem caching; the running server most recently indexed 2,685 pages in
about 1.4 seconds. Measurements exclude HTTP, assets, and browser rendering.

See [architecture and maintenance](docs/architecture.md) and the [roadmap](docs/roadmap.md).
