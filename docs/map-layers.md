# Shared region layer files

A version 2 map manifest may reference up to 20 reusable layer files:

```json
{
  "version": 2,
  "image": "taelgar-core.png",
  "sourceOffset": [5000, 7000],
  "layers": ["borders.map-layers.json"]
}
```

References resolve exactly relative to the manifest. Absolute paths, parent
traversal and URL schemes are rejected. The layer file is independent of exports:

```json
{
  "version": 1,
  "layers": [{
    "id": "realms",
    "name": "Realms",
    "visible": true,
    "regions": [{
      "id": "example",
      "name": "Example realm",
      "note": "Gazetteer/Example Realm.md",
      "points": [[5100, 7100], [5500, 7100], [5300, 7500]],
      "color": "#795548",
      "width": 2,
      "fillOpacity": 0,
      "dashed": false
    }]
  }]
}
```

## Per-map toggles

Embedded maps have **no toggleable layers by default**. A manifest makes layer
geometry available; each map block explicitly opts into viewer checkboxes:

````markdown
```taelgar-map
version: 2
source: "[[assets/maps/taelgar-core.map.json]]"
toggleableLayers: [realms]
```
````

Omit `toggleableLayers` or use `[]` for no checkboxes. This does not change the
layers' initial visibility: an unlisted layer stays at its configured `visible`
value. A listed layer starts at that value and can be toggled by the viewer.
The setting is independent for every map/crop. The separate authoring editor
always exposes all layer toggles, including newly saved layers.

Use a unique layer ID, or a qualified key such as
`assets/maps/borders.map-layers.json#realms` when multiple files use the same ID.
Missing and ambiguous selections produce a map validation error. The qualified
path is the file's vault path, not a path relative to the note or manifest.

## Geometry and delivery

The example coordinates are illustrative. Points are original Photoshop X/Y;
list each vertex once, without repeating the first to close the ring. IDs are
stable and unique within their file (layers) or layer (regions). Names are plain
text. A note is an optional local vault path. Width is 1–8 CSS pixels; fill
opacity is 0–0.5. Defaults are a solid two-pixel brown border, no fill, and visible
layers. Limits are 100 layers/file, 1000 regions/layer, 1000 vertices/region and
20000 vertices/file. Runtime validation checks simple nonzero-area polygons.
See [the schema](../schemas/map-layers.schema.json).

The store discovers only `.map.json` and `.map-layers.json` as map JSON assets;
ordinary JSON is still excluded. Normal publication folder exclusions apply.
Missing or malformed referenced files fail preparation. Validated layer metadata
travels through both regular and compiled snapshots; Worker requests do no file
reads. Packaging checks that layer bytes have not changed after validation.
Borders are rendered as vector artwork over either tiled or original imagery.

Deploy updated website code before publishing manifests with layer references.
Install/release the Obsidian plugin separately. Local implementation and tests do
not publish content or change production. See [editor workflow](map-editor.md#region-borders).
