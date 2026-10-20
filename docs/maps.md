# Maps and distance measurement

Maps use Leaflet's flat image coordinate system. The distance tool measures
straight segments drawn on the image and sums them for a route. There is no
Earth-radius calculation, spherical distance, latitude correction, or geographic
projection. Zoom, viewport size, source resolution, and tile resolution do not
change a route's measured distance.

Choose **Measure distance**, then click or tap points along a route. **Undo**
removes the last point, **Clear** removes the route, and **Done measuring** leaves
the result visible while returning to ordinary navigation. Maps remain draggable
and zoomable while measuring. Keyboard users can pan with arrow keys and add the
map center with Enter or Space; Backspace undoes a point and Escape finishes.
The center crosshair appears while the active map has keyboard focus. Each map,
including repeated note embeds, has its own measurement state. Measurements stay
in the current browser page and are not saved to notes or published content.

For a winding river or road, turn on **Trace path** while measuring and drag
with a mouse, pen, or one finger. The total includes the sampled bends rather
than a straight chord between the start and end. Each stroke is one Undo action.
Separate strokes add to the total without inserting a straight connecting
segment. Switch off Trace path to pan or add point segments; zoom buttons remain
available. Zoom in for finer tracing. A cancelled stroke or a view change during
drawing discards the unfinished stroke without changing completed measurements.

The [Obsidian companion plugin](../obsidian/taelgar-map-tools/README.md) uses the
same map viewer, tracing controller, and calibration. It renders existing
`leaflet` blocks locally without rewriting their source.

## The 24-mile hex calibration

The existing Taelgar maps use **24 miles between opposite flat sides of a hex**.
Their older `bounds` and `scale` fields are display settings and are not a reliable
distance calibration. Some bounds stretch the image nonuniformly, and some
exports resize or remove the original hex grid.

[`src/map-calibrations.mjs`](../src/map-calibrations.mjs) records the audited
source images, dimensions, hashes, and relative pixel scales. The gridded
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
`24 × referenceScale / (121/6)` miles per source pixel, takes the planar distance,
and adds it to the route. The old authored `scale` is not applied again.

The source SHA-256 must match a recorded calibration. Publication already records
this hash; local map preparation hashes the known images before rendering them.
A replaced or cropped image at a known path disables measurement until its
calibration is checked and updated. New maps without a recorded hex calibration
use their explicitly authored `scale` and `unit`; if neither is supplied, distances
are labeled **map units**. Invalid scale/unit values disable measurement while
leaving the map and original-image link available.

## Delivery and maintenance

The controller is bundled into the existing map-only browser asset. The Worker
uses source hashes already present in published snapshots, so current content
does not need republishing to enable measurement. Deploy the updated core.
Local previews must restart after core or source-image changes.

When replacing a calibrated image, compare several complete hexes or register
the replacement against the verified reference. Check horizontal and vertical
scale, record the replacement dimensions/hash, and update the calibration and
its documentation together. Do not infer miles per pixel from a compressed
thumbnail, current browser pixels, tile pixels, or the old display bounds.

Regression coverage includes 24-mile cardinal and diagonal distances for every
recorded image under different display bounds, the independent 123-hex span,
changed-image rejection, route totals, multiple maps, keyboard use, controls,
and Node/Worker map rendering. Tracing checks cover curved geometry, disconnected
strokes, coalesced pointer events, whole-stroke Undo, cancellation, and navigation
restoration. Obsidian adapter checks cover local image resolution/hash caching,
component disposal, stale asynchronous work, bundle integrity, and installation
into a disposable fixture. Real-vault activation is a separate step.
