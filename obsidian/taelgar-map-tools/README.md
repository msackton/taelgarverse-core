# Taelgar Map Tools for Obsidian

This companion plugin renders the vault's existing `leaflet` fences in Obsidian
Reading view and rendered Live Preview blocks. It shares the website's image-map
viewer, point ruler, freehand tracing controller, and source-image calibration.
Calibration lives in each vault `leaflet` block, including its hex distance,
source-pixel hex width, original image dimensions, and optional image fingerprint.
Both surfaces read the same data. It requires desktop Obsidian 1.8.0 or newer.

The plugin reads map image files locally and renders image overlays. It makes
no network requests, publishes nothing, and does not write measurements or
drawings into notes. Local Obsidian maps load original images; website maps may
use generated tiles. Routes stay in the current rendered block and disappear
when it unloads. Closing notes or disabling the plugin disposes the maps and
their event handlers.

## Build and install

Run from `taelgarverse-core`:

```sh
npm run build:obsidian-maps
```

The generated release directory is `dist/obsidian/taelgar-map-tools/`, containing
`main.js`, `manifest.json`, and `styles.css`. The Leaflet runtime and icons are
bundled; the only host dependency is Obsidian itself.

To install into a vault and add this plugin to its enabled-plugin list:

```sh
npm run maps:install -- --vault ../taelgar --enable
```

Omit `--enable` to copy the files without activating the plugin. The installer
preserves existing enabled plugins and all notes. If another Leaflet plugin is
enabled, it refuses activation: only one renderer should own `leaflet` fences.
The installer checks resolved target paths and rejects file symlinks before
overwriting plugin files.

If Obsidian was running during installation, enable **Taelgar Map Tools** under
Settings → Community plugins, or reload the plugin after an upgrade. A running
Obsidian with its CLI enabled supports:

```sh
obsidian vault=taelgar plugin:reload id=taelgar-map-tools
```

The source and build remain in core. An installed copy in the vault is a build
artifact and can be reproduced with the command above. Rebuild and reinstall
after changing the shared renderer, ruler, or plugin adapter. Changing a map's
calibration only requires editing its `leaflet` block in the vault and rendering
it again; no plugin rebuild is needed.

## Measure a river or road

Choose **Measure distance** and then **Trace path**. Drag with a mouse, pen, or
one finger to follow the feature; the running total uses the traced bends.
Lift to finish a stroke. Further strokes contribute to the total without adding
an untraced bridge between their endpoints. **Undo** removes the last stroke.
Turn off **Trace path** to pan or place point-by-point route segments. Zoom in
to trace small bends more precisely. **Clear** removes the route, turns off
tracing, and restores panning. **Done
measuring** retains its result while returning to navigation.

The website and Obsidian use the same control code and distance calculations.
For area, return to the outline's starting point or choose **Close shape**. The
enclosed region is lightly filled and its square mileage appears beside the
distance. Nearby endpoints snap closed; tiny outlines can use the button.
Multiple outlines have separate readings, and crossed or retraced outlines
report that area is unavailable. Areas remain temporary, like route distances.
See [calibration and verification](../../docs/maps.md).
