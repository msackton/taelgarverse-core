# Native Photoshop map symbols

These seven PNGs are unscaled RGBA crops from the Taelgar Photoshop document's
`/points-of-interest/locations` layer. Original burgundy color, soft edges and
partial transparency are preserved; no recoloring, tracing or generated artwork.
`source.json` records the source hash, exact Photoshop rectangles and PNG hashes.
Names describe their visual shapes, not a settlement hierarchy or a map legend.

The Obsidian town marker uses the note's `mapLocation.symbol`, defaulting to
`square`, at 18 CSS pixels tall and centered on the saved point. All seven
variants are available through the placement control's **Symbol** selector or
direct frontmatter edits. Allowed values are `square`, `open-square`,
`diagonal-square`, `crossed-square`, `dot`, `triangle`, and `gate`. Importance controls
visibility independently of symbol shape. The native source pixels limit how
sharp these symbols can be when enlarged.

Rebuild from the local source using the map-export Python dependencies:

```powershell
python scripts/map-export/extract_symbols.py --source experiments/map-lab/aveil/source/taelgar-basemap.psb
```

This writes the PNGs and provenance here plus `src/map-symbols.json`, which embeds
the same PNG bytes as data URLs for a self-contained plugin. It does not alter
the Photoshop file, map recipe, town notes or map exports. Verify the source
rectangles visually before regenerating from a different source revision.
