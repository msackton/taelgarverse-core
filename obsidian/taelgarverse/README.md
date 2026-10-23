# Taelgarverse for Obsidian

The unified desktop Taelgarverse plugin: generated note headers and indexes, local image maps,
calibrated distances, freehand tracing, enclosed areas, and an optional image viewer.
Name Explorer and the materializer remain separate. Requires Obsidian 1.8.0+.

Version 0.3.0 adds generated bio blocks. Replace a note's
saved title and information callout with an empty `taelgar-header` code fence
immediately after frontmatter. It renders the same header information as a
native Obsidian callout, using the bundled header rules; Dataview and CustomJS
are not required. The block includes the generated H1, pronunciation and all
other details. Remove any separately saved H1 above it to avoid a duplicate
title in Obsidian. Notes are never rewritten by the renderer.
Location links use Obsidian's own resolution, including when a campaign homepage
and a location note share a name.
In Live Preview, the bio has no code-block edit button or hover frame/background;
its information callout keeps the normal callout styling. The fence remains
editable in Source mode.
Headers without index buttons use the note's normal spacing after the callout;
headers with buttons use the button row's spacing.

Dates follow an existing CustomJS override when set, then the note's
`pageTargetDate`, then Fantasy Calendar or the Taelgar Calendarium calendar.
Without those, use the latest campaign session date, falling back to DR
1750-01-01. Headers refresh after metadata changes and detect calendar/override
date changes within two seconds. The vault's `.obsidian/metadata.json` (or its
custom configuration-folder equivalent) and `_scripts/session_note_campaigns.json`
are required only when rendering a bio block or generated index. Existing Maps-only test vaults
continue to work.

## Campaign interactions

The plugin automatically adds a **Campaign interactions** panel at the bottom
of any note with at least one registered campaign in `knownTo`, in Reading View
and Live Preview. Scalar and list values work; registry names, codes, and aliases
resolve to the same campaign. A single campaign opens directly. Multiple
campaigns get a **Campaign** selector directly below the heading, with **All**
selected by default to show them together. The choice is retained while the
plugin is running. Source mode stays unchanged.

When the selected campaign has no visible timeline entries, it retains the same
campaign-name heading and **Known to party** status line as a full timeline,
with compact spacing and any related campaign links below it. The **Campaign
interactions** heading and campaign picker stay above the content; choosing a
campaign with recorded sessions adds its timeline below the same header. This applies
to automatic footers and explicit blocks.

Click or tap an individual dot to open a compact popup containing its date,
details, and source links. Details stay closed initially, and one popup is shown
at a time across campaigns. Close it with its close button, Escape, an outside
click, or the same dot. Campaign changes also close it. Keyboard
users can activate dots with Enter or Space; Escape returns focus to the dot.
Session references contain only the title, date, and a link such as **Session 30**.
They omit explanatory commentary and repeated session titles. Recap-backed
popups show the full session's title, dates, tagline, and optional session link.
Only resolved NPCs explicitly marked `met` in the recap's Cast qualify, including
combined statuses such as `met, fought`. Mention-only and other statuses do not.
Cast membership alone selects sessions. Beats, their NPC lists, Short/Long text,
locations, and transcripts are ignored. Each session has one dot even when
multiple sessions share a date. Dots open their popup directly, without beat zoom.
Each dot shows its session title and date, even in long histories. The official
session note's `descTitle`, `DR`, `DR_end`, and `tagline` supply display metadata, falling
back to the recap header. Titles use up to two lines; hover or open
the popup for the complete title. Dots wrap into rows, with two columns on narrow screens.

Recap sessions contribute encounter dots and counts. Sessions without a recap use
explicit NPC links in the official session note as hollow **Session reference**
dots, counted separately, with the session date and a native note link. An
existing recap suppresses this fallback for the entire session. The registry
filename wins; a unique legacy metadata candidate is also supported.

**Related campaign material**
groups links on separate **Items** (`object`/`item`), **Stories** (`story`), and
**Sources** (`source`/`document`) lines, with a **References** line for other types.
Empty categories are omitted. A note appears once; item tags take precedence over
story tags, then source tags.
Untagged notes and notes with `meta` or `background` tags are excluded, including
nested tags. A source note's `knownTo` flag does not bypass these exclusions.
Links run horizontally within each category and wrap as needed. Each line shows
its first ten links; **Show more** reveals the rest in the same layout. Links open
their notes natively. Undated sessions retain their session labels without
inventing a date.

To choose the panel's position, add an empty block:

````markdown
```taelgar-interactions
```
````

An explicit block suppresses the automatic footer for that note. Code examples
inside another fence do not suppress it. The **Automatic campaign interactions**
setting turns automatic footers off immediately; explicit blocks continue to
work. Rendering never inserts fences, modifies frontmatter, or saves note text.

The session dots, dates, and taglines use the same session-header/Cast parser and
interaction model as the website. Session notes supply source links, and
non-session campaign material supplies separate references. Only missing-recap
sessions use session-note bodies, to identify explicit links and preserve their
conditional visibility; no prose summary is generated. Raw transcripts are not
interaction inputs. Links open full session notes and
campaign references natively in Obsidian; beat and transcript links are omitted,
including modified clicks to open another pane.

Interactions require `_scripts/session_note_campaigns.json`. Session membership
come from local `_sessions/<campaign>/<session>/cleaned/*-session-recap.md` files;
sessions without those files use the official session-note fallback.
They do not require a website connection, Dataview, CustomJS, or header display
metadata. Dates follow the header's override, note date, calendar, and fallback
order. This is a local author view: DM text is available and website publication
exclusions do not restrict local notes. Campaign/date conditions still apply.

The index is shared across open notes and refreshed after metadata, recap,
registry, and file changes. Calendar changes refresh visible panels within two
seconds. Closing notes or unloading the plugin disposes panels, observers, and
timers. The website consumes the empty placement fence without showing a code
frame and retains its normal campaign-history section.

## Generated indexes

Turn off **Show header index popups** in Taelgarverse settings to hide these
buttons in Obsidian only. The setting defaults to on and applies immediately,
closing any open header popup. Inline `taelgar-index` blocks and website popups
are unaffected; no note metadata is changed.

Residents, Settlements, Members, Rivers and Places grids are calculated from vault metadata. Put
`indexes: [residents, settlements]` in a place's frontmatter to add popup buttons at the bottom of
its `taelgar-header` block, below and outside the information callout. Organizations tagged
`group` get Members automatically when `indexes` is omitted; set `indexes: []` to suppress it or
provide an explicit list to choose header indexes. Ordinary
Markdown titles and saved headers do not receive buttons. Use a `taelgar-index` fence
containing `type: residents`, `type: settlements`, `type: members`,
`type: rivers`, or `type: places` for an
inline grid. Inline grids and tables start with an H2 heading matching the index
label by default; set `heading: false` to omit that title in Obsidian and the
website. This does not hide table column headings, grid counts, or popup titles. Optional `target` selects another note, `show` selects `obsidian`,
`website`, or `both`, and `recursive` controls location/organization containment.
Grid cards show available local images from each note's `image` frontmatter.
People cards include pronouns and name pronunciation when available, using the
same name formatting as tables. Settlement cards also include pronunciation.
Use `mode: table` inline for Person (name, pronouns, pronunciation), Info (ancestry
and main type), Current Location (last-known chain and date), and Home on Residents.
Residents includes living people whose active home is in the place, including
traveling residents. Transients whose home is elsewhere are excluded. Residents
cards show Current Location and Home; Members cards show the member note's first
authored sentence and roles instead of location fields. Descriptions skip callouts,
headings, code, lists, tables and image-only paragraphs before selecting prose.
Member tables show Person (name, pronouns,
pronunciation), Info (ancestry and main type), Current Location (last-known
location chain and date), and Home, using the existing query's header templates
and affiliation-date rules. Settlement tables show
Place, Region, Type Of, and Population, sorted by their dated home region.
Settlements includes ruins and matches current, last-known and secondary
locations using the existing `inLocation(..., true, true, date)` rules.
Rivers follows `typeOf: waterway` or `typeOf: lake` and includes secondary watershed membership.
Places lists contained place notes, such as a town's quarters, buildings and shops.
Inline Places blocks accept `placeType: built` or `placeType: natural`; omit the
option for all types. Built covers communities, structures and infrastructure;
natural covers geographic regions, biomes, water features and landforms, using
`typeOf`. Extraplanar and unclassified types remain in unfiltered results only.
The filter applies to results while containment still follows all ancestor types.
Use `indexes: [rivers]` or `indexes: [places]` for header buttons. Their tables
have River/Place and Type Of columns, sorted by type then name. Both follow dated
nested location chains by default; set `recursive: false` for direct matches.
`mode: grid` is the default; popups always use grids.
See [generated indexes](../../docs/vault.md#generated-indexes) for defaults,
date semantics, website visibility, and complete examples. Grids refresh from
current metadata without Dataview or CustomJS. Source mode keeps the YAML editable.

## Install and update

Install BRAT 1.1.0 or newer from Community plugins, then add
`msackton/taelgarverse-obsidian` in BRAT and enable **Taelgarverse**. The
[distribution README](distribution-readme.md) is the user-facing installation
guide. BRAT follows latest or a pinned version per installation; keep its
preferences and installed plugin files outside vault Git tracking.

New maps use `taelgar-map` fences. The definition inside the fence is unchanged;
the website supports both `taelgar-map` and legacy `leaflet` fences. The bundled
Leaflet library is independent of the separately installed Obsidian Leaflet
plugin. Taelgarverse leaves `leaflet` blocks alone by default, so both plugins
can be enabled together.

For existing notes, either change their opening fence to `taelgar-map`, or turn
on **Render legacy leaflet blocks** in Taelgarverse settings and restart Obsidian.
Legacy support is skipped if Obsidian Leaflet or the old **Taelgar Map Tools**
plugin is enabled. Disable those renderers before enabling legacy support;
their installed files can remain for rollback. No notes are migrated automatically.

## Develop locally

From `taelgarverse-core`:

```sh
npm ci
npm run dev -- --plugin --vault ../test-vault
```

Create and open a disposable test vault first. The command builds, installs,
enables, and tries to reload the plugin. No website metadata is required in that
test vault. Use `npm test` for the full suite, also run automatically in GitHub.
The build produces
`dist/obsidian/taelgarverse/`, including `main.js`, `manifest.json`, and
`styles.css`. All application dependencies and Leaflet icons are bundled;
only Obsidian, its CodeMirror editor API, and Node's desktop built-ins remain external. `release.json` records
the source revision and whether local changes were present. Users need neither
Node nor a core checkout. The installer copies only plugin runtime files and
preserves `data.json`, notes, and unrelated plugins. The development command
removes the old `taelgar-map-tools` ID from the enabled list and adds
`taelgarverse`. Restart Obsidian if automatic reload is unavailable.

## Source ownership

`main.mjs` owns plugin settings and feature registration. `features/maps.mjs`
owns map-component state, image hashing, and cleanup through Obsidian's Component
lifecycle. It uses core's `src/maps.mjs`, `src/browser/map-view.mjs`, and shared
measurement modules. The map CSS scope retains `taelgar-map-tools` as an internal
style class. Calibration belongs in the authored block, not in plugin source.

`features/images.mjs` owns the opt-in image feature, Reading View roots,
CodeMirror Live Preview lifecycle, and one shared viewer per document (including
pop-out windows). It uses `src/browser/image-controls.mjs`,
`src/browser/image-viewer.mjs`, and `public/image-viewer.css`, also used by the
website. Controllers release observers, buttons, event handlers, and open dialogs
when disabled, rerendered, or unloaded. Caption extraction understands native
Obsidian image callouts and per-item galleries, as well as HTML figures.

`features/headers.mjs` selects the host's date/link resolution and calls
`src/header-core/index.mjs`. Node, Worker and the plugin share these maintained
modules; the vault's legacy CustomJS source and generated reference are separate.
Circular relationship chains display a bio error. Render children own refresh
timers and dispose when notes close.

Future features should be separate modules owned by the parent plugin. Add
dependencies only where a feature needs them. Website and plugin versions are
independent; shared changes require testing both consumers and explicitly
releasing each affected consumer.

## Release through BRAT

For AI-driven preparation and publication, follow the repository's
[agent release procedure](../../docs/obsidian-releases.md). Ask the agent to
“prepare a patch release of Taelgarverse”; it reviews changes since the previous
published source commit, writes release notes, and applies the version changes
using `scripts/prepare-obsidian-release.mjs`. “Prepare” produces a reviewable
proposal; an explicit request to publish starts the GitHub release process.

1. Test locally, including a real Obsidian check of rendering, tracing, area,
   closing/reopening a note, and coexistence with Obsidian Leaflet.
2. Update this plugin's `manifest.json`, append its minimum app version to
   `versions.json`, and replace `release-notes.md`. The core package version
   stays independent. Use `x.y.z` versions; do not publish experimental builds
   to this repository, because BRAT's latest also includes prereleases.
   Release notes describe only this release and start with `Taelgarverse X.Y.Z`;
   the uploader rejects a heading for another version. Use
   `node scripts/prepare-obsidian-release.mjs check` for an offline consistency check.
3. Commit and push the reviewed source to `msackton/taelgarverse-core`.
4. In GitHub Actions, run **Release Taelgarverse for Obsidian** against that
   committed revision. It publishes by default; uncheck `publish` to leave a draft.
   Alternatively, push a core tag named `obsidian/<version>` (for example
   `obsidian/0.1.1`). A tag must match the plugin manifest exactly and publishes
   automatically after the CI checks pass.

The GitHub workflow runs the full test suite, local R2/D1 integration tests, and
Worker packaging checks before releasing. It then builds the plugin and uploads
all assets to a draft before publishing. `release.json` records the source commit.
Users get the release through BRAT; your laptop needs no release credentials or
build/upload step. Website deployments do not release the plugin.

A failed upload leaves an unpublished draft to inspect; delete an incomplete
draft before retrying. Existing versions are never overwritten. To promote an
intentional draft, use its GitHub page rather than rerunning the workflow for the
same version. Never replace published assets; bump the plugin version instead.

For one-time setup, give a fine-grained token Contents write
access to **only** `msackton/taelgarverse-obsidian`, save it as
`TAELGARVERSE_RELEASE_TOKEN` in core's Actions secrets. This secret is required
because the workflow publishes to a separate distribution repository.

The distribution repository already exists. Source stays in core; the distribution
repository contains documentation and release artifacts. The internal
`scripts/release-obsidian.mjs` program is the workflow's uploader, rather than an
everyday laptop command.

## Old static-site materializer

Taelgarverse includes an opt-in materializer for the old github.io static site.
Use `npm run materialize:static -- --vault PATH --out OUTPUT --date YYYY-MM-DD --no-strict`
from core, with Obsidian's CLI enabled and Dataview/CustomJS ready. The existing
vault CLI continues to select the original standalone plugin. To switch the
legacy site's wrapper explicitly, set `TAELGAR_MATERIALIZER` to core's
`scripts/materialize-static.mjs` for a `materialize`, `build` or `deploy` run.
No source-note migration is required.

Native `taelgar-header`, `taelgar-index`, and `taelgar-interactions` blocks
produce static Markdown. Index grids use an ordinary table fallback. A
`taelgar-map` fence becomes `leaflet` with its configuration retained. Existing
DQL, supported DataviewJS, inline expressions, and legacy header generation keep
their existing behavior and strict/partial reporting. Export writes to a separate
output directory; the source vault is never rewritten. A manual audit command is
available in Obsidian without changing notes.

The taelgar.org publisher defaults to DQL in Node. `--materializer obsidian`
selects this feature's `materializer.exportDataview(request)` website mode,
which evaluates only DQL through the installed Dataview plugin. It does not
flatten native blocks or execute legacy JavaScript. Node then converts known
patterns and processes images/search as usual. The plugin-root `exportDataview`
request API remains a compatibility alias. Reload the updated plugin before
using this option; no fallback to the original materializer occurs.
See [publishing pipelines](../../docs/publishing-pipelines.md).

## Measure maps

Choose **Measure distance**, then add points or use **Trace path** to follow a
river or road. Separate strokes do not add connecting segments. **Undo** removes
the last point or stroke; **Clear** removes measurements. **Done measuring**
returns to navigation while retaining the result until the map unloads.

Return to an outline's starting point or choose **Close shape** for its enclosed
area. Multiple outlines have separate readings; crossed or retraced outlines
report that area is unavailable. All measurements are temporary. The plugin
reads local images, makes no network requests, and does not rewrite notes.
See [map definitions and calibration](../../docs/maps.md).

## Image viewer

Turn on **Settings → Taelgarverse → Image viewer** to enable the website-style
image controls. It is **off by default** and takes effect immediately, including
notes already open in Reading View and Live Preview. Click a rendered image or
its expand icon for a fitted view with **Download**, **Pan / zoom**, +/−, dragging,
arrow-key panning, mouse-wheel/pinch zoom, and **Fit to screen**. Escape or Close
returns focus to the expand icon. Ordinary source mode keeps its normal editing
behavior. Linked images and modified clicks retain their existing actions.

The same switch styles inline images without requiring a vault snippet.
`[!image|right standard]` and `[!image|left small]` wrap text around the image and
caption; direct embeds such as `![[portrait.jpg|left|small]]` also respect placement
and sizes. Figures center, heroes fill the note, and galleries use a responsive
grid. Asides stack on narrow displays. Legacy numeric widths remain supported.

Captions come from `[!image|...]` callout text, the image's own `[!gallery]` item,
or HTML `figcaption`; alt text is a fallback and remains separate for accessibility.
This feature uses Obsidian's existing image resource URLs. It does not create
thumbnails or tiles, write to the vault, or download remote images in the
background. Maps keep their own controls. Turn the setting off to remove the
image controls and inline styling and close open viewers; map functionality is independent.
