# Maps and distance measurement

Maps use Leaflet's flat image coordinate system. The distance tool measures
straight segments drawn on the image and sums them for a route. There is no
Earth-radius calculation, spherical distance, latitude correction, or geographic
projection. Zoom, viewport size, source resolution, and tile resolution do not
change a route's measured distance.

The shared website and Obsidian viewer hides Leaflet's default attribution badge.

Website and Obsidian note maps share a compact header with **Pan**, **Sketch**,
**Select**, **Eraser** and **Measure**, plus zoom, Fit map, available Layers and
Fullscreen. **Open source image** is the header’s external-link icon; it opens
the original image in a new tab. The character manager mounts this same strip in its room header.
Options appear only for Sketch and open over the map. Eraser and Measure have
no Options menu. The Obsidian map editor retains its authoring controls and
legacy caption tools.

The split **Measure: Line ▾** button toggles measuring on or off. Its chevron
opens just **Straight line** and **Trace**, with the current choice checked.
Choosing a mode enters Measure immediately. The browser remembers the last
choice across maps and reloads; the first-use default is Straight line. On
narrow screens the button keeps the mode name visible alongside the ruler icon.
The mode menu supports arrow keys, Enter, Escape and Tab.

**Straight line** drags between two endpoints, ignoring intermediate pointer
bends. Release to keep the numbered line and its distance. **Trace** follows
mouse, pen or finger movement. Releasing closes an outline only if its endpoint
is within ten screen pixels of its start (after tracing more than twenty pixels
away). Other traces remain open. Switching modes preserves completed
measurements and their Undo/Redo history.

Lines and shapes share sequential measurement numbers. Each line gets a marker
halfway along its path and its own calibrated distance; shapes list their
individual perimeter and area. Clicking without dragging adds no points.
Results stay inside the map without changing the toolbar height. Clear removes
measurements; Undo and Redo restore lines, traces or clearing. Choose Pan or
press Escape to move the map again. Each map has independent temporary
measurements; they are never saved to notes, published content or shared rooms.

Choose **Sketch** to draw without distance or area readings. Its Options menu
contains Trace path, color, stroke width and Close shape. The header’s Clear icon
clears sketches in Sketch, Select or Eraser mode, with confirmation in shared rooms. Drag to
trace; turn Trace path off to click points or pan. Return to the first point or
choose Close shape to fill an outline. Choose Pan or press Escape to finish an
open point outline. Undo and Redo sit beside Clear and follow the active annotation type. They
restore points, strokes, erasing, deletion and clearing. Shared undo checks the
affected drawings before changing them, so concurrent edits are retained.
Sketch works even when measurement calibration is unavailable. Closed sketches
retain numbered labels in drawing order.

**Select** clicks nearby ink or drags a box across drawings; Shift adds or toggles
selection. Delete selected, Delete or Backspace removes the selection. Empty
space or Escape clears it. **Eraser** removes portions of open strokes while
dragging, retaining disconnected fragments. Its brush grows with pointer speed
from 10 to 42 screen pixels independently of zoom. Filled shapes erase as whole
objects. Selection and brush previews stay local.

Fullscreen fills the window below the toolbar, overriding the embedded map height.
Leaving fullscreen restores the authored dimensions.

Undo/redo history stays in the current browser and resets when the map unloads.
It retains up to 50 changes; sketch history also has a bounded geometry budget.

The **Temporary** label on website and Obsidian maps means sketches disappear
when the map unloads. Clearing sketches does not clear measurements. Shared room
hosts instead supply saved drawings and persist sketch commands; their label is
**Shared**. Room access and persistence belong to the character manager.

Trace samples preserve bends rather than measuring only the chord between the
start and end. Each trace is one Undo action. Separate traces do not gain a
connecting segment. Zoom buttons remain available; zoom in for finer tracing.
A cancelled stroke or a view change discards the unfinished stroke without
changing completed measurements. The live stroke refreshes once per display
frame without rebuilding completed drawings. Releasing the pointer immediately
commits the final result. Crossing the map boundary finishes a trace at its
intersection with the edge. Moving outside or back inside while still pressed
does not draw along the border or add a connecting segment. Start another stroke
to continue drawing.

Nearby automatic closure uses the same outline repair as Sketch's **Close shape**:
accidental crossings, loops, touches and retraced overshoots keep the larger
enclosed region. Valid concave outlines retain their bends. The corrected line,
fill, distance and area use the same outline. Traces without a valid enclosed
area remain distance traces.

Legacy caption controls, including the Obsidian map editor, retain point-based
measurement, an optional Trace path toggle and manual Close shape. Their
near-start snapping trims only small loops (a 6-screen-pixel radius and at most
15% of the perimeter); explicit Close shape applies the more forgiving repair.

Area uses the polygon's original bends and the calibrated horizontal and vertical
scales, without a projection. Concave outlines and either drawing direction are
supported. Legacy closed outlines that still cross, touch, retrace, or enclose
no area keep their distance but report that area is unavailable. Multiple closed
outlines show separate numbered areas; overlapping outlines are not combined
into a union or interpreted as holes.
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
only notes available in the reader's date/campaign context and link to their
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
`.map.json` manifests, `.map-layers.json` region assets, and `.map-detail.json`
regional artwork manifests; ordinary JSON files
are not automatically published.
The source can be a quoted wikilink, an exact vault path, or a path relative to
the note. Missing qualified paths never fall back to a matching basename. The
manifest's PNG path resolves exactly relative to the manifest, and normal folder
publication folder exclusions apply to both files.

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


## Regional detail artwork

Version 2 blocks can opt into separate, higher-resolution artwork with
`details: [assets/maps/aveil.map-detail.json]`. These paths are exact and relative
to the vault root. A version 1 detail manifest records a name, relative PNG path,
world footprint, expected pixel dimensions and optional zoom fade thresholds.
The world raster remains underneath; all geometry and measurements retain their
world coordinates. PNGs load near their reveal zoom and visible footprint, clip
to the block's crop, and render below vector features. There are no automatic
layer checkboxes. Later listed artwork wins overlapping areas.

See [regional artwork](map-editor.md#regional-artwork) for the complete format,
editor guide/template export, Photoshop export command and limits. The website
fully decodes each referenced static PNG during preparation, validates its exact
canvas dimensions and aspect ratio, preserves the original PNG/alpha, and carries
`mapDetail` and `mapImageInfo` through compiled and legacy snapshots. The PNG's
public asset URL is resolved at render time. Referenced invalid or excluded
artwork prevents publication; a runtime image-load failure leaves the world
visible. Regional PNGs currently use lazy image overlays, not tile pyramids.

Deploy code supporting details before publishing notes that use them, and install
or release the plugin separately. Existing blocks without `details` keep their
current behavior; existing snapshots need no migration. New regional manifests,
PNGs, and block attachments require content publication to appear on the website.

## Reusable viewer and map catalogue

The website, Obsidian plugin and `@taelgar/maps` package build from the same
maintained viewer, tool controller and geometry modules. `map-tools.mjs` owns
controls and gestures; DOM-free `map-sketch.mjs` owns selection, partial erasing
and sketch commands. The package adds no room access, network or encounter state.
Hosts mount the common controls with `tools`, supply drawings and an `onCommand`
adapter, and refresh the document with `updateTools`. The `decorate` hook remains
available for host overlays. See the
[package guide](../packages/maps/README.md) for installation, mounting and
Photoshop/Leaflet coordinate conversion. This does not release an Obsidian plugin.

Build a local versioned archive from a pinned core checkout:

```sh
npm ci
npm run maps:pack
```

The archive is `.cache/packages/taelgar-maps-0.3.6.tgz`. CI also builds it and
attaches it as the **taelgar-maps** artifact. A consuming app installs the archive
and locks its integrity; its own build bundles the viewer. `maps:build` produces
the unpacked package. These commands do not publish to a package registry or
change the website. Keep package versions in `packages/maps/package.json` aligned
with changes to its public API or behavior.

`GET /api/maps` lists map views authored directly in published pages and the
current hostname's homepage. Embedded maps are listed at their source page,
without duplicate transclusion entries. Both `taelgar-map` and legacy `leaflet`
blocks are included. The API uses the website's page availability, comment,
campaign/date and Behind the Curtain rules; campaign hosts enforce their normal
locked context. These are public reading preferences, not room memberships.

Parameters:

- `context`, `date`, `campaigns`, `dm`: the existing website context controls.
- `page`: optionally restrict to one source page, resolved like `/api/page`.
- `q` (up to 200 characters): filter map titles, source pages and block IDs before pagination.
- `limit` (1–100, default 50), `offset` (0–10000, default 0): list pagination.
- `id`: return one resolved map, using an identity from the list.
- `revision`: require the currently published content revision; mismatch is 409.

The version 1 list returns `revision`, effective `context`, `total`, pagination,
`maps` summaries and `warnings`. Each summary includes `id`, optional `blockId`,
`title`, source `page`, a full-image `preview` URL, `sourceRevision`, and
`coordinates`. Preview currently uses the original map image, not a thumbnail.
A request with `id` returns `map`, including the same summary and its resolved
`config`. Imagery, tiles, regional artwork, feature links and region links use
absolute URLs on the requested origin. Crops, calibration, grids and geometry
are the same values consumed by the existing viewer.

A map identity combines its source note path and authored block `id`. It survives
prose, block-order and view-setting changes. Give long-lived maps unique block
IDs. Without one, identity uses the normalized block text and changes when the
block changes. Duplicate identities in one visible page are omitted with a
warning. Invalid maps and unsafe comment syntax are isolated with warnings;
unavailable direct map requests return 404.

`sourceRevision` fingerprints the resolved definition, source image hash and
manifest. Saving clients retain both the definition and revision and explicitly
choose when to refresh. The API resolves the current publication; it is not a
historical snapshot or asset-retention service. Renaming a source note changes
its map identities. Existing retention of active plus previous content remains
unchanged.

New publications add an optional, hash-verified `runtime/maps.json` containing
only source bodies with map blocks. Filtering and resolution still happen per
request. Existing compiled format 1/2 and legacy snapshots remain readable:
the first catalogue request scans their existing note shards with bounded
concurrency and reuses the discovered source bodies. Existing article requests
do not perform this scan. No vault republication is required to test the API;
the next ordinary content publication adds the optimized catalogue source part.

For a manual regression pass after the website release, open existing tiled and
legacy maps and check pan/zoom/Fit map, crops, hex coordinates, region toggles,
regional detail imagery, distance/area measurement, Sketch/Undo/Clear, and mobile
navigation. Compare the same map in Obsidian; installed plugin artifacts are
updated only by the separate plugin release workflow. Automated checks include
Node and compiled/legacy Worker catalogue parity, context isolation, package
packing and the existing website/Obsidian map suites.

For existing compiled snapshots without `runtime/maps.json`, first access scans
each prepared note shard once, with at most eight shard reads in flight. A cheap
language check skips full Markdown parsing for ordinary prose. Discovered map
sources are retained per snapshot for later searches and selections. Future
content publications include the dedicated map-source part and skip note reads
entirely; no content republication is required for the fallback fix.
