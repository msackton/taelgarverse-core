# taelgarverse-core

A pure Node.js API that renders Taelgarverse pages from original vault Markdown
for a requested in-world DR date. The API, YAML parser, filters, header adapter,
Markdown renderer, tests, and benchmark all run in Node. No Python, MkDocs build,
or running Obsidian application is needed.

The Cloudflare version runs the same site in a Worker with R2-backed content.
The web core deploys from this repository without the vault; content is prepared,
uploaded, and published separately. For local Cloudflare development, run
`npm run cf:prepare`, `npm run cf:seed`, then `npm run cf:dev` and open
http://127.0.0.1:8787/.
See [Cloudflare setup and publishing](docs/cloudflare.md) for sign-in, the
workers.dev preview, content updates, and rollback. The Node preview below
remains available as a reference.

## Run locally

For the cross-platform Obsidian export, web image optimization, and R2 publication
pipeline, use `npm run content:publish -- --no-strict`. Unchanged Taelgar commits
skip the build. See [content publishing](docs/publish-content.md) for prerequisites,
the R2 commit checkpoint, image settings, and offline testing.

Requires Node.js 22+ and an adjacent checkout of the Taelgar vault:

~~~powershell
cd C:\Users\msack\taelgarverse-core
npm ci
npm start
~~~

Open [the preview](http://127.0.0.1:8765/),
[a sample page](http://127.0.0.1:8765/page/people/zimkovans/zahara?date=1730-02-01),
or [the API explorer](http://127.0.0.1:8765/docs).

The server reports its URL and indexed page count when ready. Press Ctrl+C to
stop it. Restart after editing vault content, scripts, or configuration: the
server uses an in-memory snapshot. Restart after editing navigation.md too.
**npm run dev** watches application code only, not the external vault.

The server defaults to localhost port 8765. To choose another port in PowerShell:

~~~powershell
$env:PORT = '8766'
npm start
~~~

## Configuration

config.example.json uses the sibling vault. Copy it to
ignored config.local.json to customize it, then set:

~~~powershell
$env:TAELGARVERSE_CONFIG = 'config.local.json'
npm start
~~~

Paths are relative to the configuration file:

| Key | Purpose |
| --- | --- |
| source_dir | Original vault Markdown and assets, not already-exported docs/ |
| runtime_dir | Vault containing _scripts/customJS, .obsidian/metadata.json, and _scripts/session_note_campaigns.json |
| nav_source | Curated navigation template; defaults to bundled navigation.md. Set null to use the content directory tree. |
| default_date | Fallback when no dated campaign exists; initially 1750-01-01 |

The source and runtime directories may differ. Runtime scripts are trusted server
code; Markdown body queries are not executed. The earlier utils_dir and
node_command settings are no longer used. Legacy ignore_file and campaigns
settings no longer restrict publication; campaign selection comes from each request.

For prepared Markdown, run the vault materializer with `--dynamic-website`, set
`source_dir` to its output directory (for example, `../taelgar-dynamic`), and keep
`runtime_dir` pointing at `../taelgar`. That mode materializes Dataview queries,
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

The JSON response contains page, title, date, dm, campaigns, context, html, toc, and warnings.
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
~~~

The context selector lives in the header on article and page-finder pages.
Selecting Custom reveals the date picker. Named context links retain their ID,
so campaign dates advance after the source snapshot is refreshed. Custom links
retain the explicit date. Unknown/undated presets or mismatched date overrides
return 400; use Custom for manual dates. Unavailable article dates retain the
header so a visitor can switch context again.

Presets use the campaign registry for identity and session-note frontmatter as
the sole source of campaign dates. The latest session supplies DR_end, falling
back to DR. See [campaign date derivation](docs/campaign-contexts.md) for session
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

## Site navigation and page TOC

Articles have a site sidebar, breadcrumbs, and a separate **On this page** TOC.
The current branch opens automatically and the current page is highlighted.
Section titles open their overview or browse page; the adjacent chevron expands
the branch. Search, navigation, and breadcrumbs retain the date/campaign and
See Behind the Curtain setting. Future-active and context-excluded pages are
omitted from navigation and page-finder results.

Edit **navigation.md** to change the site hierarchy. Its initial structure was
copied from taelgar-utils/website/templates/toc.md, the current site's source
template. It is now maintained here independently and requires no export build.
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
leaves disappear. Indexed pages outside the curated structure remain accessible
under **More pages**. Section identifiers remain stable when unrelated notes
are added. With no template, navigation follows the content directory tree.

Only the current branch's immediate siblings and ancestors are sent with the
article. Expanding another branch loads its children through `/api/navigation`.
Without JavaScript, **Browse section** links provide ordinary section pages.
On narrow screens the site navigation and page TOC become collapsible panels.
The page TOC nests subheadings, omits the article title, and highlights the
current section while scrolling. Comment popup headings stay outside the TOC.

| Status | Meaning |
| --- | --- |
| 200 | Rendered page, possibly with unsupported-block/link warnings |
| 400 | Invalid date, missing page, or malformed input |
| 404 | Missing, excluded, or future-active page |
| 409 | Ambiguous page name; use its full relative path |
| 422 | Header failure or comments that cannot be safely filtered |

/health reports runtime, page count, indexing warnings, and context warnings. / searches filenames
and titles. /docs contains a request form; /openapi.json describes the API.
Only indexed assets are served, with byte-range support for media/PDFs.
Responses use Cache-Control: no-store.

## Images and audio

Click an unlinked article image to open the image viewer, or focus it and press
Enter or Space. The viewer fits the image to the screen; **Open image** opens
the published image in a new tab for closer inspection. Close it with the Close
button, Escape, or a click on the backdrop. Keyboard focus stays within the
viewer and returns to the image when closed. Images with authored links retain
their destinations, and ordinary inline images still render without JavaScript.
Exported Excalidraw PNGs use this same presentation; no drawing export is run by
the website. The viewer uses the published image, including any resizing done
during [content publication](docs/publish-content.md#image-settings).

Obsidian audio embeds such as `![[song.mp3]]` and
`![[assets/session-audio/session/clip.m4a]]` render native audio players.
MP3, M4A, WAV, OGG, and FLAC assets are indexed and served with their audio MIME
types and byte-range support for seeking. Codec playback depends on the browser;
the current vault's MP3 and M4A examples have been checked in the local browser.
The publication pipeline already copies and packages eligible audio assets
without transcoding or image optimization; no separate audio publication step
is needed.

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

The Node preview and Cloudflare local runtime are ready; the first remote
Cloudflare deployment awaits account sign-in. The original GitHub Pages site
continues independently. These renderers do not write the vault, refresh
taelgar-static, or export docs/. Cloudflare uploads and deployments are explicit
commands described in the publishing guide.

Campaign presets show only matching campaign blocks, using their canonical
registry codes (case-insensitive). Modern and Custom show no campaign-specific blocks.
For example, content inside %%^Campaign:dufr%% ... %%^End%% appears only when
the context includes dufr. Campaign:none is removed unless See Behind the Curtain is enabled.
The snapshot includes all supported notes and assets outside underscore-prefixed
and Worldbuilding folders, at any depth, and excludes assets/dm (also asset/dm)
with all descendants. Worldbuilding and DM asset paths match case-insensitively;
hidden tooling paths and AGENTS.md are also omitted. Tags and legacy ignore files
do not restrict publication. excludePublish and date metadata remain in the snapshot.
The website and API return 404 for excludePublish: all, a matching campaign
exclusion, or a subject whose born/created date or activeYear is still in the
future. Search and navigation apply the same check. Modern and Custom apply no
campaign-specific exclusions. See Behind the Curtain does not bypass page availability.
Explicit campaign/date markers are filtered, but knownTo, POV, inferred spoilers,
viewer permissions, and the chronology of ordinary prose are not interpreted.

General Dataview/DataviewJS body queries and Leaflet blocks show placeholders
and warnings. Mermaid stays a code block. Search ranking,
backlinks, maps, and session zoom remain future work.

The process renders synchronously. Warm single-request latency measurements do
not establish concurrent-load throughput. No HTML response cache is enabled.
Workers or context-aware caching can follow measurements of the intended load.

## Test and benchmark

~~~powershell
npm test
npm run benchmark
~~~

Tests use synthetic notes with the configured real CustomJS code. They cover
dates/lifecycle/locations, leadership parity, private and malformed comments,
campaign filtering, links, Markdown extensions, assets, HTTP errors, and date
isolation. Integration tests require the configured sibling vault. Fixtures are
created and cleaned under ignored .cache/.

The benchmark renders six real-vault requests without an HTML cache. It reports
startup separately. REPEATS sets the default ten iterations. Save JSON with:

~~~powershell
npm run benchmark -- .cache/node-benchmark.json
~~~

In the migration measurement, warm engine medians were approximately 14–27 ms,
compared with 20–63 ms in the optimized Python/Node version. Startup varies with
filesystem caching; the running server most recently indexed 2,685 pages in
about 1.4 seconds. Measurements exclude HTTP, assets, and browser rendering.

See [the pipeline investigation and next steps](docs/architecture.md).
