import '../../public/vendor/material.css';
import '../../public/taelgarverse.css';
import '../../public/preview.css';
import '../../node_modules/leaflet/dist/leaflet.css';
import '../../public/quiet-library.css';
import '../../public/maps.css';
import {mountMap} from '../../src/browser/map-view.mjs';
for(const figure of document.querySelectorAll('.leaflet-map'))mountMap(figure,{tools:{}});
