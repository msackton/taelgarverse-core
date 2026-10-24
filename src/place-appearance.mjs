// Small, self-contained SVG symbols for the structural Places browser.
const styles={
  plane:{color:'#ab87cc',paths:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z']},
  road:{color:'#b49a75',paths:['M8 3 5 21M16 3l3 18M12 3v3m0 4v4m0 4v3']},
  river:{color:'#579bdc',paths:['M8 3c10 3-8 7 2 10s-3 5-2 8M14 3c10 3-8 7 2 10s-3 5-2 8']},
  water:{color:'#579bdc',paths:['M3 7q3-4 6 0t6 0 6 0M3 12q3-4 6 0t6 0 6 0M3 17q3-4 6 0t6 0 6 0']},
  settlement:{color:'#d49853',paths:['m2 11 5-5 5 5M4 10v10h6V10m3-2 4-4 5 5M14 8v12h6V8M7 15v5m10-7v3']},
  realm:{color:'#b99b4e',paths:['m3 6 4 5 5-8 5 8 4-5-2 13H5L3 6ZM5 16h14']},
  region:{color:'#4baaa2',paths:['m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16m6-14v16']},
  forest:{color:'#65a477',paths:['m8 3-5 8h3l-4 6h12l-4-6h3L8 3ZM8 17v4m7-16 5 8h-3l5 6h-7m2 0v2']},
  terrain:{color:'#a29280',paths:['m2 20 8-15 5 9 3-5 4 11H2ZM7 11l3 2 3-2']},
  island:{color:'#58a9a1',paths:['M3 18q9-9 18 0M2 21q3-3 6 0t6 0 8 0M13 16V7m-5 1q5-8 10 0m-10 0q5-3 10 0']},
  inn:{color:'#c58c77',paths:['M3 6v15m18-9v9M3 17h18M7 9h4v5H7V9Zm7 1h4a3 3 0 0 1 3 3v4h-7v-7Z']},
  building:{color:'#939faa',paths:['m3 9 9-6 9 6M5 9h14v12H5V9Zm5 6h4v6m-6-9h1m6 0h1']},
  fort:{color:'#a291aa',paths:['M4 21V4h3v4h3V4h4v4h3V4h3v17H4Zm6 0v-6h4v6']},
  sacred:{color:'#c3a05d',paths:['m3 8 9-5 9 5H3Zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18']},
  portal:{color:'#ab87cc',paths:['M12 3c-9 0-9 18 0 18s9-18 0-18ZM12 7c-4 0-4 10 0 10s4-10 0-10']},
  neighborhood:{color:'#b89965',paths:['M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z']},
  infrastructure:{color:'#999381',paths:['M2 10h20M4 6v15m16-15v15M4 15q8-8 16 0M8 10v2m4-2v1m4-1v2']},
  place:{color:'#4baaa2',paths:['M12 21S4 14 4 9a8 8 0 0 1 16 0c0 5-8 12-8 12ZM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z']},
};
function category(value){
  const v=String(value??'').trim().toLowerCase();
  const rules=[
    ['plane',/^plane$/],
    ['road',/\b(road|street|trail|highway|route|passageway)\b/],
    ['river',/\b(river|brook|stream|waterway|canal)\b/],
    ['water',/\b(lake|sea|ocean|bay|gulf|marine feature|watershed|wetlands|marsh|swamp)\b/],
    ['settlement',/\b(settlement|village|city|town|hamlet)\b/],
    ['realm',/\b(realm|duchy|barony|kingdom|monarchy|province|county|shire|march|empire|principality)\b/],
    ['inn',/\b(inn|tavern|caravanserai)\b/],
    ['sacred',/\b(holy site|temple|shrine|monastery|church|sanctuary)\b/],
    ['fort',/\b(fort|castle|keep|garrison|fortress)\b/],
    ['portal',/\b(extraplanar domain|planar link|portal|fey court)\b/],
    ['forest',/\b(forest|woods|woodland|grove|jungle)\b/],
    ['island',/\b(island|archipelago)\b/],
    ['terrain',/\b(topographical feature|mountain|hills?|mountain range|plateau|gorge|valley|desert|grassland|peninsula|subterranean feature|cave)\b/],
    ['neighborhood',/\b(neighborhood|neighbourhood|ward|district)\b/],
    ['infrastructure',/\b(infrastructure|bridge|gate|wall|aqueduct|harbor|harbour|port)\b/],
    ['building',/\b(building|tower|manor|house|orphanage|ruin)\b/],
    ['region',/\b(region|continent|territory)\b/],
  ];
  return rules.find(([,pattern])=>pattern.test(v))?.[0];
}
export function placeAppearance(node){
  const label=String(node.subtype||node.placeType||'Place');
  const kind=category(node.subtype)||category(node.placeType)||'place';
  return {kind,label,...styles[kind]};
}
