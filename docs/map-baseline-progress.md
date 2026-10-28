# Photoshop map exports

The exporter writes a native-resolution PNG and a small `.map.json` file. The
website and Obsidian share the same map viewer, grid and rectangular crop behavior.
All saved positions use the original Photoshop canvas: X increases rightward,
Y increases downward, and `[0,0]` is the canvas's top-left corner.

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

## Manifest and note

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

Keep both files together in a publishable vault folder. A minimal note is:

````markdown
```taelgar-map
version: 2
source: "[[assets/maps/taelgar-core.map.json]]"
```
````

Optional `crop` and `grid` settings live in the note. Crops accept Photoshop
pixels or inclusive hex endpoints; see [map delivery](maps.md#delivery-and-maintenance). The viewer
subtracts the export offset for display. A later export with different coverage
preserves these positions; only the intersection with the available image is
shown. A crop completely outside that image produces an error. Saved geometry
is never clipped or rewritten merely by loading a smaller export.

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

## Quick option testing on Windows

```powershell
.\scripts\test-map-export.ps1 -TopLeft 16.10 -BottomRight 16.10.I.24 -Preview
.\scripts\test-map-export.ps1 -TopLeft 16.10 -BottomRight 17.12 -IncludeLayer /points-of-interest/locations,/points-of-interest/roads -ExcludeLayer /forest -Plan
.\scripts\test-map-export.ps1 -TopLeft 16.10.C.07/12 -Preview
```

The helper chooses a fresh `.cache/map-baseline/trial-*` file prefix and prints
the PNG and manifest paths. Use `-Output .cache/map-baseline/my-export` to choose
your own prefix. Preview uses port 8881; override it with `-Port`.
To inspect an export, pass its same file prefix to `--export`:

```powershell
node scripts/preview-map-baseline.mjs --export .cache/map-baseline/my-export
```

The viewer defaults to port 8878 and offers navigation, measurement and the optional grid.

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

Regular geometry intentionally drifts slightly from the source's compressed
horizontal raster grid. This is the agreed choice. At overview zoom, faint
block lines appear; sufficiently close views show 24-mile hexes and four finer levels.
Block lines persist while more than one block is visible. No level prints labels;
hover, pin and copy expose references.

## Seven-child hex families

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

Sizes are `24 / sqrt(7)^depth`. The shared viewer chooses the finest level at
least 18 CSS pixels across, drawing its immediate parent grid more heavily.
Default maximum zoom is 6; explicit `maxZoom` settings still apply. There are no
printed labels. Hover, pin and copy use the current depth; a pin preserves the
Photoshop point while its displayed reference changes with zoom.

Families have exact **logical** ownership, not exact geometric containment.
Regular children can cross a parent's outline. The displayed dashed parent is
the logical parent; a coarser lookup of the same point can have a different
prefix near boundaries. Town positions should remain exact Photoshop points.

`src/map-hex-hierarchy.mjs` fixes the flat hierarchy: odd depths rotate
−19.10660535°, even depths return to the base orientation. Fine axial coordinates
are `M × parent + offset`, with `M=[[2,-1],[1,3]]` at odd depths and
`M=[[3,1],[-1,2]]` at even depths. Child offsets 0–6 are
`[0,0], [0,-1], [1,-1], [1,0], [0,1], [-1,1], [-1,0]`.
These are seven distinct residue classes, so every fine cell has one owner.
Do not change these conventions: that would move existing references.

The exporter accepts slash references at matching depths, including a single
hex. It encloses the screen-aligned rectangle between endpoint centers plus the
full cell envelope, rounding outward to source pixels. Endpoints must be ordered
left/top to right/bottom in Photoshop space; slash digits are not row numbers.
For example, add `--top-left 16.10.C.07/3 --bottom-right 16.10.C.07/3` to export
that complete cell. Fine references can be smaller than a source pixel; export
does not invent higher-resolution artwork. Old `.01`–`.16` 6-mile references
remain accepted by the exporter for compatibility, but the viewer no longer
displays or produces them. Existing pixel-based crops need no migration. Old mask fields are ignored.

## Older drafts

Earlier manifests used version 1 and export-local geometry. Re-export using the
new exporter. For an existing draft note, add the **old export's** Photoshop
offset to `crop.x` and `crop.y`, then remove `coordinateFrame` and retired `overlays`.
Find that old offset by negating the translations in the old manifest's
`sourceToCore` matrix, or from its recorded crop rectangle. Keep width and height
unchanged. Do not just remove `coordinateFrame` from a note containing geometry.
A fresh note needs only `version: 2` and `source`. Legacy `image`/`bounds` blocks
retain their existing behavior. The application deliberately rejects old draft
manifests and frame-bearing blocks rather than guessing their coordinate system.

## Checks and rollout

Run `npm test`, `.venv-map-lab/Scripts/python.exe tests/map-export.test.py`,
and `node scripts/cloudflare.mjs check`. Publication checks use local R2/D1
emulators with `npm test -- --integration`. Deploy website code before
publishing version 2 map content; plugin installation and releases are separate.
