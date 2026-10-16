import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createRifleTrails} from '../src/rifle-trails.js';
import {createProjectileVisuals} from '../src/projectile-visuals.js';
import {decodeRifleEmitter,spawnRifleParticle,simulateRifleParticle,encodeRifleParticle} from '../src/rifle-particle.js';
import {evaluateBlasterBoltVertex} from '../src/blaster-bolt-vertex.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/assets/${name}`,import.meta.url),'utf8'));
const emitterDocument=read('rifle-emitter.json'),retirementDocument=read('rifle-trail.json');
// Exact original positions/UVs retained for the independent native VS execution
// fixture. Existing vertex tests verify its source hashes and all363 vertices.
const vertexBytes=fs.readFileSync(new URL('../../exports/rifle-trail/vertex-warp/input.bin',import.meta.url));
const vertices=Array.from({length:363},(_,i)=>Array.from({length:5},(_,j)=>vertexBytes.readFloatLE(16+i*20+j*4)));
const sat=x=>Math.max(0,Math.min(1,x));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

// No WebGL or browser: execute the independently checked CPU kernel from the
// actual production GPU uniforms. This verifies binding, pool and clock policy;
// hardware shader equivalence and occlusion belong to separate GPU checks.
function cpuRenderer() {
  let target=null;const particles=new Map(),calls=[],draws=[];
  return {autoClear:true,calls,draws,getRenderTarget:()=>target,setRenderTarget(value){target=value;},
    render(object) {
      const uniforms=object.material?.uniforms;
      if(uniforms?.previousParticles){
        const timings=uniforms.timingData.value.image.data,emitters=uniforms.emitterData.value.image.data;
        const previous=particles.get(uniforms.previousParticles.value)??[],next=[];
        calls.push(Array.from(timings));
        for(let slot=0;slot<timings.length/4;slot++){
          const [time,dt,pulse,active]=timings.subarray(slot*4,slot*4+4);
          if(!active){next.push(null);continue;}
          const emitter=decodeRifleEmitter(emitters.buffer,slot*912);
          next.push(pulse<-.5?previous[slot]:pulse>.5?spawnRifleParticle(emitter,{time,dt}):
            simulateRifleParticle(previous[slot],emitter,{dt,depthVisibility:()=>false}));
        }
        particles.set(target.texture,next);return;
      }
      if(!object.isScene)return;
      const draw=[];
      for(const mesh of object.children){
        const u=mesh.material.uniforms,states=particles.get(u.boltParticles.value),slot=u.boltCB1.value[9];
        const state=states[slot],buffer=new Uint8Array(states.length*88);
        states.forEach((p,i)=>{if(p)buffer.set(new Uint8Array(encodeRifleParticle(p)),i*88);});
        let positiveBodyVertices=0;const positiveZ=[];
        for(const vertex of vertices.slice(0,359)){
          const out=evaluateBlasterBoltVertex({position:vertex.slice(0,3),uv:vertex.slice(3),cb1:u.boltCB1.value,cb2:u.boltCB2.value,
            emitters:u.boltEmitters.value.image.data,particles:buffer,drawIndices:new Uint32Array([0])});
          assert.ok(out.flatMap(v=>[...v]).every(Number.isFinite),'body VS outputs remain finite');
          const v1=out[1],v7=out[7];
          const body=sat((v1[2]-v7[0])*v1[1])*sat((v7[0]-v1[3])*v1[1])*v7[1]*v7[2];
          if(body>0){positiveBodyVertices++;positiveZ.push(out[6][2]);}
        }
        draw.push({mesh,state:structuredClone(state),positiveBodyVertices,positiveZ});
      }
      draws.push(draw);
    },
  };
}

function fixture(capacity=30){
  const renderer=cpuRenderer(),geometry=new THREE.BufferGeometry();
  const effects=createRifleTrails(renderer,{pixel:{uniforms:{}},geometry,document:{...emitterDocument,effectLimit:capacity}});
  const camera=new THREE.PerspectiveCamera(55,16/9,.05,100);camera.position.set(0,2,-2);camera.lookAt(0,0,5);camera.updateMatrixWorld();
  const depth=new THREE.DataTexture(new Float32Array([1]),1,1,THREE.RedFormat,THREE.FloatType);
  const lifecycle=createProjectileVisuals(retirementDocument);
  const projectile=()=>({position:new THREE.Vector3(),direction:new THREE.Vector3(0,0,1),age:0,weapon:{projectileSpeed:700}});
  const present=time=>{effects.setTime(time);effects.render(camera,depth,640,360);lifecycle.afterPresent();};
  return {renderer,effects,lifecycle,projectile,present,dispose(){effects.dispose();geometry.dispose();depth.dispose();}};
}

test('same-tick700m/s close hits produce source body coverage before their two-presentation retirement',()=>{
  for(const distance of [1,5,10]){
    const f=fixture();
    try {
      const p=f.projectile();p.mesh=f.effects.create(p,{time:1});
      // Gameplay creates at the muzzle, then reaches a hit during that tick.
      // Its age advances although creation and presentation share ctx.time.
      p.position.z=distance;p.age=1/60;f.lifecycle.retire(p.mesh,'primary');
      f.present(1);
      close(f.renderer.calls[0][1],1/60);close(f.renderer.calls[1][1],1/60);
      assert.equal(f.renderer.calls[0][2],1);assert.equal(f.renderer.calls[1][2],0);
      const first=f.renderer.draws[0][0];
      assert.ok(first.positiveBodyVertices>0,`no source body survives startup for a${distance}m hit`);
      assert.ok(first.positiveZ.every(z=>z>=-.02&&z<=distance+.2),'positive source body remains near the muzzle/impact segment');
      assert.equal(f.lifecycle.snapshot().retired,1);assert.ok(p.mesh.parent);
      f.present(1+1/60);
      assert.equal(f.lifecycle.snapshot().retired,0);assert.equal(p.mesh.parent,null);
      f.present(1+2/60);assert.equal(f.effects.snapshot().active,0);
      assert.equal(f.renderer.draws.length,2,'a third presentation must not draw the retired source mesh');
    }finally{f.dispose();}
  }
});

test('new emitters hold existing states during their spawn pass and subsequent time uses the simulation clock',()=>{
  const f=fixture();
  try {
    const first=f.projectile();first.mesh=f.effects.create(first,{time:1});first.position.z=700/60;first.age=1/60;f.present(1);
    const second=f.projectile();second.mesh=f.effects.create(second,{time:1+1/60});second.position.z=700/60;second.age=1/60;
    first.position.z=700/30;first.age=1/30;f.present(1+1/60);
    assert.equal(f.renderer.calls[2][2],-1,'existing particle is held during the new-particle pass');
    assert.equal(f.renderer.calls[2][6],1);
    close(f.renderer.calls[3][1],1/60);close(f.renderer.calls[3][5],1/60);
    const before=f.renderer.draws.at(-1).map(d=>d.state.position);
    f.present(1+1/60);close(f.renderer.calls.at(-1)[1],0);close(f.renderer.calls.at(-1)[5],0);
    f.renderer.draws.at(-1).forEach((d,i)=>d.state.position.forEach((v,axis)=>close(v,before[i][axis])));
    assert.equal(f.renderer.autoClear,true,'kernel and effect draws restore the caller clear flag');
    assert.equal(f.renderer.getRenderTarget(),null,'kernel restores the caller framebuffer');
  }finally{f.dispose();}
});

test('pool reuse, stale retirement and reset never remove a replacement emitter or reuse its old particle',()=>{
  const f=fixture(2);
  try {
    const all=[];
    for(let i=0;i<3;i++){
      const p=f.projectile();p.mesh=f.effects.create(p,{time:1+i/60});p.position.z=2+i;p.age=1/60;all.push(p);f.present(1+i/60);
    }
    assert.equal(f.effects.snapshot().evicted,1);assert.equal(all[0].mesh.parent,null);
    assert.ok(all[1].mesh.parent);assert.ok(all[2].mesh.parent);
    f.lifecycle.retire(all[0].mesh,'primary');f.lifecycle.afterPresent();f.lifecycle.afterPresent();
    assert.ok(all[2].mesh.parent,'retiring an evicted mesh cannot remove its replacement in the same slot');
    f.effects.reset();f.lifecycle.reset();assert.equal(f.effects.snapshot().active,0);
    const fresh=f.projectile();fresh.mesh=f.effects.create(fresh,{time:2});fresh.position.z=1;fresh.age=1/60;f.present(2);
    assert.equal(f.effects.snapshot().active,1);
    assert.equal(f.renderer.calls.at(-2)[2],1,'reset/reuse must invoke the source spawn branch');
    assert.ok(f.renderer.draws.at(-1)[0].positiveBodyVertices>0);
  }finally{f.dispose();}
});
