
import test from 'node:test';
import assert from 'node:assert/strict';
import {placeAppearance} from '../src/place-appearance.mjs';
test('place appearance distinguishes structured types and their common aliases',()=>{
 for(const [placeType,subtype,expected] of [
  ['road','road','road'],['waterway','river','river'],['waterway','brook','river'],
  ['settlement','market town','settlement'],['realm','duchy','realm'],
  ['building','temple','sacred'],['building','fort','fort'],['inn','tavern','inn'],
  ['topographical feature','mountain range','terrain'],['forest','','forest'],
  ['lake','','water'],['planar link','fey portal','portal'],['neighborhood','ward','neighborhood'],
  ['infrastructure','bridge','infrastructure'],['island','archipelago','island'],['region','','region']
 ]){
  const result=placeAppearance({placeType,subtype});
  assert.equal(result.kind,expected);assert.ok(result.paths.length);assert.match(result.color,/^#[0-9a-f]{6}$/);
  assert.equal(result.label,subtype||placeType);
 }
});
test('unrecognized display aliases retain the base type and unknown types have a neutral fallback',()=>{
 assert.equal(placeAppearance({placeType:'waterway',subtype:'seasonal meltwater channel'}).kind,'river');
 assert.equal(placeAppearance({subtype:'unclassified site'}).kind,'place');
 assert.equal(placeAppearance({name:'River Road'}).kind,'place');
 assert.equal(placeAppearance({}).label,'Place');
});
