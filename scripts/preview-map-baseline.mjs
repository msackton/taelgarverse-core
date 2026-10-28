// Local-only review harness for the shared viewer while v2 host adapters are
// being implemented. It serves only explicitly registered files on loopback.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {parseArgs} from 'node:util';
import {ROOT} from '../src/config.mjs';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {validateManifest,resolveMapSource,validateMapDefinition} from '../src/map-core.mjs';
import {prepareMaps} from './build-maps.mjs';
import {validateMapLayers,resolvedMapLayers} from '../src/map-layers.mjs';
import sharp from 'sharp';

const {values}=parseArgs({options:{export:{type:'string'},port:{type:'string'},'no-tiles':{type:'boolean',default:false}}});
if(!values.export)throw new Error('Pass --export <file prefix used with the exporter --output>');
const port=Number(values.port??'8878');if(!Number.isInteger(port) || port<1024 || port>65535)throw new Error('Invalid preview port');
const prefix=path.resolve(values.export),directory=path.dirname(prefix),manifestFile=prefix+'.map.json';
const metadata=validateManifest(JSON.parse(await fs.readFile(manifestFile,'utf8')));
delete metadata.regionLayers;
if(metadata.layers?.length)metadata.regionLayers=resolvedMapLayers(await Promise.all(metadata.layers.map(async relative=>({path:relative,data:validateMapLayers(JSON.parse(await fs.readFile(path.join(directory,relative),'utf8')))}))));
const image=path.resolve(directory,metadata.image),input=await fs.readFile(image);
const dimensions=await sharp(input,{limitInputPixels:250_000_000}).metadata();
if(dimensions.format!=='png')throw new Error('Expected a PNG image');
const manifest=resolveMapSource(metadata,dimensions);
const work=path.join(ROOT,'.cache','map-baseline','preview');await fs.mkdir(work,{recursive:true});
const assets=new Map([
  ['/map.png',{filename:image,type:'image/png'}],
  ['/leaflet.css',{filename:path.join(ROOT,'node_modules/leaflet/dist/leaflet.css'),type:'text/css'}],
  ['/maps.css',{filename:path.join(ROOT,'public/maps.css'),type:'text/css'}],
  ['/editor.css',{filename:path.join(ROOT,'obsidian/taelgarverse/maps/editor.css'),type:'text/css'}],
]);
let tile;
if(!values['no-tiles']){
  const entry={id:'map.png',target:'map.png',extension:'.png',filename:image,note:null};
  const note={id:'preview.md',name:'Preview',target:'preview.md',slug:'preview',extension:'.md',note:parseNote('```taelgar-map\nimage: map.png\nbounds: [[0,0],['+manifest.height+','+manifest.width+']]\n```')};
  const store=new ContentStore([entry,note]);
  console.log('Preparing reusable local map tiles…');
  const files=await prepareMaps(store,path.join(ROOT,'.cache/maps'));
  tile=entry.mapTiles?.[0];
  for(const file of files)assets.set('/assets/'+file.target,{filename:file.filename,type:'image/webp'});
}
const w=manifest.width,h=manifest.height,[offsetX,offsetY]=manifest.sourceOffset;
const crop={x:offsetX+Math.floor(w*.28),y:offsetY+Math.floor(h*.29),width:Math.floor(w*.22),height:Math.floor(h*.27)};
const common={version:2,source:path.basename(manifestFile),grid:{visible:false,showCoordinates:true}};
const examples=[
  {name:'Full map',block:{...common,id:'full'}},
  {name:'Regional crop',block:{...common,id:'regional',crop,grid:{visible:true}}},
  {name:'Second crop',block:{...common,id:'second',crop:{x:offsetX+Math.floor(w*.5),y:offsetY+Math.floor(h*.18),width:Math.floor(w*.18),height:Math.floor(h*.21)},grid:{visible:true}}},
];
{
  const width=Math.min(220,w),height=Math.min(100,h);
  examples.push({name:'Subdivision detail',block:{...common,id:'small-hexes',
    crop:{x:offsetX+Math.floor((w-width)/2),y:offsetY+Math.floor((h-height)/2),width,height},grid:{visible:true}}});
}
const configs=examples.map(({name,block})=>({name,block,config:{version:2,...validateMapDefinition(block,manifest),
  image:'/map.png',tile,minZoom:-5,maxZoom:6,defaultZoom:-3,fitBounds:true,height:'720px',width:'100%'}}));
await fs.writeFile(path.join(work,'examples.json'),JSON.stringify(examples,null,2)+'\n');
const viewerClient=`import {mountMap} from './src/browser/map-view.mjs';
const examples=${JSON.stringify(configs)};
const select=document.querySelector('#example'),delivery=document.querySelector('#delivery'),host=document.querySelector('#host');
for(let i=0;i<examples.length;i++){const option=document.createElement('option');option.value=i;option.textContent=examples[i].name;select.append(option);}
let dispose;
function show(){
 dispose?.();const item=examples[Number(select.value)],config=structuredClone(item.config);if(delivery.value==='image')delete config.tile;
 const figure=document.createElement('figure');figure.className='leaflet-map';figure.dataset.map=JSON.stringify(config);
 figure.innerHTML='<div class="map-canvas" hidden role="region" aria-label="Map baseline preview" style="--map-height:720px"></div><figcaption><span class="map-status" role="status"></span><a href="/map.png" target="_blank" rel="noopener">Open full source image</a></figcaption>';
 host.replaceChildren(figure);dispose=mountMap(figure);document.querySelector('#definition').textContent=JSON.stringify(item.block,null,2);
}
select.addEventListener('change',show);delivery.addEventListener('change',show);show();
window.addEventListener('pagehide',()=>dispose?.());`;
const client=viewerClient;
const locatorNote='Crops use Photoshop pixels or hex endpoints. Zoom from 24-mile hexes into four seven-child levels; slash digits identify each child.';
const bundle=await build({absWorkingDir:ROOT,stdin:{contents:client,resolveDir:ROOT},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Taelgar map baseline preview</title>
<link rel="stylesheet" href="/leaflet.css"><link rel="stylesheet" href="/maps.css">
<style>body{margin:0;background:#f4f3ee;color:#26352f;font:15px/1.5 system-ui}main{max-width:1500px;margin:auto;padding:24px}h1{margin:0;font-size:28px}.lead{max-width:1000px}select,button{font:inherit}select{padding:6px;margin-right:20px}figure{margin:16px 0}pre{white-space:pre-wrap;background:white;padding:16px}.note{padding:10px 14px;background:#e9e7df;border-radius:5px}.map-canvas{height:65vh}</style>
<main><h1>Taelgar map baseline</h1><p class="lead">Local development preview · source artwork without baked hexes · 40 pixels / 24 miles per hex · 0.6 miles per pixel.</p>
<p class="note">This source lacks the published map’s geographic labels and retains the source’s full geography. ${locatorNote}</p>
${'<label>Example <select id="example"></select></label><label>Delivery <select id="delivery">'+(tile?'<option value="tiles">Website tiles</option>':'')+'<option value="image">Original image</option></select></label><div id="host"></div><details><summary>Map definition (illustrative regions)</summary><pre id="definition"></pre></details>'}</main><script type="module" src="/preview.js"></script></html>`;
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),asset=assets.get(url.pathname);
    if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405).end();return;}
    let body,type;
    if(url.pathname==='/'){body=html;type='text/html; charset=utf-8';}
    else if(url.pathname==='/preview.js'){body=bundle.outputFiles[0].contents;type='text/javascript';}
    else if(asset){body=await fs.readFile(asset.filename);type=asset.type;}
    else{res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
  }catch(error){console.error(error.message);res.writeHead(500).end('Preview error');}
});
server.listen(port,'127.0.0.1',()=>console.log('Map baseline preview: http://127.0.0.1:'+port+'/'));
