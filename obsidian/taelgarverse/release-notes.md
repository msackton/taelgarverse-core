Taelgarverse 0.9.0

- Add version 2 maps backed by a PNG and a `.map.json` manifest, with shared world coordinates, rectangular or hex-based crops, and an adaptive hex grid with copyable coordinates.
- Add a separate map editor tab. Place towns linked to vault notes, choose marker symbols, and use World, Regional, Local, or Detail importance to control when markers appear as you zoom. Position saves preserve the rest of the note.
- Draw reusable borders for realms, regions, and other subdivisions. Each map must explicitly opt into layer checkboxes with `toggleableLayers`; otherwise layers keep their configured visibility without a toggle.
- Draw and edit persistent rivers and roads using vertices or freehand tracing, with the same importance tiers as towns. Paths live in separate `.map-path.json` files under `_maps/paths`, referenced by the note's `mapPath` metadata. Existing inline paths move to separate files only when explicitly saved in the editor.
- Load a transparent PNG as a temporary tracing reference, with positioning, scale, opacity, and visibility controls. Reference images are not saved to the vault or published.
- Add regional and local artwork that fades in as you zoom. Select a world footprint, export a tracing guide and manifest, and explicitly attach finished artwork to a map through its `details` list. Multiple detail levels can overlap while towns, borders, paths, and measurements retain their world coordinates.
- Improve freehand measurement, sketching, town-marker updates, and grid interaction responsiveness during map navigation.

Requires desktop Obsidian 1.8.0 or newer, unchanged from 0.8.0. Existing legacy map definitions remain supported; notes are not migrated automatically. The new editor requires version 2 maps. Version 2 maps cannot be converted to legacy Leaflet blocks by the old static-site materializer.

Regional artwork currently uses unrotated PNGs, limited to 16384 pixels per side and 64 million pixels per image. Template guides use the original world image; generating a local guide directly from regional artwork is not yet supported. Website code deployment, vault content publication, and this plugin release remain separate.

See the [map editor guide](https://github.com/msackton/taelgarverse-core/blob/463a5433fc7d6bf4e4797076cba4a3cd3e9d7367/docs/map-editor.md) for configuration and the artwork workflow.
