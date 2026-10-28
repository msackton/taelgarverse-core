import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_HEX_DEPTH,hexLevel,childHex,parentHex,refineAxial,hexAncestry,hierarchyGrid} from '../src/map-hex-hierarchy.mjs';
import {MAP_GRID,hexCenter,hexVertices,pointToHex,visibleHexes} from '../src/map-core.mjs';
import {parseHexReference,axialToHexReference,hexRangeBounds,outwardPixelBounds} from '../src/map-locators.mjs';
import {readFileSync} from 'node:fs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/map-locators.json',import.meta.url)));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const pairNear=(a,b)=>a.forEach((v,i)=>near(v,b[i]));

test('each level partitions the infinite fine lattice into unique seven-cell families',()=>{
  for(let depth=1;depth<=MAX_HEX_DEPTH;depth++){
    const owned=new Set();
    for(let q=-10;q<=10;q++)for(let r=-10;r<=10;r++)for(let digit=0;digit<7;digit++){
      const cell=childHex([q,r],digit,depth),key=cell.join(',');
      assert.ok(!owned.has(key));owned.add(key);
      assert.deepEqual(parentHex(cell,depth),{axial:[q,r],digit});
    }
    for(let q=-16;q<=16;q++)for(let r=-16;r<=16;r++){
      const parent=parentHex([q,r],depth);
      assert.deepEqual(childHex(parent.axial,parent.digit,depth),[q,r]);
      assert.ok(owned.has([q,r].join(',')),'no gaps in the interior');
    }
  }
});

test('centers, area ratios and clockwise-from-north child numbering are fixed at every depth',()=>{
  for(let depth=1;depth<=MAX_HEX_DEPTH;depth++){
    const fine=hexLevel(depth),coarse=hexLevel(depth-1),grid=hierarchyGrid(MAP_GRID,depth),parentGrid=hierarchyGrid(MAP_GRID,depth-1);
    near((coarse.hexPixels/fine.hexPixels)**2,7);near(fine.hexMiles/fine.hexPixels,.6);
    const parent=[163,108],center=hexCenter(parentGrid,parent,coarse.hexPixels);
    pairNear(hexCenter(grid,childHex(parent,0,depth),fine.hexPixels),center);
    const angles=[],points=[];
    for(let digit=1;digit<=6;digit++){
      const point=hexCenter(grid,childHex(parent,digit,depth),fine.hexPixels);points.push(point);
      const [x,y]=point.map((v,i)=>v-center[i]);near(Math.hypot(x,y),fine.hexPixels);
      angles.push(Math.atan2(x,-y));
    }
    near(points[0][1],Math.min(...points.map(p=>p[1])));
    for(let i=1;i<6;i++)near((angles[i]-angles[i-1]+Math.PI*2)%(Math.PI*2),Math.PI/3);
  }
});

test('slash references preserve leading zeros and all 2401 fourth-level children round-trip',()=>{
  for(const [ref,axial] of fixtures.hierarchyAddresses){
    const parsed=parseHexReference(ref);assert.deepEqual(parsed.axial,axial);
    assert.equal(axialToHexReference(axial,parsed.depth),ref);
  }
  const parent=parseHexReference('16.10.C.07').axial;
  const all=new Set();
  for(let i=0;i<7**4;i++){
    const path=i.toString(7).padStart(4,'0'),axial=refineAxial(parent,path);
    assert.ok(!all.has(axial.join(',')));all.add(axial.join(','));
    assert.deepEqual(hexAncestry(axial,4),{axial:parent,path});
    assert.equal(axialToHexReference(axial,4),'16.10.C.07/'+path);
  }
  assert.equal(parseHexReference(' 16.10.c7/0031 ').canonical,'16.10.C.07/0031');
  assert.notDeepEqual(parseHexReference('16.10.C.07/31').axial,parseHexReference('16.10.C.07/0031').axial);
  assert.equal(parseHexReference('2.4/0').canonical,'02.04.A.01/0');
  for(const path of ['', '7','-1','3.2','3/2','00000',' 3'])assert.throws(()=>parseHexReference('16.10.C.07/'+path));
  assert.throws(()=>parseHexReference('16.10.C.07.12/3'));
  for(const depth of [-1,1.5,5,NaN])assert.throws(()=>hexLevel(depth));
  assert.equal(axialToHexReference(refineAxial([-1,-1],'3251'),4),null);
});

test('point lookup and boundary ties remain stable through crops and nonzero axial anchors',()=>{
  for(let depth=0;depth<=4;depth++)for(const anchor of [[0,0],[10,-6]]){
    const level=hexLevel(depth),coarse={...MAP_GRID,axialOrigin:anchor},grid=hierarchyGrid(coarse,depth);
    const axial=refineAxial([163,108],'3251'.slice(0,depth)),center=hexCenter(grid,axial,level.hexPixels);
    for(const offset of [[0,0],[2348,2740],[5665,7600]]){
      const cropped={...grid,origin:grid.origin.map((v,i)=>v-offset[i])};
      const point=center.map((v,i)=>v-offset[i]);assert.deepEqual(pointToHex(cropped,point,level.hexPixels),axial);
      const neighbor=[axial[0],axial[1]+1],other=hexCenter(cropped,neighbor,level.hexPixels);
      const midpoint=point.map((v,i)=>(v+other[i])/2);
      assert.deepEqual(pointToHex(cropped,midpoint,level.hexPixels),axial,'edge ties choose lexical axial order');
      for(const delta of [-.01,.01]){
        const p=midpoint.map((v,i)=>v+delta*(other[i]-point[i]));
        assert.deepEqual(pointToHex(cropped,p,level.hexPixels),delta<0?axial:neighbor);
      }
    }
    // The central child always shares its parent's source location.
    pairNear(hexCenter(grid,refineAxial([163,108],'0'.repeat(depth)),level.hexPixels),hexCenter(coarse,[163,108]));
  }
});

test('rotated viewport culling covers visible cells without scanning the whole source',()=>{
  for(let depth=0;depth<=4;depth++){
    const level=hexLevel(depth),grid=hierarchyGrid(MAP_GRID,depth),s=level.hexPixels;
    const origin=hexCenter(grid,[160,80],s),rect={x:origin[0]-s*3,y:origin[1]-s*2,width:s*6,height:s*4};
    const cells=[...visibleHexes(grid,rect,s)],found=new Set(cells.map(String));assert.ok(cells.length<150);
    for(let q=150;q<170;q++)for(let r=70;r<90;r++){
      const points=hexVertices(grid,[q,r],s);
      if(points.some(([x,y])=>x>=rect.x && x<=rect.x+rect.width && y>=rect.y && y<=rect.y+rect.height))assert.ok(found.has(String([q,r])));
    }
  }
});

test('a child crossing a parent edge keeps one reference on both sides',()=>{
  const coarse=hexLevel(0),fine=hexLevel(1),grid=hierarchyGrid(MAP_GRID,1),parent=[163,108];
  const child=childHex(parent,3,1),center=hexCenter(grid,child,fine.hexPixels),base=hexCenter(MAP_GRID,parent);
  const vector=center.map((v,i)=>v-base[i]),length=Math.hypot(...vector),owners=[];
  for(const distance of [0,7]){
    const point=center.map((v,i)=>v+vector[i]*distance/length);
    owners.push(pointToHex(MAP_GRID,point,coarse.hexPixels));
    assert.deepEqual(pointToHex(grid,point,fine.hexPixels),child);
    assert.equal(axialToHexReference(pointToHex(grid,point,fine.hexPixels),1),'16.10.C.07/3');
  }
  assert.notDeepEqual(owners[0],owners[1],'logical ownership is independent of coarse geometric lookup');
});

test('slash export rectangles enclose rotated cells and agree with cross-language fixtures',()=>{
  for(const {first,last,pixels} of fixtures.hierarchyCrops){
    const bounds=hexRangeBounds(first,last);assert.deepEqual(outwardPixelBounds(bounds),pixels);
    for(const ref of [first,last]){
      const parsed=parseHexReference(ref),grid=hierarchyGrid(MAP_GRID,parsed.depth);
      for(const [x,y] of hexVertices(grid,parsed.axial,parsed.hexPixels)){
        assert.ok(x>=bounds.x-1e-8 && x<=bounds.x+bounds.width+1e-8 && y>=bounds.y-1e-8 && y<=bounds.y+bounds.height+1e-8);
      }
    }
  }
  assert.throws(()=>hexRangeBounds('16.10.C.07/3','16.10.C.07/32'),/same subdivision depth/);
  assert.throws(()=>hexRangeBounds('16.10.C.07/3','16.10.C.07.12'),/same subdivision depth/);
  assert.throws(()=>hexRangeBounds('16.10.C.07/4','16.10.C.07/1'),/Bottom-right/);
});
