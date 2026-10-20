# Maps and distance measurement

Maps use Leaflet's flat image coordinate system. The distance tool measures
straight segments drawn on the image and sums them for a route. There is no
Earth-radius calculation, spherical distance, latitude correction, or geographic
projection. Zoom, viewport size, source resolution, and tile resolution do not
change a route's measured distance.

Choose **Measure distance**, then click or tap points along a route. **Undo**
removes the last point, **Clear** removes the route and exits tracing mode, and **Done measuring** leaves
the result visible while returning to ordinary navigation. Maps remain draggable
and zoomable while measuring. Keyboard users can pan with arrow keys and add the
map center with Enter or Space; Backspace undoes a point and Escape finishes.
The center crosshair appears only with visible keyboard focus in point mode. Each map,
including repeated note embeds, has its own measurement state. Measurements stay
in the current browser page and are not saved to notes or published content.

For a winding river or road, turn on **Trace path** while measuring and drag
with a mouse, pen, or one finger. The total includes the sampled bends rather
than a straight chord between the start and end. Each stroke is one Undo action.
Separate strokes add to the total without inserting a straight connecting
segment. Switch off Trace path to pan or add point segments; zoom buttons remain
available. Zoom in for finer tracing. A cancelled stroke or a view change during
drawing discards the unfinished stroke without changing completed measurements.

To measure a region, draw its outline and return to the start, or choose
**Close shape** to add a straight segment back to the first point. An endpoint
within 10 screen pixels of the start snaps closed after the outline has extended
more than 20 screen pixels away; this avoids closing short open paths by accident.
Small outlines can always be closed explicitly. A closed outline gains a light
fill and an **Area** reading in **square miles**, alongside its perimeter distance.
Point routes and freehand traces use the same calculation. Undo removes an
explicit closing segment (or an entire trace), and Clear removes area results.
Further points start a separate route after a closed outline.

Area uses the polygon's original bends and the calibrated horizontal and vertical
scales, without a projection. Concave outlines and either drawing direction are
supported. Crossed, touching, retraced, or zero-area outlines keep their distance
but report that area is unavailable. Multiple outlines show separate numbered
areas; overlapping outlines are not combined into a union or interpreted as holes.
Maps authored with other units show square units instead of square miles.

The [Obsidian companion plugin](../obsidian/taelgar-map-tools/README.md) uses the
same map viewer, tracing controller, and calibration. It renders existing
`leaflet` blocks locally without rewriting their source.

## Calibration belongs in the map block

Each `leaflet` block owns its distance calibration in the vault. Both the website
and Obsidian read it directly; there is no bundled table of Taelgar map scales.
For example, the Sembara map includes:

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

## Verification of the existing 24-mile hex scale

The existing Taelgar maps use **24 miles between opposite flat sides of a hex**.
Their older `bounds` and `scale` fields are display settings and are not a reliable
distance calibration. Some bounds stretch the image nonuniformly, and some
exports resize or remove the original hex grid.

The map blocks record the audited source dimensions, hashes, and hex pixel
widths. The following table documents the original verification. The gridded
`assets/world-map-regions-new.png` is the reference. In an unobstructed ocean
sample (`x=6000..7000`, `y=1500..4000`), 245 horizontal grid edges spanning
123 hexes fit a hex height of **20.166667 pixels**, with an edge-fit RMS residual
of 0.091 pixels. The ruler uses the underlying `121/6` pixel spacing. Independently
detected edges at source Y=1510.3214 and Y=3990.8793 span 123 hexes; their measured
distance differs from 2,952 miles by less than 0.1 mile.

Other exports were registered to the reference using matching landmarks, a
robust affine fit, and rejection of inconsistent matches. Every fit supported
a uniform source-pixel scale of 1, 1/2, or 2/3 relative to the reference, within
0.06%; no geographic transform is used at runtime. These checks establish the
image calibration, not surveying precision for individual clicks or drawn
features. Median fit residuals are in reference-image pixels:

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

For each segment, the renderer first undoes the display bounds' horizontal and
vertical scaling to recover source-pixel differences. It multiplies those by
`hexMiles / hexPixels` miles per source pixel, takes the planar distance,
and adds it to the route. The old authored `scale` is not applied again.

Publication records original-image SHA-256 hashes; local map preparation and the
Obsidian adapter hash the source bytes before rendering calibrated measurements.
The same block therefore produces the same physical distance on both surfaces.

## Delivery and maintenance

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
