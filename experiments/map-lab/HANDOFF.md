# Taelgar map exporter handoff

Commands and format details live in [the baseline guide](../../docs/map-baseline-progress.md) and [the contract](../../docs/taelgar-map-baseline-spec.md).

The native exporter uses explicit boolean layer choices and a three-field version 2 manifest. The source at `aveil/source/taelgar-basemap.psb` is local and ignored by Git; its missing geographic labels were accepted for this baseline. The regular grid deliberately accepts slight drift from the old raster grid.

`inspect-source-grid.py` preserves optional source-pattern research separately from export. Older experiments are reference material. The exporter does not publish content or install the plugin.
