import {mountMap} from './map-view.mjs';

for(const figure of document.querySelectorAll('.leaflet-map[data-map]'))mountMap(figure);
