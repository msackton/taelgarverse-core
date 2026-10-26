# Taelgar map baseline implementation spec

For checkout setup, current status and excluded assets, start with [the portable handoff](../experiments/map-lab/HANDOFF.md). Paths below are relative to the repository root unless otherwise noted. `TAELGAR_VAULT` is the absolute path to a separate vault checkout.

Build a dependable map baseline for the `taelgar-map` renderer: one Photoshop-derived core image, an accurately registered hex overlay, regional crops and presentation masks defined in individual map blocks, and an Obsidian-only visual editor that saves those definitions to the note.

This is an implementation handoff, not a claim that these features already exist. The earlier progressive river and town experiments are reference material only. Implement the shared viewer in `taelgarverse-core`, rather than extending the standalone experiment into a separate product.

## Required outcome

- Export the standard current map artwork from Photoshop with no baked hex grid, hex labels or associated reference-box lines.
- Export the core image at exactly **40 source pixels across a small hex between opposite flat sides** and **0.6 miles per source pixel**. One small hex is therefore 24 miles across.
- Draw the correctly aligned hex grid in Leaflet. The terrain and hexes must zoom and pan together without drifting or changing geographic scale.
- Add a **Hex grid** checkbox. When enabled, users can identify and copy the hex coordinates of a location.
- Allow each map block to reference the same core export and define a rectangular crop plus ordered white, grey or translucent masks. A mask can affect the inside or outside of its path.
- Add an Obsidian drawer for drawing and editing crops and masks, previewing the result, and explicitly saving the selected map block.
- Render identical crop, mask, grid and measurement semantics on the website and in Obsidian. Editing is available only in Obsidian.

The full map, regional maps and player-facing presentations use one core image and small per-map definitions. Website tile pyramids are generated delivery assets, not independently authored regional images.

## Scope boundaries

Keep existing roads, rivers, towns, symbols and any geographic labels that belong to the standard source artwork baked into this baseline export. Defer separate editable feature layers, automatic river/road tracing, generated regional detail, town plans and zoom-dependent content visibility. This phase does not require any of those systems.

Masks are presentation effects. A player-facing crop can conceal content in the displayed map, but a browser receiving the shared core image or its tiles can retrieve the underlying artwork. This phase does not provide confidential redaction. Keep that distinction explicit in the documentation; do not advertise opaque overlays as access control.

## Existing implementation and source material

Repository: `<repository root>`. Vault: `$TAELGAR_VAULT`.

| File or directory | Current responsibility |
| --- | --- |
| `src/maps.mjs` | Parses YAML map fences, resolves the image, prepares viewer configuration and discovers map images |
| `src/browser/map-view.mjs` | Shared Leaflet image/tile viewer and lifecycle |
| `src/map-distance.mjs` | Calibrated planar distances and areas |
| `src/browser/map-measurement.mjs` | Existing measurement and temporary sketch interactions |
| `obsidian/taelgarverse/features/maps.mjs` | Obsidian image resolution, hash checks and map rendering |
| `scripts/build-maps.mjs` | Website image tile generation |
| `docs/maps.md` | Map syntax, calibration, tools and delivery behavior |

Read repository `AGENTS.md` and `docs/architecture.md` before implementation. Preserve existing map behavior and unrelated work. This handoff authorizes development, not production deployment, publication or remote pushes; follow repository permission rules.

Source PSB: `experiments/map-lab/aveil/source/taelgar-basemap.psb`, originally Dropbox `/MapV3/base/taelgar-basemap.psb`, file ID `id:I0L7keDVKGYAAAAAAA_icw`. It is a 14400 by 14400 RGB Photoshop large document. Existing published main image: `$TAELGAR_VAULT/assets/taelgar-world-map.png`, 11329 by 9419.

Useful prior work:

- `experiments/map-lab/aveil/exports/layers.json`: source layer inventory.
- `experiments/map-lab/aveil/exports/registration.json`: fitted published-world-to-PSB affine transform.
- `experiments/map-lab/aveil/export_clean_terrain.py`: extraction mechanics, but its layer selection is deliberately too sparse for this task because it removes roads, rivers and towns.
- `$TAELGAR_VAULT/assets/world-map-regions-new.png`: reference with visible hexes.

The Photoshop inventory includes `hex-grid` and `hex-labels`, with `3x3-boxes`, `outer-grid-labels-FLAT` and `text-3x3` among their children. Treat the whole grid/reference-label system as excluded artwork. Latitude is a separate layer group and is not automatically excluded merely because hexes are excluded.

## Core image export

Provide a Python CLI and a versioned export recipe. The CLI accepts a local PSB path, recipe path and output directory; credentials and Dropbox access are not part of the exporter.

The recipe must explicitly select the standard map layer visibility, document extent, background, color handling and normalization transform. Record layers by unambiguous hierarchy/path and validate that required layers exist. Preserve Photoshop stacking order, opacity, clipping, masks and blend behavior where applicable. Do not substitute the cached flattened PSB composite, which can contain excluded grids. Unsupported rendering features must produce an actionable error rather than silently disappear.

Start from the established current-map composition, including applicable coastline/ripples, terrain, rivers/lakes, roads, locations and volcano symbols. Preserve the current-map treatment of latitude and geographic text. Compare against the published main map and record any source mismatch; do not invent missing labels or assume every visible PSB layer belongs to the current composition.

Export these artifacts:

1. `taelgar-core.png`: lossless core image, standard artwork, no baked grid or grid coordinates.
2. `taelgar-core.map.json`: shared image and spatial metadata consumed by every new map block.
3. An export provenance report: input fingerprint, recipe and tool versions, included/excluded layer paths, coordinate transforms and grid-registration evidence.

Pin dependencies and rendering settings. The same source and recipe under the supported pinned environment must produce the same pixels, dimensions, grid registration and stable manifest fields. Keep timestamps and run-specific logs out of content fingerprints. Never modify the PSB. Write outputs atomically and report failures before replacing a valid export.

### Authoritative scale

The user-defined scale is authoritative: **0.6 miles per core-image pixel**. Conflicting prior documentation, calibration code or metadata is wrong and must be corrected. Earlier measurements recorded in `docs/maps.md` are not a requirement, compatibility target or reason to introduce a competing scale.

Use the original Photoshop source to establish the correct grid origin and alignment. Do not rescale the artwork merely to accommodate an earlier documentation claim. The export must satisfy the specified pixel scale and hex dimensions together. If the source recipe does not produce that result, identify and fix the incorrect export or registration assumption. Any actual normalization must be justified by the authoritative coordinate contract and applied uniformly to artwork and anchors.

Use a single affine resampling operation from the source composition into the normalized frame where practical. Choose integer output dimensions by padding or clipping the outer boundary as documented. Do not independently stretch each axis to rounded output dimensions. Both axes must retain exactly the same scale.

For the initial core extent, preserve the geographic coverage of the current main world map. Determine its corresponding source rectangle/transform from the reference registration. Store the resulting dimensions and transform; do not hardcode the old dimensions after normalization. Existing experimental coordinates must pass through the documented old-to-new transform before reuse.

Distinguish mathematical calibration from source-registration accuracy. The new grid is exactly 40 pixels across, while a fitted correspondence to historical artwork has measurable residual error. Record that error separately.

## Shared coordinate and metadata contract

All persisted geometry uses **normalized core-image coordinates**: `[x, y]`, origin at the image's top-left outer corner, X right, Y down. Fractional coordinates are allowed. A rectangle uses `{x, y, width, height}`. Coordinates are never screen pixels, tile pixels, crop-relative positions or latitude/longitude.

Use Leaflet `CRS.Simple`. For image height `H`, the conversion is:

```text
source point [x, y] -> Leaflet [H - y, x]
full image bounds  -> [[0, 0], [H, W]]
crop bounds        -> [[H - (y + height), x], [H - y, x + width]]
distance in miles  -> 0.6 * hypot(deltaX, deltaY)
area in square miles -> source pixel area * 0.36
```

Keep one canonical coordinate frame even when rendering a crop. Cropping must never stretch or relocate the core image.

The versioned core manifest must contain:

- Stable map ID and coordinate-frame version.
- Image path relative to the manifest, full decoded dimensions and SHA-256.
- Coordinate conventions and exact `hexPixels: 40`, `hexMiles: 24`, `milesPerPixel: 0.6`.
- Hex orientation, verified origin in core pixels, axial coordinate assigned to that origin, and the verified human-readable addressing rules.
- Source-document and historical-image transforms, source/recipe fingerprints and relevant versions, or a reference to the provenance report.

Each version 2 block also records the manifest coordinate-frame ID in `coordinateFrame`; the drawer copies this from the manifest on creation and preserves it on ordinary edits. Compare it against the resolved manifest before using stored geometry. This detects a changed frame even if the manifest path is unchanged.

Calibration is authoritative in this shared manifest. Per-map crops must not duplicate or override it. Cross-check the redundant scale values and fail validation if they disagree. The image and manifest are resolved through the application's normal asset system on both platforms; browser code must not depend on workspace paths.

An image hash or coordinate-frame mismatch must not silently render potentially misplaced masks or grid lines. Show an actionable configuration error and retain authored data. There is no automatic per-note geometry migration after a changed coordinate frame. Artwork-only replacements may retain the frame when the export recipe guarantees that registration is unchanged.

## Hex geometry and addressing

Use regular flat-topped hexagons. In this convention, 40 pixels is the vertical distance between the top and bottom flat sides, not the width between left and right vertices.

For side length `s = 40 / sqrt(3)`, a center at `[cx, cy]` has six vertices at angles `0, 60, 120, 180, 240, 300` degrees and radius `s`. Its vertex-to-vertex horizontal width is about 46.188 pixels. Do not draw a 40 by 40 bounding-box hex.

One consistent axial convention in the Y-down source frame is:

```text
x = originX + 1.5 * s * q
y = originY + 40 * (r + q / 2)
```

Here `q` and `r` are offsets from the origin's assigned axial coordinate. Use the inverse transform and cube-coordinate rounding for pixel-to-hex lookup. Define deterministic shared-edge and vertex tie-breaking. Rendering and lookup must use the same geometry implementation.

Recover the original grid phase and stagger from the source, not from the image corner or a selected crop. Store an explicitly identified hex center as the origin. The same location must have the same hex ID in the full map and every regional crop.

Existing vault locators include `13.11.D07` and variants with an additional separator before the numeric suffix. Inspect the original grid labeling and establish the larger-cell/subdivision/hex numbering rules. Do not guess the significance of those components. Preserve verified existing addresses and document accepted formatting aliases. Canonical axial coordinates are useful internally, but arbitrary axial IDs must not be presented as verified historical locators. If historical addressing cannot be recovered, report that specific gap; the grid geometry can still be implemented, but legacy-address compatibility is not complete.

### Viewer interaction and zoom

- Provide a labelled **Hex grid** checkbox on each map. The block sets its initial state; user toggles are local to that map instance and do not write to a note.
- When on, draw all visible small hexes with their geographic size fixed at 40 source pixels. A one-level increase in Leaflet zoom doubles their on-screen size. Do not recreate the grid at a new world scale to keep hexes a constant screen size.
- Grid stroke width stays approximately constant in CSS pixels. Coordinate readout text also stays readable in screen units.
- Cull drawing to the visible viewport intersected with the crop, with a small margin. Prefer a batched canvas/SVG layer; do not allocate the entire world's hexagons as separate interactive DOM elements. Draw shared edges once or otherwise avoid doubled opacity.
- Do not automatically replace small hexes with larger cells or hide the grid at certain zooms in this phase. Ordinary viewport culling is permitted.
- While on, pointer hover shows the hovered hex and its locator; clicking/tapping pins the selection and exposes **Copy hex coordinates**. Provide a keyboard alternative using the map-center crosshair. Show verified legacy locator and optionally axial coordinates; identify any development-only axial fallback explicitly.
- Grid lookup must yield to active measurement, sketching and crop/mask drawing, so one gesture does not edit a shape and select a hex simultaneously.
- Turning the grid off removes its lines, selection highlight and coordinate readout. Repeated map embeds maintain independent state.

## Map block schema

Add an explicit version 2 schema to `taelgar-map` while retaining existing block syntax support. New blocks resolve a core manifest using `source`; old blocks continue to be parsed through their `image`, `bounds` and `calibration` fields. Syntax compatibility does not require retaining erroneous calibration. Reject ambiguous mixtures rather than silently choosing one calibration.

The following is a proposed concrete block contract. Coordinates are illustrative, not a canonical regional boundary. A missing `crop` means the full core image; a missing `overlays` means no masks.

````markdown
```taelgar-map
version: 2
id: sembara-region
source: "[[assets/maps/taelgar-core.map.json]]"
coordinateFrame: taelgar-core-v1
height: 650px
width: 100%
minZoom: -4
maxZoom: 3
fitBounds: true
crop:
  x: 3200
  y: 2700
  width: 1400
  height: 1500
grid:
  visible: false
  showCoordinates: true
overlays:
  - id: region-focus
    side: outside
    style: dim
    opacity: 0.65
    geometry:
      type: Polygon
      coordinates:
        - [[3300, 2800], [4400, 2850], [4500, 3900], [3500, 4050], [3300, 2800]]
  - id: white-cover
    side: inside
    style: white
    geometry:
      type: Polygon
      coordinates:
        - [[4100, 3000], [4300, 3000], [4300, 3200], [4100, 3200], [4100, 3000]]
  - id: grey-cover
    side: inside
    style: grey
    geometry:
      type: Polygon
      coordinates:
        - [[3400, 3700], [3550, 3700], [3550, 3850], [3400, 3850], [3400, 3700]]
```
````

`Polygon` uses GeoJSON-shaped ring arrays, but coordinates are core-image pixels, not geographic coordinates. The first ring is the exterior; additional rings are holes. Rings are closed by repeating the first coordinate. Support valid concave polygons. Rectangular masks are stored as polygon rings. MultiPolygon, Bezier editing and feathered edges can be deferred.

Use a JSON-compatible data model and publish a machine-readable schema, even though map fences are written as YAML. Stable block and overlay IDs let the editor target the right definitions. `grid.visible` defaults to false and `showCoordinates` defaults to true; coordinate UI is visible only when the grid is on. Full-map fit and crop fit use the same `fitBounds` behavior.

## Crop and mask rendering

### Rectangular crop

The crop is a view window into the full image, not a new image or a replacement for the image's bounds. Fit the crop by default and keep the original aspect ratio. Restrict navigation to its useful extent. Letterboxing is acceptable when viewport and crop aspect ratios differ.

Do not rely on `maxBounds` alone to hide imagery outside a crop: zooming out and viewport overscroll can expose it. Hard-clip the imagery and map overlays to the crop, including during zoom animation and resize. Any viewport area outside it must show a neutral background. Measurements and hex selections must not start outside the crop. The drawer may intentionally reveal the core image outside the crop while editing, but that mode is not the saved presentation.

### Mask semantics

| Style | Rendering |
| --- | --- |
| `white` | Opaque `#ffffff`, alpha 1 |
| `grey` | Opaque `#808080`, alpha 1 |
| `dim` | White overlay with authored opacity from 0 to 1, default 0.65; artwork remains visible but faded |

The fixed colors are baseline defaults, not references to external stylesheets. For `white` and `grey`, reject non-opaque opacity values. Dimming means uniform transparency within the affected area; it does not imply a feathered edge or zoom-dependent fading.

`side: inside` affects the polygon interior, excluding holes. `side: outside` affects the crop minus that polygon interior. The focus path itself is stored once; derive its complement at render time. Clip all effects to the crop. Changing the crop must recompute an outside mask correctly.

Apply masks in array order using normal alpha compositing; later masks are drawn over earlier ones. Overlapping dim masks accumulate according to that rule. Multiple outside masks are separate effects, not an implicit union of focus regions. Make order editable and keep preview/save behavior identical.

Use this visual order: image or tiles, hex grid, ordered masks, transient selection/measurement/editor UI. Thus solid covers also cover grid lines, and dim regions dim the grid with the artwork. Suppress hover/tap hex selection in opaque covered areas; permit it in dim areas. Normal measurement remains available as an explicit user tool. Mask fills must not accidentally intercept navigation gestures.

### Validation

Reject nonfinite coordinates, nonpositive crop dimensions, crops outside the core extent, unknown styles/sides, duplicate IDs, invalid opacity and invalid polygon topology. Rings need at least three distinct vertices and positive area; holes must lie within the exterior and not overlap each other. Geometry may extend beyond a crop, since crops can be resized, but must remain within the core extent. Validate limits on geometry size and vertex counts. A malformed mask must not silently vanish and expose what the author expected it to cover; show a configuration error for that map.

## Obsidian visual editing drawer

Expose **Edit map** on rendered version 2 maps and a command targeting the current `taelgar-map` block. The website has no editing controls. Opening the drawer creates a draft; rendering a map or toggling its grid never changes the note.

The drawer must provide:

- A full-core editing canvas, current crop outline, and a presentation preview using the same renderer as the saved map.
- Draw, move and resize a rectangular crop, plus numeric X/Y/width/height fields and **Use full map**.
- Draw rectangular or polygon masks; move shapes; add, move and remove polygon vertices; support existing holes without losing them when saving.
- Inside/outside selection; white/grey/dim styles; dim opacity control; mask visibility for editing; reorder, duplicate and delete actions.
- Undo/redo for draft edits, **Save**, **Cancel**, and an unsaved-change guard when closing.
- Explicit navigation and drawing modes. Panning/zooming must not move authored geometry; points are converted to core coordinates as drawn.

For polygons, provide click-to-place vertices and explicit closure. Reuse appropriate existing sketch primitives, but keep persistent map edits separate from temporary viewer sketches and measurements. Detect invalid shapes before Save and explain how to correct them. Saving must not silently repair a deliberately authored shape into a different region.

### Saving to the correct note block

Use the originating note path, block identity and an observed block-content guard. Do not identify the destination by a global text replacement or a stale line number alone. Assign a stable map-block ID on the first explicit save if necessary; never add IDs as a rendering side effect. Distinguish multiple maps in one note and repeated/transcluded instances of the same source note.

Write only the selected block's editable fields and required version/identity metadata. Preserve unrelated YAML keys, comments where supported, surrounding Markdown, other fences and line endings. Prefer YAML document/AST updates over rebuilding the whole note. Keep image/source identity and global calibration outside ordinary crop-edit controls.

Respect unsaved edits in an open Obsidian editor: use an editor transaction against current content, or an atomic vault operation when no active editor buffer owns the content. Re-resolve the target immediately before saving. If the selected block changed externally, preserve the draft and offer reload/reconciliation instead of overwriting the change. Saving refreshes affected embeds; Cancel leaves the note byte-for-byte unchanged.

## Website delivery and backward compatibility

Resolve and validate the core manifest in shared preparation code and the Obsidian adapter. Register the manifest's image dependency with publication, image hashing and tile preparation. Do not assume the current image-only asset resolver can already load JSON manifests. Resolve the manifest relative to the note and its image relative to the manifest, without executing arbitrary content or accepting arbitrary network fetches.

Generate one website tile pyramid per core image/coordinate frame and tile recipe. All map blocks reuse it regardless of crop, mask or grid visibility. Do not build separate tile sets for regional masks. Obsidian continues to use the local original image. Both paths use the full image dimensions and the same point transform; tile padding must not offset the grid or masks.

Preserve stale-image detection and unrelated legacy syntax support, but do not preserve incorrect calibration as a compatibility requirement. Correct conflicting core-map calibration code, metadata and documentation to the user-defined scale. Regional maps using the core image inherit that same scale without exceptions. Converting existing independently exported regional maps into core-image crops is a deliberate migration, not an opportunity to guess positions or silently rewrite unrelated notes.

New features require the Taelgarverse renderer. The website may accept version 2 in its supported `leaflet` alias, but do not claim that an unrelated Obsidian Leaflet plugin understands the new schema. Preserve existing plugin coexistence rules. Review materialization/export paths so unsupported target renderers do not silently drop crops and masks; report unsupported output rather than showing an unmasked full map.

The current **Open map image** link opens raw artwork. For cropped or masked views, label that behavior clearly as **Open full source image**; it is not a download of the composed presentation. No composed PNG export is required in this phase.

## Acceptance criteria for the implementing agent

These are delivery criteria for implementation, not a request to build the feature during the specification task.

### Export and registration

- Repeated exports with the same inputs and pinned environment reproduce pixels and stable metadata.
- Standard map content remains present; hex lines, coordinate labels and reference-box lines are absent from the PNG.
- The normalization is uniform, the core image and grid share one recorded transform, and registration is checked at widely separated locations rather than one convenient crop.
- Replacing the image with mismatched bytes or frame metadata produces an actionable failure without silently trusting old coordinates.

### Grid and scale

- Every generated hex has 40-pixel flat-to-flat diameter. Neighboring centers are 40 pixels apart and represent 24 miles.
- A 100-source-pixel horizontal or vertical measurement is 60 miles. A 30-by-40-pixel displacement is 30 miles. A 100-by-100-pixel square measures 3600 square miles.
- Those measurements agree in the full map, at least two nonzero-origin crops, tiled website rendering and the Obsidian image rendering, at multiple zoom levels and viewport sizes.
- The same source point retains its hex identity across crops, zoom levels, device pixel ratios and resize. Edges and vertices have stable tie-breaking.
- Grid lines stay attached during animated zoom and pan. Coordinate selection and checkbox behavior work with mouse, touch and keyboard.
- Existing printed locators are matched against multiple documented references across larger reference-box boundaries. Unverified formatting or numbering is not presented as established mapping.

### Crops and masks

- Crops do not stretch imagery or expose outside artwork during pan, zoom-out, animation or resize.
- Concave focus paths, holes, inside/outside behavior, white/grey/dim styles and overlap order produce the same result in the drawer, Obsidian reading view and website.
- Outside masks update correctly after crop changes. Opaque masks cover the grid; dim masks preserve faded geography. Invalid masks fail visibly.
- Multiple regional blocks use the same core asset and tile pyramid; changing one block does not affect another.

### Editor and regression behavior

- Save/reopen preserves geometry in core coordinates. Cancel performs no note write. Undo/redo works for crop and mask operations.
- A note with multiple map fences, duplicate embeds, unrelated YAML keys/comments and concurrent edits does not lose or overwrite unrelated content.
- Saving through an open dirty editor does not discard its unsaved content. Conflicts preserve the map draft.
- Existing image-only syntax, measurements, sketches, plugin coexistence and disposal behavior continue to work; conflicting core-map calibrations are corrected rather than grandfathered in.
- Website rendering contains no editing controls. Document schema examples, limitations and the manual Obsidian workflow alongside focused automated coverage in the existing map test areas.

## Implementation sequence and handoff deliverables

1. Establish the export recipe, normalized coordinate frame, exact scale, grid origin and addressing evidence. Produce the core image, manifest and provenance.
2. Add shared manifest/schema parsing and pure coordinate, hex and mask-geometry functions. Preserve the legacy parser path.
3. Add shared crop rendering, masks, hex toggle/lookup, measurement integration and shared website tile reuse.
4. Add the Obsidian drawer and guarded note persistence on top of the same data model and renderer.
5. Supply local full-map, regional-focus and player-presentation example blocks, plus updated map docs, focused verification results and a short demonstration of editing and reopening a note.

Deliver the Python script and pinned dependencies, recipe, machine-readable schemas, shared rendering implementation, Obsidian editor, examples and documentation. Keep any unresolved source-layer or historical-address issue explicit. Do not expand this phase into editable river/road/town layers or progressive map detail.
