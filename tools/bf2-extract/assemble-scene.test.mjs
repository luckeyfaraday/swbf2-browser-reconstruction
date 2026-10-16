import test from 'node:test';
import assert from 'node:assert/strict';
import { Graph,assemble,identity,matrix,multiply } from './assemble-scene.mjs';

const transform = (x,y,z,turned=false) => ({right:{x:turned?0:1,y:0,z:turned?-1:0},up:{x:0,y:1,z:0},forward:{x:turned?1:0,y:0,z:turned?0:1},trans:{x,y,z}});
test('source transform columns preserve parent rotations and translations',()=>{
  const result=multiply(matrix(transform(10,2,3,true)),matrix(transform(0,1,4)));
  assert.deepEqual(result.slice(12,15),[14,3,3]);
  assert.deepEqual(multiply(identity(),result),result);
});

function makeGraph() {
  const graph=Object.create(Graph.prototype);graph.documents=new Map();graph.files=new Map();graph.names=new Map();
  function add(guid,name,objects) {
    const doc={entry:{guid,name,type:'TestFixture',sha1:'synthetic'},asset:{root:objects[0].$id},nodes:new Map(objects.map(o=>[o.$id,o]))};
    graph.documents.set(guid,doc);graph.files.set(guid,doc.entry);graph.names.set(name.toLowerCase(),doc.entry);
  }
  add('level','level',[{$id:'root',$type:'LevelData',Objects:[{$ref:'reference'},{$ref:'group'},{$ref:'spawn'}]},
    {$id:'reference',$type:'ReferenceObjectData',BlueprintTransform:transform(10,0,0,true),Blueprint:{$external:'pair',classGuid:'pairRoot',name:'pair'}},
    {$id:'group',$type:'StaticModelGroupEntityData',Transform:transform(0,5,0),MemberDatas:[{InstanceCount:2,MeshAsset:{$external:'mesh',classGuid:'meshRoot',name:'mesh'},InstanceTransforms:[transform(2,0,0),transform(4,0,0)]}]},
    {$id:'spawn',$type:'SpawnReferenceObjectData',BlueprintTransform:transform(3,0,7),Team:{name:'Team1',value:1},Blueprint:{$external:'character',classGuid:'characterRoot',name:'character'}}]);
  add('pair','pair',[{$id:'pairRoot',$type:'MeshAndVariationPair',MeshAsset:{$external:'mesh',classGuid:'meshRoot',name:'mesh'},Object:{$external:'mesh',classGuid:'meshRoot',name:'mesh'}}]);
  add('mesh','mesh',[{$id:'meshRoot',$type:'RigidMeshAsset',MeshSetResource:{$resource:'18446744073709551615'}}]);
  return graph;
}
test('spatial assembly expands group instances, preserves 64-bit resource IDs, avoids duplicate pair meshes and does not place spawned characters',()=>{
  const plan=assemble(makeGraph(),['level']);
  assert.equal(plan.complete,true);assert.equal(plan.instances.length,3);assert.equal(plan.assets.length,1);
  assert.deepEqual(plan.instances.map(i=>i.matrix.slice(12,15)),[[10,0,0],[2,5,0],[4,5,0]]);
  assert.equal(plan.assets[0].resource.$resource,'18446744073709551615');
  assert.equal(plan.spawnCandidates.length,1);assert.deepEqual(plan.spawnCandidates[0].position,[3,0,7]);
});
test('missing exact external class stays unresolved instead of silently selecting a different root',()=>{
  const graph=makeGraph();graph.documents.get('pair').nodes.get('pairRoot').MeshAsset.classGuid='missing';
  const plan=assemble(graph,['level']);
  assert.equal(plan.complete,false);assert.equal(plan.unresolved.length,1);assert.deepEqual(plan.requiredNames,['mesh']);
});
