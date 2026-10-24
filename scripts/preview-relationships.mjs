// Offline, self-contained demo using synthetic notes; never opens or changes a vault.
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {ROOT} from '../src/config.mjs';

const notes={
  'Worldbuilding/Draft Traveler.md':{tags:['person'],affiliations:['Draft Circle'],whereabouts:'Brightwater'},
  'Worldbuilding/Draft Circle.md':{tags:['group']},
  'Worldbuilding/Draft Harbor.md':{tags:['place'],whereabouts:'Green Vale'},
  'People/Arin Vale.md':{tags:['person'],affiliations:[{org:'Guild of Lanterns',title:'Cartographer',start:'1710-01-01'}],whereabouts:'The Copper Inn'},
  'People/Mira Fen.md':{tags:['person'],leaderOf:[{place:'Guild of Lanterns',title:'Guildmaster'}],whereabouts:'Brightwater'},
  'People/Tomas Reed.md':{tags:['person'],affiliations:[{org:'Guild of Lanterns',end:'1720-06-01'},{org:'River Council'}],whereabouts:'Stonebridge'},
  'People/Emissary of the Northern Council.md':{tags:['person'],affiliations:['Guild of Lanterns','River Council'],whereabouts:'Hillwatch'},
  'People/Willow of the Wandering Woods.md':{tags:['person'],affiliations:['Guild of Lanterns'],whereabouts:'Brightwater'},
  'People/Beren.md':{tags:['person'],affiliations:['Guild of Lanterns'],whereabouts:'Stonebridge'},
  'People/Lysa Thorn.md':{tags:['person'],affiliations:['River Council'],whereabouts:'Hillwatch'},
  'People/Nerin.md':{tags:['person'],whereabouts:[{type:'away',location:'Stonebridge',start:'1715-01-01',end:'1719-01-01'}]},
  'Groups/Guild of Lanterns.md':{tags:['group'],partOf:'River Council'},
  'Groups/River Council.md':{tags:['group']},
  'Places/The Copper Inn.md':{tags:['place'],typeOf:'inn',whereabouts:'Brightwater'},
  'Places/Brightwater.md':{tags:['place'],typeOf:'settlement',whereabouts:'Southern Duchy'},
  'Places/Stonebridge.md':{tags:['place'],typeOf:'settlement',whereabouts:'Northern Duchy'},
  'Places/Hillwatch.md':{tags:['place'],typeOf:'settlement',whereabouts:'Northern Duchy'},
  'Places/Lantern Road.md':{tags:['place'],typeOf:'road',whereabouts:'Southern Duchy'},
  'Places/Silver River.md':{tags:['place'],typeOf:'waterway',typeOfAlias:'river',whereabouts:'Southern Duchy'},
  'Places/Northern Duchy.md':{tags:['place'],typeOf:'realm',typeOfAlias:'duchy',whereabouts:'Green Vale'},
  'Places/Southern Duchy.md':{tags:['place'],typeOf:'realm',typeOfAlias:'duchy',whereabouts:'Green Vale'},
  'Places/Green Vale.md':{tags:['place'],typeOf:'region'},
};
const mentions=[
  {source:'People/Arin Vale.md',target:'Mira Fen',date:'1710-01-01',line:8,excerpt:'Arin carried the new charts to [[Mira Fen]], who asked him to survey the eastern road.'},
  {source:'People/Mira Fen.md',target:'Tomas Reed',date:'1718-04-20',line:12,excerpt:'[[Tomas Reed]] brought news of the river crossings to Mira.'},
  {source:'People/Tomas Reed.md',target:'Lysa Thorn',line:7,excerpt:'Tomas traveled to Hillwatch with [[Lysa Thorn]].'},
];
const routes=[
  {source:'Places/Lantern Road.md',target:'Brightwater'},
  {source:'Places/Lantern Road.md',target:'Silver River'},
  {source:'Places/Silver River.md',target:'Hillwatch',role:'source'},
  {source:'Places/Silver River.md',target:'Stonebridge',role:'outlet'},
].map(r=>({...r,line:10,excerpt:(r.role??'endpoint')+': '+r.target}));
const coreMeta=JSON.parse(await fs.readFile(path.join(ROOT,'tests/fixtures/header-display-rules.json'),'utf8'));
const code=[
  "import {createHeaderSnapshot} from './src/header-core/index.mjs';",
  "import {buildRelationshipGraph} from './src/relationship-graph.mjs';",
  "import {mountRelationshipExplorer} from './src/browser/relationship-explorer.mjs';",
  'const notes='+JSON.stringify(notes)+';',
  'const snapshot=createHeaderSnapshot({pages:Object.entries(notes).map(([path,metadata])=>({path,metadata})),coreMeta:'+JSON.stringify(coreMeta)+',registry:{campaigns:{}}});',
  'const mentions='+JSON.stringify(mentions)+';',
  'const routes='+JSON.stringify(routes)+';',
  'mountRelationshipExplorer(document.querySelector("#explorer"),{loadData:async(date="1720-01-01")=>({graph:buildRelationshipGraph(snapshot,{date,mentions,routes})}),',
  'openNote:(path,line)=>{const dialog=document.querySelector("dialog");dialog.querySelector("pre").textContent=path+(line===undefined?"":" — line "+(line+1))+"\\n\\n"+mentions.filter(m=>m.source===path).map(m=>m.excerpt).join("\\n\\n");dialog.showModal();}});',
  'document.querySelector("dialog button").onclick=()=>document.querySelector("dialog").close();',
].join('\n');
const bundled=await build({absWorkingDir:ROOT,stdin:{contents:code,resolveDir:ROOT},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent'});
const css=await fs.readFile(path.join(ROOT,'public/relationships.css'),'utf8');
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relationship Explorer — local prototype</title><style>'+
'html,body{height:100%}body{display:flex;flex-direction:column;margin:0;font:14px system-ui;background:#1e2026;color:#dedfe3}button,select,input{border:1px solid #454956;border-radius:6px;background:#30343f;color:#e2e4ed;padding:7px 10px}button{cursor:pointer}input[type=checkbox]{accent-color:#ba9dde}#explorer{flex:1;min-height:0}p.demo{font-size:11px;padding:6px 12px;margin:0;background:#303047;color:#d9c9f8}dialog{background:#262936;color:#e2e4ed;border:1px solid #555;border-radius:12px;max-width:650px}dialog pre{white-space:pre-wrap;font:14px system-ui}'+css+
'</style></head><body><p class="demo">LOCAL PROTOTYPE · Synthetic notes</p><main id="explorer"></main><dialog><pre></pre><button>Close</button></dialog><script>'+
bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>';
const out=path.join(ROOT,'dist/relationship-explorer/index.html');await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,html);
console.log(out);

