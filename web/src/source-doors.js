import * as THREE from 'three';
import {CollisionWorld,CompositeCollision} from '../vendor/vibe-engine/kits/fps/collision-world.js';
import {createStaticBatches} from './static-batches.js';

// Original OBBs, transforms, axis flags, distances and duration; explicit
// browser state/interpolation/contact interpretations stay in provenance.
export function prepareSourceDoors(document,manifest,models) {
  const group=new THREE.Group();group.name='Original automatic doors';
  const instances=new Set(),doors=[],leafRows=[];
  let transitions=0,updates=0,drawMeshes=0;
  if(document&&document.version!==1)throw new Error('Invalid original door configuration');
  for(const row of document?.doors??[]) {
    const trigger=new THREE.Matrix4().fromArray(row.trigger.matrix);
    if(trigger.determinant()===0)throw new Error('Singular original door trigger');
    const door={id:row.id,inverse:trigger.invert(),half:new THREE.Vector3(...row.trigger.halfExtents),amount:0,start:0,target:0,elapsed:0,leaves:[]};
    for(const leaf of row.leaves) {
      const index=leaf.sceneMatch.index,instance=manifest.instances[index];
      if(instances.has(index)||instance?.assetId!==leaf.meshGuid||instance.matrix.some((v,i)=>Math.abs(v-leaf.matrix[i])>.0001))throw new Error('Original door placement correspondence mismatch');
      if(leaf.opening.duration!==.75||leaf.opening.worldOffset.length!==3||!leaf.opening.worldOffset.every(Number.isFinite))throw new Error('Unsupported source door motion');
      const asset=manifest.assets.find(asset=>asset.id===leaf.meshGuid),model=models.get(leaf.meshGuid);
      if(!model)throw new Error('Original door mesh is unavailable');
      const root=new THREE.Group();root.name=`${row.id}/${leaf.wrapperObject}`;
      model.scene.updateMatrixWorld(true);
      model.scene.traverse(mesh=>{
        if(!mesh.isMesh)return;
        for(const draw of createStaticBatches(mesh,[instance],asset)) {
          draw.userData.sourceDoor=row.id;root.add(draw);drawMeshes++;
        }
      });
      group.add(root);instances.add(index);
      const entry={root,index,offset:new THREE.Vector3(...leaf.opening.worldOffset),duration:leaf.opening.duration,world:null};
      door.leaves.push(entry);leafRows.push(entry);
    }
    doors.push(door);
  }
  const local=new THREE.Vector3();
  const apply=door=>{for(const leaf of door.leaves){leaf.root.position.copy(leaf.offset).multiplyScalar(door.amount);leaf.root.updateMatrixWorld(true);}};
  return {
    group,instances,drawMeshes,provenance:document?.provenance??null,
    attachCollision(base,movementBase=base) {
      if(!leafRows.length)return {collision:base,movementCollision:movementBase};
      const collision=new CompositeCollision(base),movementCollision=new CompositeCollision(movementBase);
      for(const leaf of leafRows) {
        if(leaf.world)throw new Error('Original door collision already attached');
        leaf.world=CollisionWorld.fromObject3D(leaf.root,{filter:mesh=>mesh.userData.mapCollision});
        collision.add(leaf.index,leaf.world).offset=leaf.root.position;
        movementCollision.add(leaf.index,leaf.world).offset=leaf.root.position;
      }
      return {collision,movementCollision};
    },
    reset(){for(const door of doors){door.amount=door.start=door.target=door.elapsed=0;apply(door);}transitions=updates=0;},
    update(dt,occupants) {
      if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid door elapsed time');
      updates++;
      for(const door of doors) {
        const occupied=occupants.some(point=>{local.copy(point).applyMatrix4(door.inverse);return Math.abs(local.x)<=door.half.x&&Math.abs(local.y)<=door.half.y&&Math.abs(local.z)<=door.half.z;});
        const target=occupied?1:0;
        if(target!==door.target){door.start=door.amount;door.target=target;door.elapsed=0;transitions++;}
        if(door.amount===door.target)continue;
        door.elapsed+=dt;
        const t=Math.min(1,door.elapsed/door.leaves[0].duration);
        door.amount=t===1?door.target:door.start+(door.target-door.start)*Math.sin(Math.PI*.5*t);
        apply(door);
      }
    },
    snapshot:()=>({evidenceId:document?.evidenceId??null,doors:doors.length,leaves:leafRows.length,drawMeshes,updates,transitions,
      open:doors.filter(door=>door.amount===1).length,moving:doors.filter(door=>door.amount!==door.target).length,
      states:doors.map(door=>({id:door.id,amount:door.amount,target:door.target,offsets:door.leaves.map(leaf=>({instance:leaf.index,offset:leaf.root.position.toArray()}))})),
      provenance:document?.provenance??null}),
    dispose(){for(const leaf of leafRows)leaf.world?.dispose();},
  };
}
