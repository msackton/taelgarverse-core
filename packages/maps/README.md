# @taelgar/maps

A versioned build of the maintained Leaflet viewer, tool strip and map geometry
used by TaelgarVerse. It contains no vault, server renderer, room access, network
or encounter state. Website and Obsidian note sketches are private and temporary;
room hosts supply their own saved drawings and persistence adapter.

From a pinned core checkout, run `npm ci` then `npm run maps:pack`. Install
`.cache/packages/taelgar-maps-0.3.6.tgz` and retain its integrity-locked dependency.
This builds a local archive; it does not publish to npm or GitHub. Bump the package
version when its public API or behavior changes.

```js
import {mountMap} from '@taelgar/maps';
import '@taelgar/maps/styles.css';
figure.dataset.map = JSON.stringify(definition.config);
const dispose = mountMap(figure, {tools: {}}); // private, temporary tools
// Call dispose() before removing the figure.
```

The figure contains `.map-canvas`, a `figcaption` and `.map-status`. Configurations
come from core's map API or resolver. Leaflet 1.9.4 is a peer dependency; only the
viewer requires browser globals. TypeScript declarations ship in the archive.
The default call without `tools` retains the legacy caption controls for existing
hosts, including the Obsidian map editor. `allowSketch: false`, `decorate`,
`openRegionNote`, `baseImagePane` and the existing update hooks remain available.

The common strip owns Pan, Sketch, Select, Eraser, Measure, Sketch Options,
Layers, zoom/Fit and Fullscreen. The right-side Clear icon clears only the active
kind of annotation: local measurements in Measure, sketches in drawing modes.
Measure has a split button for Straight line and Trace, remembering the last
choice in this browser. Straight line keeps two endpoints from each drag; Trace
follows pointer bends and closes only when released within ten screen pixels
of its start. Its readout stays on
the canvas. Tracing past the map edge finishes the stroke at the boundary;
it never slides along the edge or connects across the outside. Lines and shapes share sequential measurement numbers, with each
line’s distance and each shape’s perimeter and area listed separately. Line
numbers sit halfway along their traced path. Eraser and Measure have no Options menu.
It is disabled in Pan; shared sketch clearing keeps its confirmation. An existing source-image link in the caption
moves into the header and returns to the caption when the viewer is disposed. To host it in a shared room:

```js
const dispose = mountMap(figure, {tools: {
  mount: headerElement,
  scope: 'shared',
  editable: canDraw,
  drawings: savedDrawings,
  fullscreenTarget: workspaceElement,
  onCommand: command => saveSketchCommand(command),
  onError: message => showNotice(message),
}});
dispose.updateTools({drawings: nextSavedDrawings, editable: canDraw});
```

The host authenticates, validates, orders and saves commands, and updates the
snapshot before its `onCommand` promise resolves. The controller previews pending
commands locally and reports failures. Hosts handle retry and connection status.
Measurements and selections remain local. `stopTools()` returns to Pan.

`@taelgar/maps/sketch` exports DOM-free drawing/eraser types, hit/box selection,
speed-dependent radius, partial erasing and immutable `applySketchCommand`.
Servers must validate input and permissions before applying commands. Drawings
use fractional source-local pixels; stroke widths use screen pixels.

`@taelgar/maps/coordinates` retains coordinate and measurement helpers. Version 2
geometry uses Photoshop `[x,y]`: subtract the API's `coordinates.sourceOffset`
before `coreToLatLng(point, config.bounds[1][0])`; add it back on reverse
conversion. Legacy maps keep authored Leaflet coordinates. Measurements use
resolved calibration independently of zoom and tile size.

The tool strip inherits the host palette, including website light/dark appearance
and Obsidian theme colors, for text, surfaces, hover, selection and menus.

Undo/Redo and Clear appear together in the header. Measurements use local history;
sketch history emits `patchDrawings` with per-drawing expected/replacement values
and original indices. Shared hosts must validate these values and apply the
whole patch atomically; `patchDrawings(drawings, patches, {strict: true})` checks
for changed geometry. Unrelated drawings are preserved. A failed undo/redo leaves
history in place; rejected edits are not recorded; scene/source changes remount the controller and reset history.
Fullscreen note maps fill the window below the toolbar.

Shared save adapters may return `{changes, undoable?}` with the canonical
`sketchChanges(before, after)` from the accepted command. This keeps history
consistent with server geometry and command ordering. A multi-command adapter
combines only its own changes and marks history unavailable if another edit
changes the same drawing between commands.
