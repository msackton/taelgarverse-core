import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LOCATOR_SCHEME,BLOCK_WIDTH,BLOCK_HEIGHT,parseBlockLocator,canonicalHexLocator,locatorToAxial,axialToLocator,hexRangeBounds,outwardPixelBounds,pointToBlock,visibleBlocks,blockGridLines} from '../src/map-locators.mjs';
import {MAP_SCALE,hexCenter,hexVertices,pointToHex,validateManifest} from '../src/map-core.mjs';
import {SUBHEX_OFFSETS,subhexParent,subhexNumber,subhexToAxial,axialToSubhexLocator,parseHexReference} from '../src/map-locators.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/map-locators.json',import.meta.url)));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('6-mile references round-trip and assign exactly 16 cells per parent without gaps or duplicates',()=>{
  assert.equal(SUBHEX_OFFSETS.length,16);
  for(const [address,axial] of fixtures.subhexAddresses){
    assert.deepEqual(subhexToAxial(address),axial);assert.equal(axialToSubhexLocator(axial),address);
    assert.equal(parseHexReference(address).hexMiles,6);
  }
  assert.equal(parseHexReference('16.10.c7.2').canonical,'16.10.C.07.02');
  const occupied=new Set();
  for(let q=-5;q<=5;q++)for(let r=-5;r<=5;r++){
    const cells=SUBHEX_OFFSETS.map(offset=>[q*4+offset[0],r*4+offset[1]]);
    cells.forEach((cell,i)=>{
      assert.deepEqual(subhexParent(cell),[q,r]);assert.equal(subhexNumber(cell),i+1);
      assert.ok(!occupied.has(String(cell)));occupied.add(String(cell));
    });
  }
  for(let q=-15;q<=15;q++)for(let r=-15;r<=15;r++)assert.ok(occupied.has(String([q,r])),'every interior fine cell has exactly one owner');
  for(const parent of ['01.01.A.01','01.02.A.01','02.01.A.01','16.10.C.07','30.23.I.24'])for(let n=1;n<=16;n++){
    const ref=parent+'.'+String(n).padStart(2,'0');assert.equal(axialToSubhexLocator(subhexToAxial(ref)),ref);
  }
});

test('a fine cell keeps its reference on either side of a coarse boundary and across crops',()=>{
  const coarse={origin:[16.5,20.5],axialOrigin:[0,0]},fine={...coarse,axialOrigin:[0,0]};
  const axial=subhexToAxial('16.10.C.07.16'),center=hexCenter(fine,axial,10),owners=[];
  for(const dx of [-1,1]){
    const point=[center[0]+dx,center[1]];owners.push(pointToHex(coarse,point));
    assert.equal(axialToSubhexLocator(pointToHex(fine,point,10)),'16.10.C.07.16');
  }
  assert.notDeepEqual(owners[0],owners[1],'the same fine cell straddles the coarse boundary');
  for(const offset of [[0,0],[2348,2740],[5665,7600]]){
    const grid={origin:coarse.origin.map((v,i)=>v-offset[i]),axialOrigin:[0,0]};
    const point=center.map((v,i)=>v-offset[i]);assert.deepEqual(pointToHex(grid,point,10),axial);
    assert.equal(axialToSubhexLocator(pointToHex(grid,point,10)),'16.10.C.07.16');
  }
  for(let q=-20;q<=20;q++)for(let r=-20;r<=20;r++){
    assert.deepEqual(subhexParent([q,r]),pointToHex(coarse,hexCenter(fine,[q,r],10)),'integer ownership matches nearest coarse center');
  }
});

test('fine export ranges use the same 10-pixel geometry and reject mixed sizes',()=>{
  const grid={origin:[16.5,20.5],axialOrigin:[0,0]};
  for(const {first,last,pixels} of fixtures.subhexCrops){
    const rect=hexRangeBounds(first,last);assert.deepEqual(outwardPixelBounds(rect),pixels);
    const [q0,r0]=subhexToAxial(first),[q1,r1]=subhexToAxial(last),m0=r0+Math.ceil(q0/2),m1=r1+Math.ceil(q1/2);
    for(let q=q0;q<=q1;q++)for(let m=m0;m<=m1;m++)for(const [x,y] of hexVertices(grid,[q,m-Math.ceil(q/2)],10)){
      assert.ok(x>=rect.x-1e-8 && x<=rect.x+rect.width+1e-8 && y>=rect.y-1e-8 && y<=rect.y+rect.height+1e-8);
    }
  }
  for(const value of ['16.10.C.07.00','16.10.C.07.17','16.10.C.25.01','16.10.C.07.-1'])assert.throws(()=>parseHexReference(value));
  assert.throws(()=>hexRangeBounds('16.10.C.07','16.10.C.07.12'),/two 24-mile/);
  assert.throws(()=>hexRangeBounds('16.10.C.07.16','16.10.C.07.02'),/Bottom-right/);
});

test('overview blocks keep global names and nominal boundaries across export crops',()=>{
  for(const origin of [[0,0],[-2348,-2740]]){
    const point=[origin[0]+9.5*BLOCK_WIDTH,origin[1]+15.5*BLOCK_HEIGHT],block=pointToBlock(origin,point);
    assert.equal(block.address,'16.10');near(block.x,origin[0]+9*BLOCK_WIDTH);near(block.y,origin[1]+15*BLOCK_HEIGHT);
    const rect={x:point[0]-10,y:point[1]-10,width:20,height:20};
    assert.deepEqual([...visibleBlocks(origin,rect)],[block]);assert.deepEqual(blockGridLines(origin,rect),[]);
  }
  assert.equal(pointToBlock([0,0],[-1,10]),null);
  const rect={x:-10,y:-10,width:2*BLOCK_WIDTH+20,height:2*BLOCK_HEIGHT+20};
  const blocks=[...visibleBlocks([0,0],rect)];assert.equal(blocks.length,9);assert.equal(blocks.at(-1).address,'03.03');
  const lines=blockGridLines([0,0],rect);assert.equal(lines.length,6);assert.equal(new Set(lines.map(JSON.stringify)).size,6);
  assert.deepEqual([...visibleBlocks([0,0],{x:0,y:0,width:0,height:100})],[]);
});

test('numbering matches source section layout, downward columns and odd-column upward stagger',()=>{
  for(const [locator,axial] of fixtures.addresses){assert.deepEqual(locatorToAxial(locator),axial,locator);assert.equal(axialToLocator(axial),locator);}
  assert.deepEqual(locatorToAxial('13.11.d07'),locatorToAxial('13.11.D.07'));
  assert.deepEqual(parseBlockLocator('04.9'),{row:4,column:9});
  const grid={origin:[16.5,20.5],axialOrigin:[0,0]};
  near(hexCenter(grid,locatorToAxial('01.01.A.05'))[1],.5);
  near(hexCenter(grid,locatorToAxial('01.01.A.01'))[1],20.5);
});

test('all 216 cells retain unique addresses across letters and neighboring numbered blocks',()=>{
  const seen=new Set();
  for(const row of [1,2,16,30])for(const column of [1,2,11,23])for(const letter of 'ABCDEFGHI')for(let n=1;n<=24;n++){
    const address=`${String(row).padStart(2,'0')}.${String(column).padStart(2,'0')}.${letter}.${String(n).padStart(2,'0')}`;
    const axial=locatorToAxial(address);assert.ok(!seen.has(String(axial)));seen.add(String(axial));assert.equal(axialToLocator(axial),address);
  }
});

test('inclusive hex crops round global edges once and retain the same hex IDs in every export',()=>{
  near(BLOCK_WIDTH,360*Math.sqrt(3));assert.equal(BLOCK_HEIGHT,480);
  for(const {first,last,pixels} of fixtures.crops){const rect=hexRangeBounds(first,last);assert.deepEqual(outwardPixelBounds(rect),pixels);}
  const axial=locatorToAxial('16.11.A.01'),global={origin:[16.5,20.5],axialOrigin:[0,0]},center=hexCenter(global,axial);
  for(const [x,y] of [[0,0],[4981,1420],[6228,7200]]){
    const local={origin:[16.5-x,20.5-y],axialOrigin:[0,0]},point=[center[0]-x,center[1]-y];
    assert.deepEqual(pointToHex(local,point),axial);assert.equal(axialToLocator(pointToHex(local,point)),'16.11.A.01');
  }
});

test('invalid addresses and reversed bounds fail without guessing',()=>{
  for(const value of ['0.1','1.0','1','1.2.3','-1.2','1.2x'])assert.throws(()=>parseBlockLocator(value));
  for(const value of ['16.11.A.00','16.11.A.25','16.11.J.01','16.11.A.','16.11.01','16.11.A.1.2'])assert.throws(()=>locatorToAxial(value));
  assert.equal(axialToLocator([-1,1]),null);assert.equal(axialToLocator([0,-1]),null);
  for(const [first,last] of [['05.09','04.10'],['04.11','05.10'],['04.04.C','04.04.D'],['04.04.H.05','04.04.H.04']])
    assert.throws(()=>hexRangeBounds(first,last),/Bottom-right/);
});

test('shorthand always means A/01, including at the bottom-right corner',()=>{
  for(const [alias,canonical] of fixtures.aliases){
    assert.equal(canonicalHexLocator(alias),canonical);
    assert.deepEqual(locatorToAxial(alias),locatorToAxial(canonical));
    assert.deepEqual(hexRangeBounds(alias,alias),hexRangeBounds(canonical,canonical));
    assert.deepEqual(hexRangeBounds('02.02',alias),hexRangeBounds('02.02.A.01',canonical));
  }
});

test('export envelopes contain complete cells in both staggered column parities',()=>{
  const grid={origin:[16.5,20.5],axialOrigin:[0,0]};
  for(const [first,last] of [['04.04.H.01','04.04.H.01'],['04.04.H.05','04.04.H.05'],
    ['04.04.H.01','04.04.H.09'],['04.04.H.05','04.04.H.13'],['04.04.H','04.04.I.24']]){
    const rect=hexRangeBounds(first,last),[q0,r0]=locatorToAxial(first),[q1,r1]=locatorToAxial(last);
    const m0=r0+Math.ceil(q0/2),m1=r1+Math.ceil(q1/2);
    for(let q=q0;q<=q1;q++)for(let m=m0;m<=m1;m++)for(const [x,y] of hexVertices(grid,[q,m-Math.ceil(q/2)])){
      assert.ok(x>=rect.x-1e-8 && x<=rect.x+rect.width+1e-8 && y>=rect.y-1e-8 && y<=rect.y+rect.height+1e-8);
    }
    const local=hexRangeBounds(first,last,{origin:[16.5-2000,20.5-1000],axialOrigin:[0,0]});
    near(local.x,rect.x-2000);near(local.y,rect.y-1000);near(local.width,rect.width);near(local.height,rect.height);
  }
});

test('fixed grid geometry is independent of the export manifest',()=>{
  assert.equal(LOCATOR_SCHEME,'taelgar-block-ai24-v1');
  const manifest={version:2,image:'map.png',sourceOffset:[2500,3000]};
  assert.equal(validateManifest(manifest),manifest);
  assert.equal(hexRangeBounds('16.10.C.07.12','16.10.C.07.12').width>0,true);
});
