# Taelgar map baseline contract

This is the current implementation contract. The earlier progressive-detail
experiments are reference material. See [the practical guide](map-baseline-progress.md)
for commands, numbering, examples and migration from older drafts.

## Export

- One explicit layer recipe selects native Photoshop pixels. It contains only
  full drawable layer paths mapped to booleans. Groups are containers; saved
  visibility does not control output.
- Unknown drawable layers warn and are omitted unless explicitly included by
  CLI. Missing selected layers fail. Repeatable `--include-layer` and
  `--exclude-layer` flags override defaults. There are no special POI or
  latitude/longitude policies in code.
- Compose selected layers in source stacking order on white, preserving opacity.
  Fail on unsupported compositing features. Preserve native resolution.
- Optional inclusive hex endpoints select a mathematical crop; no endpoints
  exports the full canvas. Whole pixels enclose the final hex envelope. Reject
  envelopes extending beyond the source canvas.
- `--output PREFIX` writes `PREFIX.png` and `PREFIX.map.json`, creating parent
  folders when needed and refusing to overwrite either file. The manifest contains `version: 2`, a
  relative PNG filename in `image`, and integer `[x,y]` `sourceOffset`.
  Dimensions are decoded, not configured. No source hash lock, frame identity,
  historical registration, provenance report or configurable calibration.

## Coordinates

Saved pixel crops and town positions use original Photoshop canvas pixels, X right
and Y down. Source geometry is fixed in `src/map-geometry.json`: a regular flat
hex is 40 pixels / 24 miles. Four levels of flat seven-child families divide
linear size by sqrt(7) at each step, reaching approximately 0.49 miles at depth 4.
`src/map-hex-hierarchy.mjs` fixes the alternating rotation and integer ownership.
Slash references append one digit 0–6 per level, preserving leading zeros.
Grid anchor, block anchor, axial anchor and fine-cell numbering are shared across hosts.
Python and JS locator calculations share regression fixtures.

Rendering subtracts `sourceOffset`. Changing the export extent must preserve
saved geographical positions. Display coverage is the intersection of the note
crop and available image. A disjoint crop fails clearly. No projection or
latitude-dependent scale correction is applied.

## Notes and presentation

A version 2 `taelgar-map` block needs `source`, usually a quoted manifest wikilink.
Optional properties include a stable `id`, rectangular `crop`, grid settings and
display sizing. Crops use either positive `x/y/width/height` Photoshop rectangles
or inclusive `topLeft/bottomRight` hex references. Hex shorthand and slash paths
follow the exporter conventions. Crops remain per-map view settings. Retired
`overlays` fields are ignored; polygon masking, dimming and hiding are removed.

The shared website/Obsidian renderer clips image, tiles, grid and selection to
the crop. Clipping follows the image transform during pan and zoom. Fit, minimum
zoom and pan limits use the crop intersected with available image coverage. Measurement
and temporary sketches keep their existing behavior. Grids are viewport-culled:
overview block boundaries, then 24-mile hexes, then successively finer grids when
each is at least 18 CSS pixels across opposite edges. Maximum zoom defaults to 6.
The immediate parent grid remains visible with heavier lines. Faint block boundaries remain while multiple blocks
are visible. No printed grid labels at any level. Hover/select/copy provides
block and hex addresses; pinned locations survive detail changes. Grid geometry
is regenerated on gesture completion, not every drag frame.

Every fine cell has exactly one logical parent, but children do not exactly tile
the regular parent outline. The selected parent highlight follows logical
ownership. Zooming preserves the selected Photoshop point and re-resolves its
cell at the new depth. Existing saved geometry needs no migration. Slash export
endpoints must share a depth and be ordered in Photoshop X/Y; their center
rectangle is expanded by the rotated cell envelope. Legacy 6-mile dot references
are retained only as exporter compatibility, never reinterpreted as slash paths.

## Delivery

Website preparation resolves exact manifest/image paths, decodes the PNG, validates
geometry and generates reusable full-image tile pyramids. Snapshot metadata keeps
the tiny manifest plus decoded image dimensions, so Node and Worker render the
same geometry without runtime filesystem access. Invalid referenced maps stop
publication preparation; local preview isolates errors to affected maps.

Legacy image/bounds maps retain their existing semantics. Old development
manifest/frame blocks require explicit conversion to Photoshop coordinates.
The old static materializer reports version 2 conversion as unsupported and
retains the authored fence. Website deployment, vault publication and plugin
release remain independent actions.
