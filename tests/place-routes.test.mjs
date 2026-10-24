import test from 'node:test';
import assert from 'node:assert/strict';
import {routeConnections} from '../src/place-routes.mjs';
import {buildRelationshipGraph,filterWorldbuilding} from '../src/relationship-graph.mjs';
import {buildPlaceTree} from '../src/place-tree.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
const block='%%^Metadata:map:v1%%\nlocations:\n  - {role: source, feature: Town, locator: {x: , y: }}\n  - {role: outlet, feature: River}\n  - {feature: ""}\n%%^End%%';
test('explicit map features retain roles and source line without requiring coordinates',()=>{
  const routes=routeConnections('---\ntags: [place]\n---\n\n'+block+'\nA prose mention of [[Unrelated]].');
  assert.deepEqual(routes.map(({target,role,line})=>({target,role,line})),[
    {target:'Town',role:'source',line:4},{target:'River',role:'outlet',line:4}]);
});
test('route parser excludes examples and HTML and tolerates unrelated date prose',()=>{
  assert.deepEqual(routeConnections('~~~yaml\n'+block+'\n~~~\n<!--'+block+'-->\n`%%^Metadata:map:v1%% locations: [] %%^End%%`'),[]);
  assert.equal(routeConnections('%%^Date:1730%%Future prose%%^End%%\n'+block).length,2);
  assert.throws(()=>routeConnections('%%^Metadata:map:v1%%\nlocations: [\n%%^End%%'),/Invalid map metadata/);
  assert.throws(()=>routeConnections('%%^Metadata:map:v1%%\nlocations: Town\n%%^End%%'),/must be a list/);
});
test('physical route edges resolve aliases, retain evidence, and never imply containment',()=>{
  const snapshot=headerFixture({baseNotes:{
    'Realm.md':{tags:['place']},
    'Road.md':{tags:['place'],typeOf:'road',whereabouts:'Realm'},
    'River.md':{tags:['place'],typeOf:'waterway',typeOfAlias:'river',whereabouts:'Realm'},
    'Town.md':{tags:['place'],aliases:['Old Town'],whereabouts:'Realm'},
    'Future.md':{tags:['place'],created:'1800-01-01'},
    'Worldbuilding/Draft.md':{tags:['place']},
  }}).runtime;
  const routes=['Old Town','River','Missing','Future','Worldbuilding/Draft.md','Road'].map(target=>({source:'Road.md',target,line:5,excerpt:target,role:'endpoint'}));
  const graph=buildRelationshipGraph(snapshot,{date:'1720-01-01',routes});
  const links=graph.edges.filter(e=>e.kind==='route');
  assert.deepEqual(links.map(e=>e.target).sort(),['River.md','Town.md','Worldbuilding/Draft.md']);
  assert.equal(links[0].evidence[0].line,5);
  assert.deepEqual(graph.nodes.find(n=>n.id==='Road.md').unresolvedRouteEndpoints,[{target:'Missing',role:'endpoint'}]);
  const tree=buildPlaceTree(graph);
  assert.equal(tree.parent.get('Road.md'),'Realm.md');
  assert.equal(tree.parent.get('Town.md'),'Realm.md');
  assert.equal(tree.edges.filter(e=>e.kind==='route').length,3);
  assert.equal(filterWorldbuilding(graph,false).edges.filter(e=>e.kind==='route').length,2);
});
