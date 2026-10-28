# Photoshop map exports

The exporter writes a native-resolution PNG and a small `.map.json` file.
Coordinates use the original Photoshop canvas: X increases rightward, Y downward.

## Recipe

`scripts/map-export/taelgar-core.recipe.json` contains one `layers` object:

```json
{
  "layers": {
    "/forest": true,
    "/points-of-interest/roads": false,
    "/latitude/lat-major/tropics": false
  }
}
```

List every **drawable layer** by its full Photoshop path. Groups are containers,
so they need no entries. `true` includes the layer; `false` excludes it. Saved
Photoshop visibility, including group visibility, does not change these choices.
An unlisted drawable layer produces a warning and is omitted. A selected path
that is missing is an error; an absent excluded path is harmless.

Repeat `--include-layer /group/layer` or `--exclude-layer /group/layer` to override
defaults for one export. A newly included CLI layer still warns if it is absent
from the recipe. Latitude, longitude, old grid labels, and points of interest
have no special code rules: their defaults are ordinary `false` entries.

The compositor uses saved layer pixels in Photoshop stacking order over white,
with ordinary layer opacity. Unsupported blend modes, masks, effects, group
opacity and color profiles produce an error. No scaling or resampling occurs.
The current source lacks the geographic names on the published map; using it
for this first baseline was approved.

## Manifest

The generated manifest has exactly three fields:

```json
{
  "version": 2,
  "image": "taelgar-core.png",
  "sourceOffset": [5605, 7180]
}
```

`image` is relative to the manifest; `sourceOffset` is the PNG's top-left in the
Photoshop canvas. Dimensions come from the PNG. There are no calibration knobs,
frame IDs, fingerprints, transformation matrices or provenance files.

## Reproduce locally

Use Python 3.11 and the checked-in dependency versions:

```powershell
py -3.11 -m venv .venv-map-lab
.venv-map-lab/Scripts/python.exe -m pip install -r scripts/map-export/requirements.txt
.venv-map-lab/Scripts/python.exe scripts/map-export/export_core.py --source experiments/map-lab/aveil/source/taelgar-basemap.psb --output .cache/map-baseline/my-export --top-left 16.10 --bottom-right 16.10.I.24
```

The source PSB is local and ignored by Git. `--recipe` defaults to the checked-in
recipe. `--output` is a file prefix: `.cache/map-baseline/my-export` creates
`my-export.png` and `my-export.map.json` beside each other. Parent folders are
created as needed. Existing output files are never overwritten; choose a new
prefix if either file exists. The manifest references the chosen PNG filename.
With no endpoints, the Python CLI exports the entire Photoshop canvas. With
only `--top-left`, it exports that single hex. `--plan` prints layer choices and
calculated bounds without opening the PSB; source inventory and canvas coverage
are checked during the actual export.

## Locator numbering and export bounds

The fixed geometry lives in `src/map-geometry.json`, shared by Python and JS:
40 pixels across opposite hex edges represents 24 miles, or 0.6 miles/pixel.
The grid anchor is `[16.5,20.5]`, axial origin `[0,0]`, block origin `[0,0]`.

`16.11` means the 16th block from the top and 11th from the left. Each block
has 18 columns and 12 rows of hexes. Sections are arranged `A D G / B E H / C F I`;
each contains six columns of four hexes, numbered downward then rightward 01–24.
`02.04`, `02.04.A`, and `02.04.A.01` name the same first hex. To include an entire
block, use its first hex through `.I.24`. Both export endpoints are inclusive.
The crop encloses the complete cells, rounds only its final edges outward to
whole pixels, and rejects coverage outside the Photoshop canvas.

## Seven-child export references

Each 24-mile hex has seven children, and each child has seven more. A reference
appends a slash and one digit per level: `16.10.C.07/3251`. Digit `0` is the
center; `1` is the surrounding child closest to map north, then `2`–`6` proceed
clockwise. Leading zeros matter: `/0031` has four levels, `/31` has two.

| Depth | Miles across opposite edges | Example |
| --- | ---: | --- |
| 0 | 24 | `16.10.C.07` |
| 1 | 9.071147 | `16.10.C.07/3` |
| 2 | 3.428571 | `16.10.C.07/32` |
| 3 | 1.295878 | `16.10.C.07/325` |
| 4 | 0.489796 | `16.10.C.07/3251` |

Both endpoints must use the same depth and be ordered left/top to right/bottom in Photoshop space. The crop encloses the complete rotated cells and rounds outward to source pixels. Legacy `.01`–`.16` 6-mile suffixes remain accepted for compatibility.
