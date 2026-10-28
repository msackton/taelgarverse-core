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

All exported offsets use original Photoshop canvas pixels, X right and Y down.
`src/map-geometry.json` fixes a regular flat hex at 40 pixels / 24 miles.
Four levels of seven-child families divide linear size by sqrt(7), reaching
approximately 0.49 miles at depth four. Slash paths preserve leading zeros.
The Python coordinate implementation and regression fixtures define inclusive
hex crop bounds. No geographic projection or latitude correction is applied.
