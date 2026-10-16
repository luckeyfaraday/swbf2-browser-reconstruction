import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';

const root=fileURLToPath(new URL('../..',import.meta.url));
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,''));
const manifest=read('web/public/assets/firstperson-weapons.json');
const evidence=read('tools/characters/firstperson-evidence.json');
const poses=read('exports/firstperson-animation/poses.json');
const hash=b=>createHash('sha256').update(b).digest('hex');
const glb=model=>{
 const full=path.join(root,'web/public/assets',model.url),bytes=fs.readFileSync(full),length=bytes.readUInt32LE(12);
 assert.equal(hash(bytes),model.sha256);
 return {doc:JSON.parse(bytes.subarray(20,20+length)),full};
};

test('selected first-person mesh/appearance links match retained source documents',()=>{
 for(const source of evidence.sourceDocuments){
  const bytes=fs.readFileSync(path.join(root,source.file));assert.equal(hash(bytes),source.jsonSha256);
  const d=JSON.parse(bytes.toString().replace(/^\uFEFF/,''));assert.equal(d.entry.guid,source.guid);assert.equal(d.entry.sha1,source.sourceSha1);
 }
 for(const o of evidence.observations){
  let value=read(o.file);for(const key of o.jsonPointer.split('/').slice(1))value=value[key];assert.deepEqual(value,o.value);
 }
 assert.ok(evidence.observations.some(o=>o.jsonPointer.endsWith('WeaponMesh1p/0/Mesh')&&o.value.$external==='664c2b28-a195-0da8-039b-945eef22752a'));
 assert.ok(evidence.observations.some(o=>o.jsonPointer.endsWith('RenderIn1p')&&o.value===true));
 for(const skin of evidence.sourceSkinFiles){assert.equal(hash(fs.readFileSync(path.join(root,skin.file))),skin.sha256);assert.equal(skin.lod,0);}
});

test('all first-person frame values match original retained ANT byte ranges',()=>{
 const fd=fs.openSync(path.join(root,'exports/characters/ant-common-bank/0.res'),'r');
 try{
  for(const clip of poses.clips){
   const desc=clip.sourceByteRange,bytes=Buffer.alloc(desc.byteLength);
   assert.equal(fs.readSync(fd,bytes,0,bytes.length,desc.arrayOffset),bytes.length);
   assert.equal(clip.additive,false);assert.deepEqual(clip.rawCounts,[85,57,0]);assert.equal(clip.tracks.length,140);
   assert.ok(clip.maxQuaternionNormError<0.000001);
   for(const track of clip.tracks)for(const [n,value]of track.values[0].entries())assert.equal(value,bytes.readFloatLE((track.sourceFloatOffset+n)*4));
   assert.deepEqual(clip.unmapped.map(t=>t.values),[[1,1,1],[1,1,1]]);
  }
 }finally{fs.closeSync(fd);}
});

test('camera-ready faction GLBs have source poses, usable textures and zero validator errors',()=>{
 assert.deepEqual(manifest.models.map(m=>[m.weaponId,m.team]),[['primary',1],['rebel-a280',0]]);
 for(const model of manifest.models){
  const {doc,full}=glb(model);
  assert.deepEqual(model.position,[0,0,0]);assert.deepEqual(model.rotation,[0,0,0]);assert.equal(model.scale,1);
  assert.deepEqual(doc.animations.map(a=>a.name),['idle','sprint']);assert.equal(model.validationErrors,0);
  assert.ok(doc.skins.length>=2);
  for(const image of doc.images??[])assert.ok(fs.existsSync(path.resolve(path.dirname(full),image.uri)),image.uri);
  const clip=poses.clips.find(c=>c.sourceName===`P_1p_${model.name}_IdlePose`);
  for(const track of clip.tracks){
   const nodes=doc.nodes.filter(n=>n.name===track.bone&&n.extras?.sourceBoneIndex!==undefined);assert.ok(nodes.length>0,track.bone);
   for(const n of nodes)assert.deepEqual(n[track.property],track.values[0],`${model.name} ${track.bone}.${track.property}`);
  }
  const report=read(`exports/firstperson-${model.name.toLowerCase()}-validation.json`);
  assert.equal(report.issues.numErrors,0);assert.ok(report.issues.messages.filter(m=>m.severity===1).every(m=>m.code==='MESH_PRIMITIVE_GENERATED_TANGENT_SPACE'));
 }
});

test('source arm and weapon muzzle sockets coincide in actual assembled hierarchy',()=>{
 for(const model of manifest.models){
  const {doc}=glb(model),parents=new Map();doc.nodes.forEach((n,i)=>(n.children??[]).forEach(c=>parents.set(c,i)));
  const world=id=>{
   const n=doc.nodes[id],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3().fromArray(n.translation??[0,0,0]),new Quaternion().fromArray(n.rotation??[0,0,0,1]),new Vector3().fromArray(n.scale??[1,1,1]));
   return parents.has(id)?world(parents.get(id)).multiply(local):local;
  };
  for(const name of ['Wep_Root','Wep_Muzzle']){
   const indices=doc.nodes.flatMap((n,i)=>n.name===name?[i]:[]),positions=indices.map(i=>new Vector3().setFromMatrixPosition(world(i)));
   assert.ok(positions.length>=2);
   for(const p of positions)assert.ok(p.distanceTo(positions[0])<1e-8,`${model.name}: ${name}`);
   if(name==='Wep_Root')for(const i of indices)assert.equal(doc.nodes[parents.get(i)].name,'SpineX');
   if(name==='Wep_Muzzle'){
    assert.ok(positions[0].distanceTo(new Vector3().fromArray(model.idleCameraSpaceMuzzle))<1e-8);
    assert.ok(positions[0].z<-.5&&positions[0].z>-.8,'source muzzle is in front of camera at human weapon scale');
   }
  }
  for(const name of ['LeftHand','RightHand']){
   const i=doc.nodes.findIndex(n=>n.name===name),p=new Vector3().setFromMatrixPosition(world(i));
   assert.ok(p.y<-.05&&p.y>-.3&&p.z<-.05&&p.z>-.6,`${model.name} ${name}`);
  }
 }
});
