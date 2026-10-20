# Taelgarverse for Obsidian

The unified desktop Taelgarverse plugin. Version **0.1.0 contains Maps only**:
local image maps, calibrated distances, freehand tracing, and enclosed areas.
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
npm run test:obsidian
npm run build:obsidian
npm run obsidian:install -- --vault ../test-vault --enable
```

Create and open a disposable test vault first. The build produces
`dist/obsidian/taelgarverse/`, including `main.js`, `manifest.json`, and
`styles.css`. All application dependencies and Leaflet icons are bundled;
only Obsidian and Node's desktop built-ins remain external. `release.json` records
the source revision and whether local changes were present. Users need neither
Node nor a core checkout. The installer copies only plugin runtime files and
preserves `data.json`, notes, and unrelated plugins. `--enable` removes the old
`taelgar-map-tools` ID from the enabled list and adds `taelgarverse`; restart
Obsidian to apply this. Without `--enable`, it only installs files.

The former `build:obsidian-maps` and `maps:install` commands are compatibility
aliases which now build/install Taelgarverse.

## Source ownership

`main.mjs` owns plugin settings and feature registration. `features/maps.mjs`
owns map-component state, image hashing, and cleanup through Obsidian's Component
lifecycle. It uses core's `src/maps.mjs`, `src/browser/map-view.mjs`, and shared
measurement modules. The map CSS scope retains `taelgar-map-tools` as an internal
style class. Calibration belongs in the authored block, not in plugin source.

Future features should be separate modules owned by the parent plugin. Add
dependencies only where a feature needs them. Website and plugin versions are
independent; shared changes require testing both consumers and explicitly
releasing each affected consumer.

## Release through BRAT

1. Test locally, including a real Obsidian check of rendering, tracing, area,
   closing/reopening a note, and coexistence with Obsidian Leaflet.
2. Update this plugin's `manifest.json`, append its minimum app version to
   `versions.json`, and replace `release-notes.md`. The core package version
   stays independent. Use `x.y.z` versions; do not publish experimental builds
   to this repository, because BRAT's latest also includes prereleases.
3. Commit and push the reviewed source to `msackton/taelgarverse-core`.
4. Create a release draft:

   ```sh
   npm run obsidian:release -- --notes obsidian/taelgarverse/release-notes.md
   ```

5. Review the draft's assets and source link on GitHub, then publish it. BRAT
   can now install it. Add `--publish` on the initial release command to publish
   directly after all uploads succeed. Do not rerun the command to promote an
   existing draft: it intentionally refuses to overwrite existing versions.

The command requires a clean checkout, runs the map/plugin tests, builds the
bundle, verifies the source commit exists on GitHub, and uploads all assets to a
draft before publishing. `release.json` records the source commit. A failed upload
leaves an unpublished draft to inspect; delete the incomplete draft before retrying.
Never replace an already published version's assets; bump the plugin version.

Authentication uses `GH_TOKEN`/`GITHUB_TOKEN` or the configured Git Credential
Manager sign-in. For automated releases, give a fine-grained token Contents write
access to **only** `msackton/taelgarverse-obsidian`, save it as
`TAELGARVERSE_RELEASE_TOKEN` in core's Actions secrets, and manually dispatch
**Release Taelgarverse for Obsidian** from the desired committed source revision.
The workflow defaults to creating a draft. It does not run on website deployments.

For initial setup only, add `--init-repository` to create the public distribution
repository with its installation README and license. This requires the msackton
account with repository creation rights; normal release tokens need only Contents
write. Source stays in core; the distribution repository contains documentation
and release artifacts, with no manually maintained source copy.

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
