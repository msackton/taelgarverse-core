# Taelgar map baseline handoff

Current behavior and commands live in [the baseline guide](../../docs/map-baseline-progress.md),
[the contract](../../docs/taelgar-map-baseline-spec.md), and [the editor guide](../../docs/map-editor.md).

The production implementation uses a boolean layer recipe, native Photoshop
pixels, and a three-field version 2 manifest. Notes save Photoshop canvas
coordinates. The shared viewer translates using the export offset and derives
PNG dimensions. There are no per-export calibration settings, source hash locks,
coordinate-frame IDs, POI special cases or provenance files.

The source at `aveil/source/taelgar-basemap.psb` is ignored by Git. Geographic
names from the published map are absent; using this source for the first baseline
was approved. The regular 40-pixel grid deliberately accepts slight drift from
the old raster grid. No block or hex labels are printed; references remain
available through hover/select/copy. Four levels of seven-child families reach
approximately 9.07, 3.43, 1.30 and 0.49 miles across opposite edges.

`inspect-source-grid.py` preserves the optional source-pattern research separately
from the exporter. Other progressive-detail and historical alignment experiments
in this directory are reference material, not dependencies of current exports.

The user handles the vault export and test note. Website code, vault content and
plugin releases have separate rollout paths. Follow the repository permission
gates before any remote push, deployment or content publication.
