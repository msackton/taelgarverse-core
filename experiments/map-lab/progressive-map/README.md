> Archived experiment. The current task and portable setup are in `experiments/map-lab/HANDOFF.md`. Generated imagery and recordings mentioned below are deliberately excluded from this branch.

# Taelgar: original rivers with progressive zoom

Unzip the whole folder, open `index.html`, and click **Play river zoom tour**.
Use **Region**, **Local**, and **River close-up** to navigate directly.
**Show Photoshop original** switches between the traced vectors and the original
river strokes at exactly the same map position. Scroll/pinch and drag work normally.
Roads and places can be hidden independently using the sidebar checkboxes.

## What is original

The terrain and one complete river system on the western shore of the bay come
from `taelgar-basemap.psb`. The system contains a main course and nine tributary
paths. These replace all invented rivers in the earlier experiment.
Roads, settlements, buildings and their names remain fictional. **Demo town**
opens the earlier illustrative town plan; it is independent of these rivers.
The obsolete fictional bridge overlay has been removed.

The river source was a raster layer, so these are approximate centerline traces,
not original Photoshop vector paths. Registration to the terrain uses the
previously fitted world-to-Photoshop transform (median registration residual
about 1.25 original document pixels). Canonical river names have not been assigned.
The separate lakes layer and other river systems are outside this extraction.

## How zoom works

One Leaflet map and one set of fixed river coordinates are used throughout:

- World scale: the main course is visible.
- Region scale: six secondary tributaries fade in.
- Local scale: three smaller tributaries fade in.
- Close-up: smooth vector curves reveal existing bends and junctions. The
  raster terrain fades to 30% opacity so it does not dominate the river drawing.

River weights remain in screen pixels. Opacity fades span 0.8 zoom units.
Source geometry is never regenerated on zoom. Confluences are retained as shared
control points before smoothing and simplification. Leaflet simplifies the drawn
curves in screen pixels according to zoom.

The main route is the longest traced path from the selected mouth; visibility
ranks are display choices, not claims about stream order or canonical importance.
This restores only detail already present in the Photoshop river layer. It does
not invent smaller streams or reconstruct geography beyond the artwork.

The source comparison displays every original branch at every zoom; the vector
view progressively reveals branches. With Rivers unchecked, both are hidden.

## Files

- `index.html`: offline viewer and controls.
- `rivers.js`: traced river coordinates, display ranks and source metadata.
- `data.js`: fictional roads/towns/buildings, plus camera presets.
- `progressive.js`: shared zoom rendering, transitions and interaction.
- `river-source.png`: transparent extract of the original river system.
- `river-provenance.json`: source, registration, extraction method and limits.
- `terrain.png`: clean terrain registered to the published map, 11329 × 9419.
- `previews/`: current river screenshots.
- `river-zoom-demo.mp4`: recording of this river zoom tour.
- `vendor/`: local Leaflet 1.9.4 and license. No remote assets are needed.

Coordinates are original published-image pixels: X right, Y down. Leaflet
converts each point to `[9419 - y, x]`. Source-image bounds use the same frame.

Authoring scripts and the intermediate river-layer crop are kept alongside this
viewer in `/workspace/map-lab/river-tracing/`. The tracing pipeline selects one
connected river system, thins it to a centerline, builds connected paths, preserves
junctions, and smooths/simplifies between junctions. The original Photoshop
file is unchanged.

The source/trace contact sheet and browser previews were visually inspected.
No automated tests were added or run for this revision.

## Running locally

If your browser blocks local files, serve this folder:

```sh
python -m http.server 8877 --bind 127.0.0.1
```

Then open http://127.0.0.1:8877/.

This is a local prototype. The production website, Obsidian plugin, and vault
have not been modified. Integration still requires shared viewer support for
vector data assets and source resolution on both platforms.
