// Rendering outlives a source projectile by its configured stop delay. The
// browser's presented-frame interpretation remains explicit reconstruction.
export function createProjectileVisuals(document) {
  const valid=document?.schemaVersion===1&&document.provenance?.evidenceId==='BF2-RIFLE-TRAIL-001';
  if(valid&&(!document.stopOnUnspawn||!document.particleKillOnStop||!Number.isInteger(document.stopDelayFrames)||document.stopDelayFrames<0||!Number.isInteger(document.effectMaxInstances)||document.effectMaxInstances<1))throw new Error('Unsupported source trail lifecycle');
  const selected=new Set(valid?document.weapons.map(row=>row.weaponId):[]),retired=[];
  let expired=0,retirements=0;
  const remove=row=>{row.mesh.removeFromParent();expired++;};
  return {
    retire(mesh,weaponId) {
      const frames=selected.has(weaponId)?document.stopDelayFrames:0;
      if(!frames){mesh.removeFromParent();return;}
      retired.push({mesh,remaining:frames});retirements++;
      while(retired.length>document.effectMaxInstances)remove(retired.shift());
    },
    afterPresent() {
      for(let i=retired.length-1;i>=0;i--)if(--retired[i].remaining<=0){remove(retired[i]);retired.splice(i,1);}
    },
    reset(){for(const row of retired)row.mesh.removeFromParent();retired.length=0;},
    snapshot:()=>({retired:retired.length,retirements,expired,delayFrames:valid?document.stopDelayFrames:0,provenance:document?.provenance??null}),
  };
}

export function positionProjectileVisual(projectile) {
  if(projectile.mesh.userData.recoveredRifleTrail)return;
  // Keep the entire provisional 0.9-metre bolt behind its current endpoint,
  // including terminal hits. No visual geometry is placed through a hit wall.
  const length=Math.min(.9,projectile.travel);
  projectile.mesh.scale.z=length/.9;
  projectile.mesh.position.copy(projectile.position).addScaledVector(projectile.direction,-length*.5);
}
