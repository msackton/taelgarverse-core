# @taelgar/maps

A versioned, browser-only build of the same Leaflet viewer and coordinate helpers
used by TaelgarVerse's website and Obsidian plugin. No vault, server renderer,
character manager, or collaboration state is included.

From a pinned taelgarverse-core checkout, run `npm ci` then `npm run maps:pack`.
Install the resulting `.cache/packages/taelgar-maps-0.1.1.tgz` in the consuming app
and retain its integrity-locked dependency. This command only builds a local
archive; it does not publish to npm or GitHub. Package version changes accompany
public API/behavior changes; the archive is built from the maintained sources.

```js
import {mountMap} from '@taelgar/maps';
import {coreToLatLng, routeDistance} from '@taelgar/maps/coordinates';
import '@taelgar/maps/styles.css';

figure.dataset.map = JSON.stringify(definition.config);
const dispose = mountMap(figure, {allowSketch: false, decorate: ({L, map, canvas, config}) => {
  // Install host-owned controls/overlays and return their cleanup function.
  return () => {};
}});
// Call dispose() before removing the figure.
```

The host supplies a `figure.leaflet-map` containing `.map-canvas`, a `figcaption`
and `.map-status`. Configurations come from core's map API or the existing map
resolver. Leaflet 1.9.4 is a peer dependency; browser globals are needed only for
the viewer. The coordinates entry can also be imported without a DOM.

Version 2 stored geometry uses Photoshop `[x,y]` coordinates. Subtract the
API map's `coordinates.sourceOffset` before using `coreToLatLng(point,
config.bounds[1][0])`; add the offset on conversion back. Legacy maps retain their
authored Leaflet coordinates. Measurements use the resolved `config.measurement`
scales, independent of zoom and tile size. The mounting API retains its existing
`decorate`, `openRegionNote`, `baseImagePane` and disposer/update hooks.

`allowSketch: false` hides the viewer's temporary local Sketch tool when a host
provides persistent shared drawing controls. Measurement remains available.
The default is true, preserving website and Obsidian behavior.
The returned disposer has `stopTools()` to finish local measurement before a host
starts drawing, and retains the existing update and cleanup methods.
