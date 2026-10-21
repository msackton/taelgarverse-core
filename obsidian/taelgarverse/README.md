# Taelgarverse for Obsidian

The unified desktop Taelgarverse plugin: local image maps, calibrated distances,
freehand tracing, enclosed areas, an optional image viewer, and opt-in saved pronunciation tools.
Name Explorer and the materializer remain separate. Requires Obsidian 1.8.0+.

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

`features/pronunciation.mjs` owns the opt-in generation controls, native header audio links, timers, playback and cleanup. Its settings are nested under `pronunciation`, preserving Maps and Images preferences. The Azure adapter in `pronunciation-synthesis.mjs` is bundled only for Obsidian; shared path and header helpers live in `src/pronunciation-data.mjs`.

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

## Pronunciation (local experiment)

In **Settings → Taelgarverse → Pronunciation**, turn on **Enable pronunciation
tools**. This is off by default. Generate is then available in Reading View below
the note title, beside each names metadata entry in Live Preview, in the note
toolbar, the ribbon, and the command palette.
**Preview** uses the same Azure voice, language, and text/IPA settings as Generate
when a key is configured. It plays a temporary clip without saving or linking it
(Azure usage charges still apply). Without a key it explicitly selects an available
device voice matching the language; this fallback is approximate and cannot interpret IPA.
If no matching device voice exists, Preview reports that instead of speaking in a different language.
Without an Azure key, Generate saves an explicitly labeled test-tone WAV.

For real synthesis, use the written pronunciation in a names metadata entry (or
frontmatter), and select/create the
Azure Speech key secret in these same settings (Obsidian 1.11.4+), then set the
resource region, locale, and voice. Credentials from a separate demo vault must
be configured in the real vault as appropriate; the installer never copies keys.
See the [pronunciation guide](../../experiments/pronunciation/README.md) for
Azure setup, path conventions, supported fields, and prototype limitations.

Generation saves WAV under `assets/pronunciation/<note path without .md>.wav`.
Existing real WAV/MP3 takes precedence over `.mock.wav` test tones. The plugin
maintains a small owned native embed after a leading H1 and can restore it after
CustomJS header regeneration. It does not synthesize on opening a note or scan
all notes. Disable pronunciation to remove its controls, discard pending
generation responses, and stop automatic link maintenance; saved clips and
native embeds remain. The website discovers indexed clips independently.

This worktree build is for local testing, not a published plugin release. Local
installation keeps the manifest version; BRAT updating the plugin can replace
this development build.

Generate audio is also available directly beside rows in the
`%%^Metadata:names:v1%%` section in Live Preview. It uses each row's written
`pronunciation` and documented `language`, with selectable real-world analogs
read from `Background/Languages.md`. Unknown or ambiguous mappings are labeled;
no fictional language is presented as a native Azure voice. Primary names keep
the note's existing audio path; aliases get separate clips. Name rows remain
editable and unchanged. See the [names metadata guide](../../experiments/pronunciation/README.md#names-metadata-and-live-preview).

A names row that supplies either `pronunciation` or `pronunciationIPA` overrides
both frontmatter pronunciation fields for that name. Within the row, a written
`pronunciation` guide takes precedence over IPA. The primary name inherits the
frontmatter guide/IPA only when its row supplies neither.

Each names row also has **Default voice / Female / Male** and
**Default input**, **Pronunciation / IPA**, or **Name only** input choices. The
**Pronunciation / IPA** option uses the written guide or optional IPA;
**Name only** ignores both and pronounces the name using the selected language.
Choices are saved per note/name in plugin settings, apply to Preview and Generate,
and leave the note text unchanged. Defaults can be set under Pronunciation in
plugin settings. A specific `pronunciationVoice` override fixes the voice and
disables the male/female selector. Male/female selection requires Azure; browser
voices do not expose gender. Existing saved audio changes only after Regenerate.
