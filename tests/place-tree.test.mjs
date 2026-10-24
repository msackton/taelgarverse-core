
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlaceTree} from '../src/place-tree.mjs';
const node=(id,type='place')=>({id,name:id,path:id,type,alive:true});
const edge=(source,target,kind='contains')=>({source,target,kind});
test('place nesting preserves every layer, primary containment, and current or last-known people',()=>{
 const graph={nodes:['Sembara','Duchy','Town','Inn','Other','Empty'].map(id=>node(id))
  .concat(['Alice','Bob','Unknown','Dead'].map(id=>({...node(id,'person'),alive:id!=='Dead'}))),
  edges:[edge('Duchy','Sembara'),edge('Town','Duchy'),edge('Inn','Town'),edge('Town','Other','secondaryPlace'),
    edge('Alice','Inn','current'),edge('Alice','Other','lastKnown'),edge('Bob','Town','lastKnown'),edge('Dead','Town','current')]};
 const before=JSON.stringify(graph),tree=buildPlaceTree(graph);
 assert.deepEqual(tree.children.get('Sembara'),['Duchy']);
 assert.deepEqual(tree.children.get('Duchy'),['Town']);assert.deepEqual(tree.children.get('Inn'),['Alice']);
 assert.equal(tree.parent.get('Bob'),'Town');assert.equal(tree.parentEdge.get('Bob').kind,'lastKnown');
 assert.equal(tree.parent.get('Empty'),'implicit:material-plane');assert.ok(!tree.nodes.some(n=>['Unknown','Dead'].includes(n.id)));
 assert.ok(tree.edges.some(e=>e.kind==='secondaryPlace'));
 assert.equal(tree.nodes.length,new Set(tree.nodes.map(n=>n.id)).size);
 assert.equal(JSON.stringify(graph),before);
});
test('containment cycles and missing parents cannot hide or endlessly duplicate places',()=>{
 const tree=buildPlaceTree({nodes:['A','B','C','D'].map(id=>node(id)),
  edges:[edge('A','B'),edge('B','C'),edge('C','A'),edge('D','Missing')]});
 assert.equal(tree.warnings.length,1);
 const visited=[],visit=id=>{assert.ok(!visited.includes(id));visited.push(id);for(const child of tree.children.get(id))visit(child);};
 tree.roots.forEach(visit);assert.deepEqual(visited.sort(),['A','B','C','D','implicit:material-plane']);
});
test('secondary containment is a labeled fallback and parent selection is deterministic',()=>{
 const graph={nodes:['A','B','C'].map(id=>node(id)),edges:[edge('A','C','secondaryPlace'),edge('A','B','secondaryPlace')]};
 const a=buildPlaceTree(graph),b=buildPlaceTree({...graph,edges:[...graph.edges].reverse()});
 assert.equal(a.parent.get('A'),'B');assert.deepEqual(a.parent,b.parent);
 assert.equal(a.parentEdge.get('A').kind,'secondaryPlace');
});

test('planes are roots, existing Material Plane is reused, and explicit planar nesting is preserved',()=>{
 const material={...node('Cosmology/Material Plane.md'),name:'the Material Plane',placeType:'plane',subtype:'Prime Realm'};
 const fey={...node('Feywild'),placeType:'plane'};
 const graph={nodes:[material,fey,...['Multiverse','Sembara','Town','Fey Court','Fey Inn'].map(id=>node(id)),node('Alice','person')],
  edges:[edge(material.id,'Multiverse'),edge('Feywild','Multiverse'),edge('Town','Sembara'),edge('Fey Court','Feywild'),
    edge('Fey Inn','Fey Court'),edge('Alice','Fey Inn','current')]};
 const before=JSON.stringify(graph),tree=buildPlaceTree(graph);
 assert.deepEqual(tree.roots.sort(),[material.id,'Feywild'].sort());
 assert.equal(tree.parent.get('Sembara'),material.id);
 assert.equal(tree.parent.get('Town'),'Sembara');
 assert.equal(tree.parent.get('Fey Court'),'Feywild');
 assert.equal(tree.parent.get('Alice'),'Fey Inn');
 assert.equal(tree.nodes.filter(n=>n.synthetic).length,0);
 assert.equal(tree.parentEdge.get('Sembara').implicit,true);
 assert.equal(JSON.stringify(graph),before);
});
test('empty graphs and unlocated people do not acquire invented locations',()=>{
 assert.deepEqual(buildPlaceTree({nodes:[],edges:[]}).roots,[]);
 const tree=buildPlaceTree({nodes:[node('Lost','person')],edges:[]});
 assert.deepEqual(tree.nodes,[]);assert.equal(tree.parent.size,0);
});
