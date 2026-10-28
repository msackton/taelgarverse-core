# Maps and distance measurement

Maps use Leaflet's flat image coordinate system. The distance tool measures
straight segments drawn on the image and sums them for a route. There is no
Earth-radius calculation, spherical distance, latitude correction, or geographic
projection. Zoom, viewport size, source resolution, and tile resolution do not
change a route's measured distance.

The shared website and Obsidian viewer hides Leaflet's default attribution badge.

Choose **Measure distance**, then click or tap points along a route. **Undo**
removes the last point, **Clear** removes the route and exits tracing mode, and **Done measuring** leaves
the result visible while returning to ordinary navigation. Maps remain draggable
and zoomable while measuring. Keyboard users can pan with arrow keys and add the
map center with Enter or Space; Backspace undoes a point and Escape finishes.
The center crosshair appears only with visible keyboard focus in point mode. Each map,
including repeated note embeds, has its own measurement state. Measurements stay
in the current browser page and are not saved to notes or published content.

Choose **Sketch** to draw temporary shapes without distance or area readings.
Sketch enters freehand mode every time you choose it; turn off **Trace path** to
add point outlines or pan. **Clear** and **Close shape** leave Sketch ready for
another freehand drawing. **Close shape** fills an outline, **Undo** removes the last sketch
action, and **Done sketching** returns to navigation with drawings still visible.
Sketches and measurements remain separate when switching tools, and **Clear**
removes both. Each map keeps its own drawings only until it unloads; nothing is
saved. Sketch also works when a map's measurement calibration is unavailable.
Closed shapes receive labels **1**, **2**, **3**, and so on inside their outlines,
including freehand shapes. Each tool numbers its own shapes in drawing order;
measurement labels match the numbered area readings. Undo updates the labels,
and Clear removes them and restarts numbering.

For a winding river or road, turn on **Trace path** while measuring and drag
with a mouse, pen, or one finger. The total includes the sampled bends rather
than a straight chord between the start and end. Each stroke is one Undo action.
Separate strokes add to the total without inserting a straight connecting
segment. Switch off Trace path to pan or add point segments; zoom buttons remain
available. Zoom in for finer tracing. A cancelled stroke or a view change during
drawing discards the unfinished stroke without changing completed measurements.
The live stroke refreshes once per display frame without rebuilding completed
drawings. All accepted pointer samples still contribute to its geometry and
distance; releasing the pointer immediately commits the final result.

To measure a region, draw its outline and return to the start, or choose
**Close shape** to add a straight segment back to the first point. An endpoint
within 10 screen pixels of the start snaps closed after the outline has extended
more than 20 screen pixels away; this avoids closing short open paths by accident.
Small outlines can always be closed explicitly. A closed outline gains a light
fill and an **Area** reading in **square miles**, alongside its perimeter distance.
Point routes and freehand traces use the same calculation. Undo removes an
explicit closing segment (or an entire trace), and Clear removes area results.
Further points start a separate route after a closed outline.

**Close shape** repairs accidental crossings, loops, touches, and retraced
overshoots, keeping the larger enclosed region at each crossing. Sketch applies
the same forgiving correction when an outline snaps closed. Valid concave
outlines retain their bends. An already closed invalid outline can also be
repaired with **Close shape**. The corrected line, fill, distance, and area use
the same outline; Undo restores the original outline for an explicit closure,
or removes the freehand stroke for automatic closure.

Automatic closure while measuring applies only small corrections: a
6-screen-pixel radius and loops representing at most 15% of the outline's
perimeter. For larger misdrawn overlaps, choose **Close shape** explicitly.

Area uses the polygon's original bends and the calibrated horizontal and vertical
scales, without a projection. Concave outlines and either drawing direction are
supported. Outlines that still cross, touch, retrace, or enclose no area keep
their distance but report that area is unavailable. Multiple outlines show separate numbered
areas; overlapping outlines are not combined into a union or interpreted as holes.
Maps authored with other units show square units instead of square miles.

The [Taelgarverse Obsidian plugin](../obsidian/taelgarverse/README.md) uses the
same map viewer, tracing controller, and calibration. It renders existing
`taelgar-map` blocks locally without rewriting their source. The website accepts
both `taelgar-map` and legacy `leaflet` fences. Taelgarverse's optional legacy
setting handles `leaflet` blocks only when another known map renderer is not
enabled; it is off by default so Obsidian Leaflet can coexist. Switching a note
to the new fence changes only its opening label, preserving its definition and
calibration. BRAT distributes the plugin independently of the website.

## Calibration belongs in the map block

Each `leaflet` block owns its distance calibration in the vault. Both the website
and Obsidian read it directly; there is no bundled table of Taelgar map scales.
For example, the legacy Sembara map currently includes the following calibration.
This records an older independent export, **not** the authoritative baseline scale.
Do not copy its pixel spacing into the new core manifest; see the migration status
below.

```yaml
calibration:
  hexMiles: 24
  hexPixels: 40.333333333333336
  imageSize: [2308, 2468]
  imageSha256: d9f0f94036483065b5a15e86afdc84c2f7bb2704b81abb4a3ca4b8532dda8913
```

`hexMiles` is the distance between opposite flat sides of one hex. `hexPixels`
is that same distance in **original image pixels**. It also works for an image
without a visible grid when its scale is established against another map.
`imageSize` is `[width, height]` of the original image, independent of the block's
display bounds, height, and width. These three fields are required for an
explicit calibration and must contain positive numbers (integer image sizes).

`imageSha256` is an optional SHA-256 fingerprint of the original image. Existing
Taelgar blocks include it so replacing, resizing, or cropping an image disables
measurement until the calibration and fingerprint are checked. The image remains
viewable. A missing hash in the renderer or a mismatched hash also disables
measurement when the block specifies a fingerprint. Invalid explicit calibration
never falls back to the older `scale` field.

An explicit calibration takes priority over `scale` and `unit` and reports miles.
Blocks without `calibration` retain their authored `scale` and `unit`; without
either field they show **map units**. These legacy scale values apply to display
coordinates, so use source-pixel calibration for accurate image measurement.

Editing these values takes effect when Obsidian renders the block again, without
rebuilding the plugin. The website receives changes through content publication.

## Legacy export registration and baseline development

The existing Taelgar maps use **24 miles between opposite flat sides of a hex**.
Their older `bounds` and `scale` fields are display settings and are not a reliable
distance calibration. Some bounds stretch the image nonuniformly, and some
exports resize or remove the original hex grid.

The existing map blocks record source dimensions, hashes, and previously inferred
hex pixel widths. The following table preserves the older image-registration
evidence. The gridded
`assets/world-map-regions-new.png` is the reference. In an unobstructed ocean
sample (`x=6000..7000`, `y=1500..4000`), 245 horizontal grid edges spanning
123 hexes fit a hex height of **20.166667 pixels**, with an edge-fit RMS residual
of 0.091 pixels. That raster fit is historical evidence about an exported image;
it must not override the authoritative **40 source pixels per 24-mile hex**.
The legacy ruler still uses its block-authored `121/6` spacing until those notes
are deliberately migrated. The source PSB inspection supersedes this as the
physical scale for the new core map.

Other exports were registered to the reference using matching landmarks, a
robust affine fit, and rejection of inconsistent matches. Every fit supported
a uniform source-pixel scale of 1, 1/2, or 2/3 relative to the reference, within
0.06%; no geographic transform is used at runtime. These comparisons establish
relationships between exported rasters, not an independent physical calibration.
Median fit residuals are in reference-image pixels:

| Image under `assets/` | Source pixels | Reference pixels per source pixel | Matching landmarks | Median residual |
| --- | --- | --- | --- | --- |
| `taelgar-world-map.png` | 11329 × 9419 | 1/2 | 2527 | 0.236 |
| `world-map-regions-new.png` | 7200 × 4536 | 1 | Reference | — |
| `north-sentinels-map.png` | 1042 × 953 | 1 | 696 | 0.163 |
| `region-central-highlands.png` | 1876 × 2930 | 1/2 | 304 | 0.188 |
| `region-drankorian-hinterland.png` | 4429 × 2232 | 1/2 | 217 | 0.255 |
| `sembara-region-map.png` | 2192 × 2507 | 1/2 | 411 | 0.176 |
| `sembara-regions.png` | 2308 × 2468 | 1/2 | 271 | 0.206 |
| `north-green-sea-region.png` | 2534 × 1076 | 2/3 | 246 | 0.204 |
| `region-northwest-coast.png` | 1340 × 1187 | 1 | 207 | 0.285 |
| `upper-istaros-region-map.png` | 2013 × 1693 | 1/2 | 363 | 0.174 |
| `region-west-green-sea.png` | 1753 × 3220 | 1/2 | 147 | 0.222 |

The new [baseline development preview](map-baseline-progress.md) uses a native
core export, exactly **0.6 miles/pixel**, original Photoshop canvas coordinates and
generated regular flat-top hexes. Both the website and development Obsidian plugin
accept per-map rectangular crops in Photoshop pixels or inclusive hex endpoints.
**Fit map**, zoom-out limits and pan bounds use that crop. Image/tile clipping
stays attached during dragging and animated zoom; grid edges are clipped too.
Polygon masks and dim/hide overlays are retired. Old `overlays` fields are ignored.
The separate [Obsidian editor](map-editor.md) authors town locations using the
full exported image. Production rollout is separate; legacy blocks are unchanged.
Baseline views fit in quarter zoom steps and use half-step zoom buttons.
The source raster's slightly compressed horizontal hex spacing is measured and
documented there. The user chose regular geometry with accepted drift. New exports
use the verified `row.column.A–I.01–24` numbering and support inclusive hex-based
export bounds. Missing letter/number mean A/01 at either corner. Older draft manifests and frame-bearing blocks need [explicit conversion](map-baseline-progress.md#older-drafts).

With **Hex grid** enabled, verified baseline maps show block boundaries at overview
zooms and individual hexes once they reach 18 CSS pixels tall. Zooming changes the
displayed detail, not the coordinates or geographic scale. Block boundaries follow
the global origin through crops. Hover, pin
and copy operate on the displayed block or hex; pinned locations survive zooming.
Blocks and hexes have no printed labels. Hover or click any block to read its
coordinate in the controls below the map.
Faint dashed block boundaries remain visible alongside either hex grid while
more than one block is in view. They disappear when the visible crop fits within
one block and return when panning or zooming exposes a neighboring block.
Grid geometry refreshes after a pan or zoom ends; Leaflet moves the existing grid
during the gesture. Grid and selection edges are clipped to the crop.
Unchanged views reuse their grid geometry; hovering within the same cell reuses
its highlight and coordinate label.

Closer zoom resolves four levels of **seven-child families**: approximately
9.07, 3.43, 1.30 and 0.49 miles across opposite edges. A reference such as
`16.10.C.07/3251` appends one child digit per level; `0` is the center and `1`–`6`
run clockwise from the surrounding child closest to map north. Leading zeros
are significant. The immediate parent grid has heavier outlines; no grid has
printed labels. Hover or pin to read and copy a reference. Logical ownership is
stable even where a child crosses its parent's outline. See
[seven-child numbering](map-baseline-progress.md#seven-child-hex-families) for
geometry, export bounds and the distinction between ownership and containment.
Baseline maps default to maximum zoom 6 so the fourth level is reachable.

The development Obsidian plugin offers **Place town** in its separate editor tab. It saves exact
Photoshop X/Y and a depth-four reference in the town note's `mapLocation` field,
then displays a clickable native Photoshop marker. The note's `symbol` selects
one of seven extracted shapes, defaulting to `square`; the placement controls
offer a **Symbol** selector with a preview. Its saved `importance` controls visibility:
World at overview, Regional at the 24-mile grid scale, Local (default) at the
first subdivision, and Detail at the second. Thresholds apply with grid lines
on or off; closer zooms retain already visible features. Placement runs outside the read-only embeds
and requires an explicit Save. Website town-marker delivery is not implemented.
See [town placement and persistence](map-editor.md#place-towns).

River and road notes can carry `mapPath: {kind, importance, source}`. The source
is a vault-root-relative `.map-path.json` file containing `{version: 1, points}`;
legacy inline `points` remains readable. Version 2
maps render these ordered Photoshop-coordinate polylines in blue (river) or
brown (road), clipped to the crop, with the same importance thresholds as towns.
They have no implicit closing edge or layer toggles. Published paths include
only notes available in the reader's date/campaign/POV context and link to their
pages. The Obsidian editor supports point edits and freehand tracing, saving the
geometry file and only the selected note's `mapPath` field; see [rivers and roads](map-editor.md#rivers-and-roads).

For each segment, the renderer first undoes the display bounds' horizontal and
vertical scaling to recover source-pixel differences. It multiplies those by
`hexMiles / hexPixels` miles per source pixel, takes the planar distance,
and adds it to the route. The old authored `scale` is not applied again.

For legacy calibrated image blocks, publication records original-image SHA-256
hashes; local preparation and Obsidian verify those hashes. Version 2 manifest
maps use the fixed Photoshop pixel scale without a configured image hash.
The same block therefore produces the same physical distance on both surfaces.

## Delivery and maintenance

Version 2 maps reference a `.map.json` file in the vault. The store discovers
`.map.json` manifests and `.map-layers.json` region assets; ordinary JSON files
are not automatically published.
The source can be a quoted wikilink, an exact vault path, or a path relative to
the note. Missing qualified paths never fall back to a matching basename. The
manifest's PNG path resolves exactly relative to the manifest, and normal folder
publication exclusions apply to both files.

Preparation validates pixel or hex crop bounds and fully decodes the static
PNG before tiling. The tiny version 2 manifest contains `version`, `image`
and `sourceOffset`, plus optional shared `layers` file references. Image dimensions
come from the PNG. The shared Taelgar grid
sets the scale to 0.6 miles/pixel. Rendering subtracts `sourceOffset` from saved
geometry, so a different export extent preserves geographical positions. Crops
are intersected with available coverage; a disjoint crop displays an error. Invalid referenced baselines
fail publication preparation; quick local preview shows a map warning while
other pages remain available. Notes excluded from all publication are ignored.
The snapshot carries `mapManifest` and image `mapImageInfo`
metadata into both regular and compiled Worker renderers; requests perform no
filesystem reads. Original manifests are also available as JSON assets. Multiple
crops share the full image's tile pyramid, and home/campaign-only maps participate
in preparation. **Open full source image** explicitly opens the underlying PNG.

Deploy the updated website code before publishing version 2 blocks. Install or
release the Obsidian plugin separately. The old static materializer still does
not convert version 2 blocks into legacy Leaflet syntax.

The website and local Node preview generate 512-pixel WebP tiles at multiple
zoom levels for map images with an original edge of at least 2,048 pixels or a
file size of at least 1 MiB. Selection uses the actual image rather than its
authored display bounds. Smaller images, animations, and maps with nonzero-origin
bounds remain image overlays. Undecodable legacy images remain available through their
original URLs, with a preparation warning instead of a tile pyramid.

The viewer requests tiles for the visible area and zoom level. Generated tile
URLs include a hash of the source bytes and tile recipe, so changed imagery gets
new URLs. Tiles use a one-year immutable cache policy; original image URLs still
revalidate. Tile generation preserves the original download and calibration.
The Obsidian adapter continues to use local original images without generated
tiles.

For legacy image blocks, deploying core enables the cache policy for existing
published tiles. Republish content to generate tiles for newly eligible maps; the existing viewer can read
the same tile metadata, so either deployment order works. These are separate
release actions and neither is performed by local preparation or tests.

The controller is bundled into the existing map-only browser asset. The Worker
uses source hashes already present in published snapshots. For migration from
the previous bundled table, **publish the blocks with calibration first**, then
deploy the updated core. The older renderer ignores the new fields and retains
its existing table until upgraded. Deploying this renderer against unmigrated
content instead uses that content's older `scale`/`unit` values.
Local previews must restart after core or source-image changes.

When replacing a calibrated image, compare several complete hexes or register
the replacement against the verified reference. Check horizontal and vertical
scale, and update `hexPixels`, `imageSize`, and `imageSha256` in every block using
that image. New maps only need an authored block; no core code or plugin rebuild
is required. Do not infer miles per pixel from a compressed
thumbnail, current browser pixels, tile pixels, or the old display bounds.

Regression coverage includes 24-mile cardinal and diagonal distances at different
source resolutions and display bounds, the independent 123-hex span,
changed-image rejection, route totals, multiple maps, keyboard use, controls,
and Node/Worker map rendering. Tracing checks cover curved geometry, disconnected
strokes, coalesced pointer events, whole-stroke Undo, cancellation, and navigation
restoration. Obsidian adapter checks cover local image resolution/hash caching,
component disposal, stale asynchronous work, bundle integrity, and installation
into a disposable fixture. Real-vault activation is a separate step.
Area checks cover known shapes, concavity, reversed winding, large coordinate
origins, stretched display bounds, dense traces, invalid rings, automatic and
explicit closure, independent outlines, Undo, and Clear.
Sketch checks cover mode switching, separate measurement state, missing
calibration, per-map isolation, disposal, and Clear. Closure correction checks
cover tiny loops, touches, overshoots, zoom sensitivity, winding, and retention
of substantial crossings.

Shared region borders now render in both hosts over PNGs or tiles, with names, optional note links, and per-map opt-in layer
checkboxes (`toggleableLayers`, empty by default). They use Photoshop coordinates and
clip to each map crop. See [region layers](map-layers.md) and
[authoring](map-editor.md#region-borders).
