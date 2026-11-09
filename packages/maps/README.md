# @taelgar/maps

A versioned build of the maintained Leaflet viewer, tool strip and map geometry
used by TaelgarVerse. It contains no vault, server renderer, room access, network
or encounter state. Website and Obsidian note sketches are private and temporary;
room hosts supply their own saved drawings and persistence adapter.

From a pinned core checkout, run `npm ci` then `npm run maps:pack`. Install
`.cache/packages/taelgar-maps-0.2.0.tgz` and retain its integrity-locked dependency.
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

The common strip owns Pan, Sketch, Select, Eraser, Measure, contextual Options,
Layers, zoom/Fit and Fullscreen. To host it in a shared room:

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
