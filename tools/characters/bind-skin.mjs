import fs from 'node:fs';
import path from 'node:path';
import { Matrix4, Vector3, Quaternion } from '../../web/node_modules/three/build/three.module.js';

// The source matrices store Frostbite right/up/forward/trans vectors, matching glTF column order.
// Geometry is kept in its source bind space and ModelPose matrices are inverted for skin binding.
export function bindSkin(input, skinFile, output) {
  const file=fs.readFileSync(input), skin=JSON.parse(fs.readFileSync(skinFile,'utf8'));
  if(file.readUInt32LE(0)!==0x46546c67 || file.readUInt32LE(4)!==2)throw new Error('Not GLB2');
  const jsonLength=file.readUInt32LE(12),doc=JSON.parse(file.subarray(20,20+jsonLength).toString('utf8'));
  const binStart=20+jsonLength+8, original=file.subarray(binStart,binStart+file.readUInt32LE(binStart-8));
  const blocks=[original];let byteLength=original.length;
  function accessor(data,components,type='FLOAT',target=34962){
    const pad=(4-byteLength%4)%4;if(pad){blocks.push(Buffer.alloc(pad));byteLength+=pad;}
    const byteOffset=byteLength, buf=Buffer.from(data.buffer,data.byteOffset,data.byteLength);blocks.push(buf);byteLength+=buf.length;
    const view=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset,byteLength:buf.length,...(target?{target}:{})});
    const index=doc.accessors.length;doc.accessors.push({bufferView:view,componentType:type==='FLOAT'?5126:5123,count:data.length/components,type:components===16?'MAT4':`VEC${components}`});return index;
  }
  const boneStart=doc.nodes.length,roots=[],inverse=new Float32Array(skin.bones.length*16),world=[];
  let maxRestMatrixError=0,maxDiscardedWeight=0,verticesWithDiscardedWeights=0;
  for(let i=0;i<skin.bones.length;i++){
    const b=skin.bones[i],matrix=new Matrix4().fromArray(b.local),t=new Vector3(),q=new Quaternion(),s=new Vector3();matrix.decompose(t,q,s);
    const node={name:b.name,translation:t.toArray(),rotation:q.toArray(),scale:s.toArray(),extras:{sourceBoneIndex:i,procedural:b.procedural}};
    doc.nodes.push(node);
    if(b.parent<0 || b.parent===i){roots.push(boneStart+i);world[i]=matrix.clone();}
    else {if(b.parent>=i)throw new Error(`Parent follows child ${i}: ${b.parent}`);const parent=doc.nodes[boneStart+b.parent];(parent.children??=[]).push(boneStart+i);world[i]=new Matrix4().multiplyMatrices(world[b.parent],matrix);}
    const model=new Matrix4().fromArray(b.model);inverse.set(model.clone().invert().elements,i*16);
    for(let c=0;c<16;c++)maxRestMatrixError=Math.max(maxRestMatrixError,Math.abs(world[i].elements[c]-model.elements[c]));
  }
  const primitives=doc.meshes[0].primitives;
  if(primitives.length!==skin.sections.length)throw new Error('Geometry section mismatch');
  for(let s=0;s<primitives.length;s++){
    const sec=skin.sections[s],joints=new Uint16Array(sec.vertexCount*4),weights=new Float32Array(sec.vertexCount*4);
    if(primitives[s].extras.sectionName!==sec.name)throw new Error(`Section order changed: ${sec.name}`);
    for(let v=0;v<sec.vertexCount;v++){
      // Some source vertices repeat a bone; merge identical joint influences before
      // writing glTF (which requires each nonzero-weight joint to be unique).
      const merged=new Map();for(let c=0;c<8;c++){const j=sec.joints[v*8+c],w=sec.weights[v*8+c];if(w>0)merged.set(j,(merged.get(j)??0)+w);}
      const pairs=[...merged].sort((a,b)=>b[1]-a[1]);while(pairs.length<8)pairs.push([0,0]);
      const kept=pairs.slice(0,4),sum=kept.reduce((n,p)=>n+p[1],0),discarded=pairs.slice(4).reduce((n,p)=>n+p[1],0);
      maxDiscardedWeight=Math.max(maxDiscardedWeight,discarded);if(discarded>0.0001)verticesWithDiscardedWeights++;
      for(let c=0;c<4;c++){joints[v*4+c]=kept[c][0];weights[v*4+c]=kept[c][1]/sum;}
    }
    primitives[s].attributes.JOINTS_0=accessor(joints,4,'UNSIGNED_SHORT');primitives[s].attributes.WEIGHTS_0=accessor(weights,4);
  }
  doc.skins=[{name:skin.skeleton,joints:skin.bones.map((_,i)=>boneStart+i),inverseBindMatrices:accessor(inverse,16,'FLOAT',0),...(roots.length===1?{skeleton:roots[0]}:{})}];
  doc.nodes[0].skin=0;doc.scenes[0].nodes.push(...roots);
  doc.extras={...doc.extras,bindingApplied:true,skinSource:{source:skin.source,guid:skin.sourceGuid,sha1:skin.sourceSha1,skeleton:skin.skeleton,sourceJointCount:skin.bones.length,maxRestMatrixError,maxDiscardedWeight,verticesWithDiscardedWeights,animationsRecovered:false},limitations:[...(doc.extras?.limitations??[]),'Animation clips have not been recovered. Bind pose and skin weights are recovered; runtime pose changes are explicitly approximated.']};
  if(maxDiscardedWeight>0)doc.extras.limitations.push('Runtime supports four influences: strongest source influences retained and normalized. Full eight-influence source arrays preserved in .skin.json.');
  const pad=(4-byteLength%4)%4;if(pad){blocks.push(Buffer.alloc(pad));byteLength+=pad;}
  doc.buffers[0].byteLength=byteLength;const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc((json.length+3)&~3,32);json.copy(padded);const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+padded.length+8+byteLength,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(byteLength);binHeader.writeUInt32LE(0x004e4942,4);
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,Buffer.concat([header,padded,binHeader,...blocks]));
  const report={output,source:skin.source,sourceGuid:skin.sourceGuid,vertices:skin.vertexCount,bones:skin.bones.length,maxRestMatrixError,maxDiscardedWeight,verticesWithDiscardedWeights,animationsRecovered:false};fs.writeFileSync(output+'.binding.json',JSON.stringify(report,null,2));return report;
}
if(process.argv[1]===new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1') || process.argv[1]?.endsWith('bind-skin.mjs'))console.log(JSON.stringify(bindSkin(...process.argv.slice(2)),null,2));
