// Build facade: the maintained implementation is also used by web and Obsidian.
export {MAP_SCALE,MAP_GRID,coreToLatLng,latLngToCore,cropBounds,fullCrop,sourceExtent,inCrop,
  hexCenter,hexVertices,pointToHex,visibleHexes} from '../../src/map-core.mjs';
export {measurementOptions,routeDistance,routeArea,isClosedRoute,formatDistance,formatArea} from '../../src/map-distance.mjs';
