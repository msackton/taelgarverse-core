Taelgarverse 0.9.1

- Add **Create map from image**: choose a vault PNG or import one from your computer, set its world offset, and create a new map note and manifest with the editor ready to use. No existing map is required.
- Add **Create map from Photoshop file** on desktop: load PSD/PSB layers, choose which supported layers to export, optionally crop to hexes or use transparency, then create and open the map with its world offset preserved.
- Read Photoshop sources through the Dropbox API, with revision-pinned downloads, verified local caching, session-only access tokens or private refresh-token credential files. Dropbox files are never modified.
- Open newly created map manifests immediately, before Obsidian finishes indexing them. Creation checks PNG contents and preserves existing vault files.

Photoshop setup: configure a local Python executable with the exporter's dependencies and the absolute path to `scripts/map-export/export_core.py` from an updated taelgarverse-core checkout. Python and the exporter are not bundled in the plugin. Dropbox credential files must stay outside the vault. See [setup instructions](https://github.com/msackton/taelgarverse-core/blob/main/docs/map-editor.md#create-a-map-from-photoshop).

Map creation expects native Taelgar world-scale artwork. Higher-resolution regional artwork continues to use regional templates. Photoshop export retains its RGB 8-bit and compositing restrictions; unsupported layers are explained in the dialog. Live Dropbox authentication and a real Obsidian/BRAT installation were not verified in this release environment; automated Dropbox tests and a browser harness with real Python export passed.

Minimum Obsidian version remains 1.8.0; this plugin is desktop-only.
