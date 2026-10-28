# Obsidian map editor

The development plugin opens map authoring in its own Obsidian tab. Choose
**Open map editor** beneath a version 2 map, or put the cursor inside its fence
and run **Taelgarverse: Open current map in editor**. The tab uses the full
exported image, regardless of that note's crop. Opening the same source again
reuses the editor and preserves its current town draft. Tabs remember their
source across workspace restoration; unsaved town drafts are temporary.

Embedded maps show towns, navigation, measurement and the optional grid.
Town placement controls appear only in the editor. The editor currently authors
town positions; shared border/region layers and their drawing tools are future
work. Polygon masking, dimming, and hide-content controls have been removed.
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
