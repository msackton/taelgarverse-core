import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAP_SCALE,MAP_GRID,resolveMapSource,coreToLatLng,latLngToCore,cropBounds,hexCenter,hexVertices,pointToHex,visibleHexes,
  validateManifest,validateMapDefinition,validateCrop} from '../src/map-core.mjs';
import {routeDistance,routeArea} from '../src/map-distance.mjs';
import {cropInset} from '../src/browser/map-baseline.mjs';
import {hexRangeBounds} from '../src/map-locators.mjs';

const manifest={version:2,image:'test.png',sourceOffset:[0,0],width:12000,height:10000};
const testGrid={orientation:'flat',origin:[3700.25,3900.75],axialOrigin:[180,54],addressing:{status:'unverified'}};
const block={version:2,id:'region',source:'test.map.json'};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('hex crop endpoints match exporter bounds, including shorthand and subdivisions',()=>{
  for(const [topLeft,bottomRight] of [['04.04','05.05.I.24'],['04.04.H','04.05.C.08'],['04.04.A.01/0000','04.04.A.01/0000']]){
    const pixels=hexRangeBounds(topLeft,bottomRight);
    const byHex=validateMapDefinition({...block,crop:{topLeft,bottomRight}},manifest);
    const byPixel=validateMapDefinition({...block,crop:pixels},manifest);
    assert.deepEqual(byHex,byPixel);
    const offset=[Math.floor(pixels.x)-5,Math.floor(pixels.y)-5];
    const partial={...manifest,sourceOffset:offset,width:100,height:100};
    const clipped=validateMapDefinition({...block,crop:{topLeft,bottomRight}},partial).crop;
    near(clipped.x+offset[0],pixels.x);near(clipped.y+offset[1],pixels.y);
    assert.ok(clipped.width<=100 && clipped.height<=100);
  }
  const edge=validateMapDefinition({...block,crop:{topLeft:'01.01',bottomRight:'01.01'}},manifest).crop;
  assert.equal(edge.x,0,'first-cell overhang is clipped at the image edge');
  for(const crop of [{topLeft:'bad',bottomRight:'04.04'},{topLeft:'05.05',bottomRight:'04.04'},
    {topLeft:'04.04'}, {topLeft:'04.04',bottomRight:'04.04.A.01/0'},
    {topLeft:'04.04',bottomRight:'05.05',x:0}])assert.throws(()=>validateMapDefinition({...block,crop},manifest));
  assert.throws(()=>validateMapDefinition({...block,crop:{topLeft:'999.999',bottomRight:'999.999'}},manifest),/does not intersect/);
});

test('Photoshop crops and hex addresses stay fixed when an export moves or shrinks',()=>{
  const original={...block,crop:{x:2200,y:3200,width:500,height:400}};
  const before=structuredClone(original);
  for(const sourceOffset of [[2000,3000],[2100,3100]]){
    const source=resolveMapSource({...manifest,sourceOffset},{width:1200,height:1000});
    const config=validateMapDefinition(original,source);
    assert.deepEqual([config.crop.x+sourceOffset[0],config.crop.y+sourceOffset[1]],[2200,3200]);
    assert.deepEqual(pointToHex(config.grid,[2500-sourceOffset[0],3400-sourceOffset[1]]),pointToHex(MAP_GRID,[2500,3400]));
  }
  const smaller=resolveMapSource({...manifest,sourceOffset:[2300,3300]},{width:200,height:200});
  assert.deepEqual(validateMapDefinition(original,smaller).crop,{x:0,y:0,width:200,height:200});
  assert.deepEqual(original,before,'display clipping never rewrites the saved rectangle');
  assert.throws(()=>validateMapDefinition({...block,crop:{x:100,y:100,width:20,height:20}},smaller),/does not intersect/);
});

test('canonical coordinates and measurements do not change for nonzero crops',()=>{
  const options=validateMapDefinition(block,manifest).measurement;
  for(const crop of [{x:0,y:0,width:12000,height:10000},{x:2500,y:3000,width:1000,height:1500},{x:8000,y:1500,width:3000,height:2500}]){
    const p=[crop.x+50,crop.y+50],toPoint=p=>{const [lat,lng]=coreToLatLng(p,10000);return {lat,lng};};
    assert.deepEqual(latLngToCore(coreToLatLng(p,10000),10000),p);
    assert.deepEqual(cropBounds(crop,10000),[[10000-crop.y-crop.height,crop.x],[10000-crop.y,crop.x+crop.width]]);
    near(routeDistance([toPoint(p),toPoint([p[0]+100,p[1]])],options),60);
    near(routeDistance([toPoint(p),toPoint([p[0],p[1]+100])],options),60);
    near(routeDistance([toPoint(p),toPoint([p[0]+30,p[1]+40])],options),30);
    near(routeArea([p,[p[0]+100,p[1]],[p[0]+100,p[1]+100],[p[0],p[1]+100],p].map(toPoint),options),3600);
  }
});

test('regular flat-top hexes have 40-pixel height and 24-mile neighbor distances',()=>{
  const grid=testGrid,center=hexCenter(grid,[180,54]),vertices=hexVertices(grid,[180,54]);
  assert.deepEqual(center,grid.origin);
  near(Math.max(...vertices.map(p=>p[1]))-Math.min(...vertices.map(p=>p[1])),40);
  near(Math.max(...vertices.map(p=>p[0]))-Math.min(...vertices.map(p=>p[0])),80/Math.sqrt(3));
  for(const [q,r] of [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]){
    const point=hexCenter(grid,[180+q,54+r]);near(Math.hypot(point[0]-center[0],point[1]-center[1])*0.6,24);
  }
});

test('lookup round-trips distant positive/negative cells with deterministic edge/vertex ties',()=>{
  const grid=testGrid;
  for(let q=-350;q<=350;q+=17)for(let r=-300;r<300;r+=13){
    assert.deepEqual(pointToHex(grid,hexCenter(grid,[q,r])),[q,r]);
  }
  const a=hexCenter(grid,[180,54]),b=hexCenter(grid,[181,54]);
  assert.deepEqual(pointToHex(grid,[(a[0]+b[0])/2,(a[1]+b[1])/2]),[180,54]);
  const vertex=hexVertices(grid,[180,54])[0];
  assert.deepEqual(pointToHex(grid,vertex),[180,54]);
  assert.deepEqual(pointToHex(grid,[vertex[0]+0.01,vertex[1]]),[181,53]);
});

test('fine geometry is exactly 6 miles with a shared center and scaled nonzero axial origin',()=>{
  const coarse=testGrid,fine={...coarse,axialOrigin:coarse.axialOrigin.map(v=>v*4)};
  const axial=fine.axialOrigin,center=hexCenter(fine,axial,10),vertices=hexVertices(fine,axial,10);
  assert.deepEqual(center,coarse.origin);near(Math.max(...vertices.map(v=>v[1]))-Math.min(...vertices.map(v=>v[1])),10);
  for(const [q,r] of [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]){
    const point=hexCenter(fine,[axial[0]+q,axial[1]+r],10);near(Math.hypot(point[0]-center[0],point[1]-center[1])*.6,6);
  }
  for(let q=-300;q<300;q+=17)for(let r=-250;r<250;r+=19)assert.deepEqual(pointToHex(fine,hexCenter(fine,[q,r],10),10),[q,r]);
  const adjacent=hexCenter(fine,[axial[0]+1,axial[1]],10);
  assert.deepEqual(pointToHex(fine,center.map((v,i)=>(v+adjacent[i])/2),10),axial);
  assert.ok([...visibleHexes(fine,{x:center[0]-20,y:center[1]-20,width:40,height:40},10)].some(v=>String(v)===String(axial)));
});

test('visible-grid generation is bounded by the viewport and retains cell identity',()=>{
  const rect={x:3700,y:3900,width:150,height:150},cells=[...visibleHexes(testGrid,rect)];
  assert.ok(cells.length<100);assert.ok(cells.some(([q,r])=>q===180 && r===54));
  assert.equal(new Set(cells.map(String)).size,cells.length);
  for(const cell of cells)assert.deepEqual(pointToHex(testGrid,hexCenter(testGrid,cell)),cell);
});

test('manifest/frame and calibration errors fail instead of using saved geometry',()=>{
  assert.equal(validateManifest(manifest),manifest);
  for(const mutate of [m=>m.version=1,m=>m.image='https://example.com/map.png',m=>m.image='../map.png',
    m=>m.sourceOffset=[NaN,10],m=>m.sourceOffset=[1e30,0],m=>m.sourceOffset=[-1,0],m=>m.sourceOffset=[.5,0]]){
    const value=structuredClone(manifest);mutate(value);assert.throws(()=>validateManifest(value));
  }
  for(const size of [{width:Infinity,height:10},{width:0,height:10},{width:50000,height:50000}])assert.throws(()=>resolveMapSource(manifest,size),/dimensions/);
  assert.throws(()=>validateMapDefinition({...block,coordinateFrame:'old-frame'},manifest),/Old coordinateFrame/);
  for(const key of ['image','bounds','calibration','unit','scale','lat','long'])assert.throws(()=>validateMapDefinition({...block,[key]:1},manifest),/inherit/);
  assert.throws(()=>validateMapDefinition({...block,grid:{visible:'yes'}},manifest),/boolean/);
  assert.throws(()=>validateMapDefinition({...block,crop:null},manifest),/Crop/);
  assert.equal(validateMapDefinition({...block,overlays:[{old:'mask'}]},manifest).overlays,undefined);
  const first=validateMapDefinition(block,manifest),second=validateMapDefinition(block,manifest);
  first.grid.origin[0]=0;
  assert.equal(second.grid.origin[0],MAP_GRID.origin[0]);
});

test('crop validation rejects accidental exposure or stretching beyond the core',()=>{
  for(const value of [{x:-1,y:0,width:50,height:50},{x:0,y:0,width:0,height:50},
    {x:11000,y:0,width:2000,height:50},{x:0,y:9900,width:50,height:101},{x:0,y:0,width:Infinity,height:50}]){
    assert.throws(()=>validateCrop(value,manifest));
  }
  assert.deepEqual(validateMapDefinition(block,manifest).crop,{x:0,y:0,width:12000,height:10000});
  assert.equal(cropInset({x:25,y:20,width:50,height:60},{x:0,y:0,width:100,height:100}),'inset(20% 25% 20% 25%)');
});

test('recipe defaults are explicit layer decisions; geometry lives in shared code',()=>{
  const recipe=JSON.parse(readFileSync(new URL('../scripts/map-export/taelgar-core.recipe.json',import.meta.url)));
  assert.deepEqual(Object.keys(recipe),['layers']);
  assert.deepEqual(MAP_SCALE,{hexPixels:40,hexMiles:24,milesPerPixel:.6});
  assert.equal(recipe.layers['/hex-grid/hex-grid'],false);assert.equal(recipe.layers['/hex-labels/text-3x3'],false);
  for(const [path,included] of Object.entries(recipe.layers))if(path==='/latitude' || path.startsWith('/latitude/'))assert.equal(included,false,path);
  for(const key of ['/points-of-interest/roads','/points-of-interest/locations','/points-of-interest/volcanos'])assert.equal(recipe.layers[key],false);
  for(const key of ['/rivers/rivers','/forest'])assert.equal(recipe.layers[key],true);
});
