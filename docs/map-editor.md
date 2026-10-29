# Obsidian map editor

The development plugin opens map authoring in its own Obsidian tab. Choose
**Open map editor** beneath a version 2 map, or put the cursor inside its fence
and run **Taelgarverse: Open current map in editor**. The tab uses the full
exported image, regardless of that note's crop. Opening the same originating map block again
reuses its editor and preserves its current draft. Tabs remember their source and
originating block across workspace restoration; unsaved drawing drafts are temporary.

Embedded maps show towns, navigation, measurement and the optional grid.
Town placement controls appear only in the editor. The editor authors town positions and persistent shared region borders. Polygon masking, dimming, and hide-content controls have been removed.
Old development blocks' `overlays` fields are ignored and can be deleted.

Keep the PNG and its `.map.json` together in the vault. Quote wikilinks:

````markdown
```taelgar-map
version: 2
source: "[[assets/maps/taelgar-core.map.json]]"
```
````

## Per-map crop

Add a rectangular `crop` to an individual map block. Either use Photoshop pixels:

```yaml
crop: {x: 5000, y: 7000, width: 1200, height: 900}
```

Or use two inclusive hex endpoints:

```yaml
crop:
  topLeft: "16.10"
  bottomRight: "17.12.I.24"
```

The same locator rules as the exporter apply: omitted letter/number mean A/01.
Thus `16.10`, `16.10.A`, and `16.10.A.01` identify the same first hex.
Use `16.10.I.24` as the bottom-right endpoint to include the whole block.
Full slash references are supported; both endpoints must use the same depth.
The rectangle encloses the selected cells, including their staggered edges.

The crop clips the image, limits panning, determines **Fit map** and the zoom-out
limit, and excludes town markers outside it. Omit `crop` for the whole image.
X increases rightward and Y downward in the original Photoshop canvas. The
viewer applies `sourceOffset` and intersects the crop with the available PNG;
a disjoint crop is an error. Loading never rewrites the crop or town positions.
Crops are view settings; the full source image remains accessible.

The shared website viewer supports the same crop syntax. No mask polygon or
per-map drawing file is needed. Set `grid: {visible: true}` for the adaptive
block/hex grid; hover or select to read references without printed labels.

## Place towns

In the separate Obsidian map editor, choose **Place town**, search for the
town's existing note, and click its exact position. The picker only includes
Markdown notes whose frontmatter has `typeOf: settlement`; paths distinguish
duplicate names. Add that field to a town note if it is missing from the picker.
Pan and zoom for precision, or choose **Place at map center**. The draft marker
uses the selected Photoshop symbol with a blue dashed outline. **Save town position** writes to the selected town note; **Cancel
placement** leaves it unchanged. Choose the same note again to move its marker.
Finish measurement/sketch mode before placing a point.

The note receives one frontmatter field:

```yaml
mapLocation:
  x: 5724.5
  y: 7665.75
  hex: 17.10.A.13/1066
  importance: local
  symbol: square
```

These are example coordinates, not an established town location. X/Y are exact
Photoshop canvas pixels, without snapping or rounding to a hex center. The hex
is always calculated at depth four, regardless of the displayed zoom. The
controls show three decimal places for readability; saving retains full numeric
precision. The source export's offset is applied automatically. No export path
is stored, so changing export coverage does not move towns.

**Symbol** selects the artwork and shows a preview beside the control. Choices
are `square` (filled square, the default), `open-square`, `diagonal-square`,
`crossed-square`, `dot`, `triangle`, and `gate`. These are visual shapes, with no
implied settlement size or importance. Set `mapLocation.symbol` directly in
frontmatter, or choose an already placed town, change **Symbol**, and save to
update its artwork without moving it. Moving the town retains its symbol.
Missing or unknown values display as the filled square without rewriting the
note; an explicit save records the selected supported value. Cancel discards
symbol changes as well as position changes.

**Importance** controls the first zoom level at which a saved marker appears:

| Importance | First visible view |
| --- | --- |
| World | Overview; visible at every zoom |
| Regional | 24-mile hexes readable |
| Local (default) | First subdivision, about 9-mile hexes readable |
| Detail | Second subdivision, about 3-mile hexes readable |

The thresholds use 18 CSS pixels across the corresponding hex, matching the
adaptive grid even when grid lines are switched off. Once visible, a feature
remains visible at closer zooms. Importance describes map prominence; it is not
inferred from population or settlement type. Missing or unrecognized values
display as Local without changing the note. New saves record the chosen value.
Choose an already placed town, change **Importance**, and save to update only
its prominence without moving it. The outlined draft marker remains visible while
editing regardless of importance; the exported image bounds still apply.

Saved points appear on Obsidian version 2 maps whenever they lie inside the
visible crop. Hover for the note name and coordinates;
click a saved marker to open its note. X/Y are authoritative when loading
markers, even if a manually edited hex field is stale. Website town-marker
publication is not implemented by this local authoring feature.

Saved markers are retained across view changes when their appearance is
unchanged. Only markers within the viewport plus a 15% margin are mounted;
panning or zooming refreshes that set when the gesture ends. This keeps distant
towns from adding hidden elements to the map.

Markers use a transparent crop of the source Photoshop artwork, centered on the
saved position. Saved icons shrink to 6 CSS pixels high at world overview zoom,
grow smoothly with zoom (about 11 pixels at the readable 24-mile scale), and reach
18 pixels at the readable 9-mile scale. They remain 18 pixels at closer zooms.
The transparent 28-pixel click target stays the same size. Active placement
drafts and the symbol picker preview stay 18 pixels high. Importance changes
visibility, not icon shape. Seven native symbol variants and their exact source
rectangles are kept in [map-symbols](../public/images/map-symbols/README.md);
the plugin embeds the PNG bytes and needs no separate icon files in the vault.

Only `mapLocation` is inserted or replaced. Other frontmatter, comments, body
text and line endings remain unchanged. Open editor buffers receive a range
transaction, retaining unsaved prose; closed notes use an atomic vault update.
Conflicting position edits or malformed frontmatter block Save and retain the
draft. Saving never creates a note, modifies the map block, commits or publishes.

## Trace an existing Photoshop layer

In the editor's **Tracing image** controls, choose **Load tracing PNG** and select
an exported PNG from your computer. Transparency is preserved. The reference
appears above the basemap and below saved borders, draft vertices and the grid;
it does not intercept clicks or change map coordinates. Use **Draw region** to
trace its outlines and save the resulting vector regions normally.

The [Photoshop exporter](map-baseline-progress.md#export-one-layer-on-transparency)
can create a tracing PNG directly with `--only-layer /group/layer`.

Export at native resolution with transparency and preserve the canvas extent
when possible. Alignment uses the PNG's top-left position on the original
Photoshop canvas:

- A PNG with the same dimensions as the basemap export automatically starts at
  that export's `sourceOffset`, with scale 1.
- Other PNGs initially assume the full Photoshop canvas, X 0 and Y 0, scale 1.
  The status shows this assumption. A trimmed export requires its original
  top-left X/Y; these cannot be recovered from an ordinary PNG.
- **Align to basemap export** and **Align to canvas origin** set those respective
  offsets and reset scale to 1. You can always override X/Y numerically.
- **Tracing scale** is Photoshop canvas pixels per PNG pixel. Use 2 for an image
  exported at half resolution. X/Y remain original canvas coordinates. Rotation
  and nonuniform scaling are not supported.

**Tracing opacity** adjusts the reference; **Show tracing image** hides/reveals
it. It clips to the available basemap export and follows pan/zoom. Loading it
does not change the map's camera bounds. **Remove tracing image** clears it.

The reference is temporary to the editor tab. Reopening the same tab retains it;
closing or rebuilding the tab discards it. Loading never copies the PNG into the
vault, writes a manifest/map block, or makes it available on published maps.
Only the regions you explicitly save persist. Supported PNGs are at most
256 MiB, 50000 pixels per side and 250 million total pixels.

## Region borders

Choose **Draw region** in the editor, select an existing layer or **New layer**,
and give the layer and region names. Layers can represent realms, regions,
provinces or other subdivisions; these names have no hard-coded political meaning.
Click to add vertices, or use **Add vertex at map center** after keyboard panning.
**Save region** closes and validates the outline. Self-crossings, touching edges,
repeated vertices and zero-area shapes are rejected with the draft retained.

Choose an existing region and **Edit region** to change its name, optional vault
note path, color, width, dashed border or fill opacity. Select a numbered **Vertex**
and click to move it; **Remove vertex** removes it, and **Add vertex** resumes
appending. **Undo vertex** removes the last vertex. **Cancel region** discards the
whole draft. **Delete region** requires **Confirm deletion**. Finish or cancel the
current authoring tool before switching to towns, measurement or sketching.

The first save creates a `.map-layers.json` beside the manifest and adds its
relative filename to the manifest's optional `layers` array. Later saves update
only that layer file. All maps referencing this manifest see the same borders.
To reuse layers across exports, add the same relative layer-file reference to
each manifest (keep the file beside, or below, the manifests). New Photoshop
exports still produce only the original three manifest fields; attach shared
layer references to each new export explicitly.

Embedded maps offer no layer checkboxes by default. Opt in per map with
`toggleableLayers: [realms, regions]`, using the desired layer IDs. The editor
always offers all layer toggles for authoring. Each layer has a collapsible
list of region names. Optional region note paths become native Obsidian links;
the website links only to published notes available in the current context.
Layer `visible: false` sets its initial visibility. Layers not listed in
`toggleableLayers` keep that visibility without a checkbox; checkbox changes are
local to that viewer. Styles use screen-pixel border widths, and crop clipping never adds
an artificial outline along the crop edge. Region geometry uses original
Photoshop coordinates, independent of the PNG extent and individual map crops.

Saves compare the loaded layer-file text inside an atomic vault update. External
changes block Save and preserve the draft. Cancel and choose **Reload region
layers** to load the current files. Other open editor tabs can use the same
control; saved changes refresh embedded maps. If creation succeeds but attaching
the file to the manifest fails, the error identifies the saved file for recovery.
No files are silently overwritten or removed.

The initial format supports simple polygons, with no holes or disconnected
parts; use separate named regions for islands. Shared-edge topology, snapping,
freehand boundary tracing and date-dependent borders are not implemented.
Layer files are publishable map assets, including their names and geometry;
put only public information in files used by published maps. Cropping and hiding
layers are presentation controls, not access controls.

See [region layer format](map-layers.md) for JSON authoring and reuse.

## Local testing

Install with `node scripts/install-obsidian.mjs --vault D:/personal/taelgar`, then
reload Taelgarverse or restart Obsidian. This is a development build; plugin
release and website deployment are separate. Viewer-only browser testing uses
`node scripts/preview-map-baseline.mjs --export .cache/map-baseline/my-export`.
The former `--editor` browser harness is retired; authoring runs in Obsidian.

The 2026-10-27 editor separation passed all 114 map-related JavaScript tests and
the Worker dry-run package check. Browser review covered full-source editor
layout, town placement with an in-memory note, crop clipping, Fit map and pan
limits. The development plugin is installed in `D:\personal\taelgar`; installed
runtime hashes match the build, and settings, enabled plugins and the demo note
are unchanged. After isolating the legacy reference in frozen core fixtures,
all 1,730 default tests and five local integration tests passed with access to
the working vaults blocked; the Worker package check also passed. Live-vault
checks are separately opt-in. No website deployment or content publication was
performed.

## Rivers and roads

Choose **Draw or edit river / road** and select the feature's vault note. The
picker searches all Markdown notes so it also works with existing `waterway`,
`road`, or custom note classifications. A waterway/river note defaults to River;
otherwise choose the appropriate **Path kind**. Opening a note with a saved
`mapPath` loads that path and its importance.

Click points along the feature, or enable **Trace river / road** and drag with a
mouse, pen or finger. Tracing appends to the current endpoint; switch it off to
pan or move individual points. Each drag is one Undo action. The preview updates
once per display frame and retains accepted pointer samples (subpixel jitter is
ignored). A cancelled gesture or zoom during a drag discards only that unfinished
stroke. Zoom buttons remain available between strokes.

Select a **Path vertex** and click to move it, choose **Remove path point**, or
choose **Redraw path** to start over. **Undo path edit** restores the previous
geometry, up to 100 edits. **Save path** saves the geometry file and patches only
`mapPath` in the selected note; **Cancel path** or Escape discards the draft. Deletion requires **Delete
saved path**, then **Confirm path deletion**. Open note buffers and concurrent
edits use the same guarded save workflow as town positions. A failed save keeps
the draft. Other map authoring and measurement tools cannot run concurrently.

The note stays small, regardless of how many points are drawn:

```yaml
mapPath:
  kind: river
  importance: regional
  source: "_maps/paths/example-river.map-path.json"
```

The referenced JSON file contains geometry only:

```json
{
  "version": 1,
  "points": [
    [5681.25, 7601.5],
    [5700, 7640],
    [5750.75, 7660.25]
  ]
}
```

`kind` is `river` or `road`. `source` is an exact **vault-root-relative** filename,
including `.map-path.json`, not a note-relative path or wikilink. New editor saves
create `_maps/paths/<note-name>-<unique-id>.map-path.json`; subsequent saves reuse
that file. Moving the note does not break its root-relative reference. The editor
forks a new geometry file if another note also references the existing file.
The path is reloaded when its geometry file changes.

Points use **original Photoshop canvas pixels**, with X right and Y down,
independent of this map's crop or PNG export offset. Paths need 2–10,000 points;
consecutive duplicates are invalid. A path is an open polyline: crossings and
deliberately drawn loops are allowed, but Save adds no closing edge. Each note
owns one continuous path; use separate feature notes for separate branches.
The editor preserves portions outside the current export, all coordinate
precision, and one point pair per JSON line. It does not simplify the geometry.
See the [note field schema](../schemas/map-path.schema.json) and
[geometry schema](../schemas/map-path-geometry.schema.json).

Existing inline `mapPath.points` still renders and opens in the editor. The next
explicit Save moves the points to a geometry file and replaces them with `source`.
A definition must contain either `points` or `source`, never both. Opening a map
or cancelling a draft does not migrate anything.

Save guards both the note field and geometry file against concurrent edits. If
updating the note fails after changing an existing geometry file, a guarded
rollback restores the previous geometry unless someone has edited it again.
If attaching a newly created file fails, the error gives its recovery filename
and retains the draft. **Delete saved path** removes the note reference and
keeps the geometry file for recovery; unused files are not automatically deleted.

**Path importance** uses exactly the settlement thresholds: World at all zooms,
Regional at the readable 24-mile scale, Local (default) at the 9-mile scale, and
Detail at the 3-mile scale. This works with grid lines hidden too. Drafts stay
visible while editing. Rivers use blue strokes and roads brown strokes; the
strokes retain their screen width during zoom.

Saved paths appear in Obsidian embeds and the editor, clipped to each map crop.
Hover for the note name or click to open it. No layer checkboxes are added.
Transparent PNG references can be used beneath either drawing tool. Path geometry
stays mounted through pan/zoom; only importance groups change visibility on zoom.

Published version 2 maps also draw `mapPath` metadata and link to the feature's
page. They include only notes available in the current date/campaign/POV context;
excluded notes contribute no geometry. Invalid inline metadata is skipped with a render warning. Missing, malformed,
excluded or changed geometry files block publication with the note/source named.
The publisher copies explicitly referenced geometry from `_maps` and embeds its
validated points with note data; it does not create public geometry download URLs.
`.nopublish` boundaries and symlinks cannot be bypassed by a reference. Changes to
geometry invalidate publication even if Git ignores that file. Publishing the
changed vault notes and geometry updates website paths; building or
releasing the plugin alone does not publish them. Legacy map blocks do not
interpret original-canvas path coordinates.

## Regional artwork

Use **Regional artwork** to create new, aligned artwork with more pixels than the
world map. The editor keeps the world image underneath; towns, borders, paths,
grid coordinates, and measurements continue to use original world coordinates.
It does not warp existing independent maps into alignment.

1. Open the editor from the map block that should show the artwork. Choose
   **Select two corners**, then click opposite corners. Escape cancels selection.
   Selection snaps to whole world pixels; use the X/Y/width/height fields to refine
   it precisely. The entire template footprint must lie inside this source export.
2. Set a region name, finished PNG filename, and **Artwork pixels per world
   pixel** (integer 1–32, default 8). A 600 × 400 world-pixel footprint at 8×
   creates a 4800 × 3200 PNG. Exports are limited to 16384 pixels per side and
   64 million pixels total.
3. Choose **Export tracing guide PNG** and **Export regional manifest** with the
   same settings. These download `name-guide.png` and `name.map-detail.json`;
   they do not write vault files or modify the note.
4. Open the guide in Photoshop, keep it as a reference layer, and draw new
   artwork above it. Preserve major geographic anchors. Hide the guide and export
   the full canvas as `name.png`, retaining transparency as desired. Do not trim,
   rotate, rescale, or move the canvas. Keep river/road and settlement overlays
   out of the raster when you want them to remain editable.
5. Put the finished PNG and its manifest together in a publishable vault folder,
   such as `assets/maps/`. Enter the manifest's exact **vault-root-relative** path
   (no wikilink) and choose **Add artwork to this map**. This explicitly saves the
   attachment to the originating note block and previews it immediately.

The block retains its crop, comments, and other fields. A missing `id` is assigned
on the first attachment save. Save checks that the selected block has not changed
and uses open editor buffers or atomic vault updates. A conflict leaves the note
untouched. **Remove artwork from this map** removes only that block's reference;
no PNG or manifest is deleted. Reopen the editor from the current note after
manually changing its block. Old restored source-only editor tabs can export
new templates, but must be reopened from a map block to save attachments.

```yaml
version: 2
source: "[[assets/maps/taelgar-core.map.json]]"
details:
  - assets/maps/aveil.map-detail.json
```

Example `aveil.map-detail.json`, beside `aveil.png`:

```json
{
  "version": 1,
  "name": "Aveil",
  "image": "aveil.png",
  "worldBounds": {"x": 5100, "y": 7200, "width": 600, "height": 400},
  "pixelSize": [4800, 3200],
  "fadeZoom": [0, 2]
}
```

`worldBounds` uses original world Photoshop pixels, regardless of the baseline
export's `sourceOffset`. `pixelSize` is the expected full artwork canvas; X and Y
must have the same scale. `fadeZoom` defaults to `[0, 2]`: no detail at zoom 0,
50% opacity at zoom 1, full opacity at zoom 2. At zoom 0, one world pixel occupies
one screen pixel; each zoom level doubles that scale. Choose levels reachable
within the map's `maxZoom`. These are artwork reveal thresholds, independent of
feature importance tiers.

Both Obsidian and the website load each image near its reveal zoom when its
footprint intersects the viewport, and release its overlay when out of view or
zoomed out. The original world remains visible through transparent artwork and
when a detail image fails to load. Artwork clips to the map crop and stays below
tracing references and vector features. Later `details` entries draw above earlier
ones in overlaps, regardless of download order. **Zoom to region** fits its visible
footprint; **Fit map** returns to the map's crop. These navigation controls do not
add layer toggles. No regional artwork appears unless the block explicitly lists
it; up to 32 manifests can be attached to a map.

This first version uses individual PNG overlays, with the size limits above;
regional artwork does not get its own tile pyramid. Rectangles are unrotated and
share the world coordinate frame. Editing a river or road at regional zoom still
saves fractional world coordinates to its existing geometry file.

### Export regional artwork from a saved Photoshop file

The Python exporter can preserve an editor-generated template manifest while
exporting one saved drawable layer with transparency:

```sh
python scripts/map-export/export_core.py \
  --source /path/to/aveil.psd \
  --only-layer /artwork/detail \
  --regional-template /path/to/aveil.map-detail.json \
  --output /path/to/export/aveil
```

This writes `aveil.png` and `aveil.map-detail.json`, checks that the Photoshop
canvas exactly matches `pixelSize`, and retains the footprint and fade settings.
Use a new output prefix: existing files are never overwritten. Omit hex endpoints
for regional exports. The normal exporter restrictions still apply (RGB 8-bit,
saved drawable pixels, supported blending and no embedded ICC profile). For
multiple layers, supply an explicit `--recipe` instead of `--only-layer`; recipe
composition uses a white background. Photoshop's native transparent full-canvas
PNG export is also supported. See [export setup](map-baseline-progress.md).


The Windows wrapper supports the same regional workflow with a source override:

```powershell
.\scripts\test-map-export.ps1 -Source C:\maps\aveil.psd -OnlyLayer '/artwork/detail' -RegionalTemplate C:\maps\aveil.map-detail.json -Output C:\maps\export\aveil
```

`-RegionalTemplate` implies full canvas; omit hex endpoints and `-Preview`.
Preview the result over the world map in the editor. After replacing a PNG or
editing a regional manifest outside the editor, reopen its map to reload it.
