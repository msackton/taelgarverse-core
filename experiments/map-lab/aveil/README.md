> Archived experiment. The current task and portable setup are in `experiments/map-lab/HANDOFF.md`. Generated imagery and recordings mentioned below are deliberately excluded from this branch.

# Aveil mapping proof

## Current test: the actual Leaflet zoom transition

Start with `leaflet-trial/index.html` (keep its neighboring files together), or
download `Taelgar Leaflet Zoom Trial.zip`. Click **Zoom to Aveil**, zoom in and
out, and use **Compare world artwork** at the same location. This uses one
Leaflet map, fixed world coordinates, and a detail overlay that fades with zoom.
`leaflet-trial/zoom-demo.mp4` records the transition.

The detailed image is built by `build_leaflet_detail.py` from a crop of the
published world map, with sharper forest artwork. The original regional Aveil
study remains unsuitable as an aligned overlay. This first transition test
changes woodland texture only; it does not complete the regional cartography.
See `leaflet-trial/READ ME.txt` for bounds, checks, and integration status.

## Earlier standalone artwork test

Open `try-aveil/Aveil Map Trial.html` in a browser. It bundles the map, original
reference, place data and all controls in one file, with no external assets.
Start with **Woodland**, compare **Original reference** at the same view, then
click a town. Set your local vault name before using **Open note in Obsidian**.
Desktop pan/zoom, keyboard controls, reference toggling, marker selection,
generated Obsidian links, mobile layout and pinch zoom were checked in Chromium.
Launching an actual Obsidian vault was not tested in this cloud environment.

`try-aveil/Aveil Map Trial.zip` includes the standalone browser file and a folder
to copy into an Obsidian vault. Its Markdown note uses the existing
`taelgar-map` image viewer and supplies normal note links below the map. The
current plugin does not support clickable marker overlays; those are implemented
only in the standalone trial. The folder includes `.nopublish`.

Run `python build_trial.py` after rebuilding the artwork to refresh the HTML and
ZIP. The browser code lives in `trial.js`. It is an isolated experiment, not a
change to the Taelgarverse viewer or a world-to-region zoom implementation.
For a local HTTP preview, serve only `try-aveil`, for example:

```sh
python -m http.server 8874 --bind 127.0.0.1 --directory try-aveil
```

Then visit `http://127.0.0.1:8874/Aveil%20Map%20Trial.html`. Some managed browsers
block `file:` navigation; HTTP preview is available for those environments.

Open `exports/review.png` for the comparison sheet, or `exports/aveil-study.svg`
for the editable regional study with ten linked town labels. Links use
`obsidian://open?vault=taelgar&file=...` and require a locally registered vault
named `taelgar`; the PNG is a static preview.

This is an exploratory cartographic composition, not a finished regional map.
It demonstrates separate terrain artwork, waterways and town data. The first
version used actual PSB terrain samples throughout; the forest revision uses
newly generated grove assets inspired by the source map. Hills remain PSB
samples. No production viewer or vault content was changed.

## Forest revision

`exports/forest-v1` retains the earlier render, SVG, builder and geography data.
`exports/forest-groves.png` is a new transparent image-generated atlas of nine
deciduous groves, using `aveil-world-context.png` as the style reference. These
are newly drawn assets, not recovered Photoshop content. The atlas has opaque
light canopy interiors and transparent outer margins. SVG symbols reference
nine atlas windows without modifying the image.

The builder places varying-size groves with deterministic irregular spacing,
keeps clearance around waterways and towns, leaves occasional openings, and
uses complete groves at woodland edges instead of clipping tree silhouettes.
`forest-placement.json` records the seed and every placement. Woodland envelopes,
waterway coordinates, lake outline, and all ten town records are unchanged from
the previous revision. The envelopes remain approximate reference digitization.
Individual canopy shapes can extend slightly past those envelopes.

The generated source is also preserved at
`/workspace/generated_images/exec-1bb49474-54ff-48eb-ae9f-0fef6d79e240.png`.
Rebuilding requires retaining the accepted atlas in `exports/forest-groves.png`;
it does not regenerate artwork. The original source tree symbols remain
available for comparison. The hill samples still show enlargement blur.

## Sources and coordinates

- `source/taelgar-basemap.psb`: downloaded Dropbox source, 463,733,393 bytes.
  Dropbox content hash verified before this study:
  `d2183a29eafaa6ac37c0b0a708b6dfe8b250843ef339016c609b5097b1bcf07a`.
- `/workspace/taelgar/assets/taelgar-world-map.png`: published image,
  11329 × 9419 pixels.
- `/workspace/taelgar/assets/Aveil.jpg`: regional reference, 1280 × 2048 pixels.
- Settlement links resolve to existing Gazetteer notes. Their provisional
  reference positions were sampled manually from the visible town icons,
  rather than taken from existing world-coordinate metadata.
- All image coordinates use a top-left origin with X right and Y down.
  No geographic latitude/longitude projection is implied.

## What is ready to reuse

- `exports/coastline.svg`: the original cubic Bezier paths at 14400 × 14400
  document coordinates. This is an outline export, not a reproduction of
  Photoshop's fills or coastal ripple effects. Subpath operations and original
  normalized control points are retained in `coastline-paths.json`.
  Aveil is inland, so no coastline is placed in its study.
- `exports/layers.json`: names, types, bounds, and mask/visibility metadata.
- `exports/registration.json`: fitted published-world-to-PSB transformation.
  SIFT matching and a robust similarity fit produced 2297 inliers from 2553
  candidate matches, with median error 1.247 full-resolution PSB pixels.
  This is an image registration result, not a geographic accuracy claim.
- `exports/crop.json` and the separate terrain/waterway PNGs: a 450 × 390
  world-pixel context region. The PSB crop rounds the fitted rectangle to integer
  pixels; `psb-region.svg` is a source-layer composition, without the grid.
- Six candidate tree symbols and one hill cluster are native transparent
  source crops. Tree candidates are selected near the regional crop from
  separated alpha components; `symbols.json` retains original PSB bounds.

## What is provisional

`aveil-study.svg` uses manually sampled waterways, a lake outline and woodland
envelopes from the regional reference. The river traces have fewer points than
the reference, and hill/tree placement is an illustrative rendering of its
broad terrain distribution. It is not a pixel-exact redraw. No new settlement
names were invented, and the artwork should not be treated as new geographic
canon. The source tree and hill pixels become soft when enlarged; a polished
symbol library will need higher-resolution drawings or reviewed vector assets.

`places.json` records ten original-reference pixel positions and vault links.
World coordinates deliberately remain null. `reference-features.json` stores
the sketch coordinates (1125 × 1800) and their source dimensions. The conversion
to original reference pixels is X × 1280/1125, Y × 2048/1800.

An exploratory two-point fit using Cleenseau and Rinburg's town icons was
checked against the Leandre/Auberonne junction. It misses that independently
sampled junction by about 36 world pixels. These are approximate icon centers,
not surveyed controls; this does not prove a particular map is wrong. It does
show that this fit is unsuitable for a seamless overlay. The rejected fit and
control points are in `reference-registration-diagnostic.json`.

The original regional map's 10-mile scale bar was not carried into the draft
because the relative scale and world alignment remain unresolved. The new
study has no distance calibration.

## Next editing decision

Review which geometry should control the regional waterways where the two maps
differ. Then collect hydrological control points (junctions and bends, rather
than town icon centers), fit a constrained regional footprint, and inspect the
residuals. Preserve locally preferred river geometry explicitly if the world
map is only a generalized view. Only after that should the viewer receive a
regional overlay with a zoom threshold and transition treatment.

## Rebuild

The prototype is isolated from both repositories. Install `psd-tools`, `Pillow`,
`numpy`, `opencv-python-headless`, and `cairosvg` in a local virtual environment.
Run `extract.py`, then `build_preview.py` from this directory. In the current
session the installed packages are available via:

```sh
PYTHONPATH=/tmp/map-tools:/tmp/psd-tools python extract.py
PYTHONPATH=/tmp/map-tools:/tmp/psd-tools python build_preview.py
```

The first script reads the large document and can use several GB of RAM. The
second assembles SVG cartography and renders previews. Both only write inside
this prototype's `exports` directory.
