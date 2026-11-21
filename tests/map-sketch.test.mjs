import test from 'node:test';
import assert from 'node:assert/strict';
import {drawingPaths,hitDrawing,drawingsInBox,eraseDrawings,eraserRadius,applySketchCommand} from '../src/map-sketch.mjs';
const line={id:"line",color:"#aa6633",width:3,closed:false,points:[{x:10,y:100},{x:300,y:100}]};
const box={...line,id:"box",closed:true,points:[{x:350,y:80},{x:450,y:80},{x:450,y:180},{x:350,y:180}]};
test("selection hits nearby strokes and filled shapes, and marquee selects crossing lines with endpoints outside",()=>{
 assert.equal(hitDrawing([line],{x:100,y:105},8),"line");assert.equal(hitDrawing([line],{x:100,y:120},8),undefined);
 assert.equal(hitDrawing([line,{...line,id:"top"}],{x:100,y:100},8),"top");assert.equal(hitDrawing([box],{x:400,y:130},2),"box");
 assert.deepEqual(drawingsInBox([line,box],{x:100,y:90,width:10,height:20}),["line"]);
 assert.deepEqual(drawingsInBox([line,box],{x:390,y:120,width:10,height:10}),["box"]);
 assert.deepEqual(drawingsInBox([line,box],{x:500,y:500,width:20,height:20}),[]);
});
test("eraser cuts the swept path, retains stroke identity and untouched ink, and selections ignore erased gaps",()=>{
 const result=eraseDrawings([line,box],[{x:150,y:20,radius:10},{x:150,y:170,radius:10}]);
 assert.equal(result.length,2);assert.equal(result[0].id,"line");assert.equal(result[1],box);
 assert.deepEqual(drawingPaths(result[0]),[[{x:10,y:100},{x:140,y:100}],[{x:160,y:100},{x:300,y:100}]]);
 assert.equal(hitDrawing(result,{x:150,y:100},1),undefined);assert.deepEqual(drawingsInBox(result,{x:147,y:98,width:6,height:4}),[]);
 const again=eraseDrawings(result,[{x:230,y:100,radius:15}]);assert.equal(drawingPaths(again[0]).length,3);
 const erasedFragment=eraseDrawings(again,[{x:250,y:100,radius:90}]);assert.equal(drawingPaths(erasedFragment[0]).length,1,"erased fragments cannot reappear from old segments");
 assert.deepEqual(eraseDrawings([box],[{x:400,y:130,radius:5}]),[],"filled shapes erase as one object");
 assert.deepEqual(line.points,[{x:10,y:100},{x:300,y:100}]);
});
test("brush grows smoothly with speed, stays bounded and cuts a wider gap for faster movement",()=>{
 const slow=eraserRadius(.01),fast=eraserRadius(2);assert.ok(fast>slow);assert.ok(fast<42);
 let radius=10;for(let i=0;i<100;i++)radius=eraserRadius(100,radius);assert.ok(radius<=42);assert.ok(eraserRadius(0,radius)<radius);
 const slowInk=eraseDrawings([line],[{x:150,y:100,radius:slow}])[0],fastInk=eraseDrawings([line],[{x:150,y:100,radius:fast}])[0];
 assert.ok(slowInk.points.at(-1).x>fastInk.points.at(-1).x);
});

test('optimistic commands are immutable and repeated drawing IDs are idempotent',()=>{
 const drawings=[line];assert.equal(applySketchCommand(drawings,{type:'addDrawing',drawing:line}),drawings);
 const withShape=applySketchCommand(drawings,{type:'addDrawing',drawing:box});assert.deepEqual(applySketchCommand(withShape,{type:'removeDrawings',ids:['line']}),[box]);assert.deepEqual(drawings,[line]);
 assert.deepEqual(applySketchCommand(withShape,{type:'clearDrawings'}),[]);
});

test('history restores erased fragments and clears without replacing unrelated drawings',async()=>{
 const {sketchChanges,sketchHistoryCommand,patchDrawings}=await import('../src/map-sketch.mjs');
 const erased=eraseDrawings([line],[{x:150,y:100,radius:10}]),changes=sketchChanges([line],erased),other={...line,id:'other'};
 const undo=sketchHistoryCommand(changes,true),restored=patchDrawings([...erased,other],undo.patches,{strict:true});assert.deepEqual(restored,[line,other]);assert.equal(patchDrawings(restored,undo.patches,{strict:true}),restored);
 assert.deepEqual(patchDrawings(restored,sketchHistoryCommand(changes,false).patches,{strict:true}),[...erased,other]);
 const rounded=erased.map(d=>({...d,points:d.points.map(p=>({...p,x:p.x+1e-10}))}));assert.deepEqual(patchDrawings(rounded,undo.patches,{strict:true}),[line]);
 assert.throws(()=>patchDrawings([{...line,color:'#000000'}],undo.patches,{strict:true}),/changed since/);
 const cleared=sketchHistoryCommand(sketchChanges([line,box],[]),true);assert.deepEqual(patchDrawings([other],cleared.patches,{strict:true}),[line,box,other]);
});
