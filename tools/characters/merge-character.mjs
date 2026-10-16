import fs from 'node:fs';
import path from 'node:path';

// Preserve each recovered component rig/material. Keeping independent rigs avoids
// conflating source-specific procedural bones that share human bone indices.
export function mergeCharacter(output, inputs) {
  const out={asset:{version:'2.0',generator:'BF2 source character assembler'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],skins:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],images:[],textures:[],samplers:[],extras:{sourceComponents:[],animationsRecovered:false}},blocks=[];let offset=0;
  for(const input of inputs){
    const b=fs.readFileSync(input),len=b.readUInt32LE(12),doc=JSON.parse(b.subarray(20,20+len));
    if(doc.animations?.length)throw new Error('Animation merging must be implemented before merging animated components');
    const bin=b.subarray(28+len,28+len+b.readUInt32LE(20+len));
    const base=Object.fromEntries(['nodes','meshes','materials','skins','accessors','bufferViews','images','textures','samplers'].map(k=>[k,out[k].length]));
    const pad=(4-offset%4)%4;if(pad){blocks.push(Buffer.alloc(pad));offset+=pad;}
    const source=doc.extras?.source??doc.extras?.skinSource?.source??path.basename(input);
    for(const view of doc.bufferViews??[]){view.byteOffset=(view.byteOffset??0)+offset;view.buffer=0;out.bufferViews.push(view);}
    for(const a of doc.accessors??[]){if(a.sparse)throw new Error('Sparse accessor unsupported');if(a.bufferView!==undefined)a.bufferView+=base.bufferViews;out.accessors.push(a);}
    for(const image of doc.images??[]){if(image.bufferView!==undefined)image.bufferView+=base.bufferViews;if(image.uri){const absolute=path.resolve(path.dirname(input),image.uri);image.uri=path.relative(path.dirname(output),absolute).split(path.sep).join('/');}out.images.push(image);}
    for(const s of doc.samplers??[])out.samplers.push(s);
    for(const t of doc.textures??[]){if(t.source!==undefined)t.source+=base.images;if(t.sampler!==undefined)t.sampler+=base.samplers;out.textures.push(t);}
    const fixTextures=(obj,key='')=>{if(!obj||typeof obj!=='object')return;if(key.endsWith('Texture')&&typeof obj.index==='number')obj.index+=base.textures;for(const [k,v]of Object.entries(obj))fixTextures(v,k);};
    for(const m of doc.materials??[]){fixTextures(m);m.extras={...m.extras,meshSource:source};out.materials.push(m);}
    for(const m of doc.meshes??[]){m.name??=source;for(const p of m.primitives){for(const k of Object.keys(p.attributes))p.attributes[k]+=base.accessors;if(p.indices!==undefined)p.indices+=base.accessors;if(p.material!==undefined)p.material+=base.materials;p.extras={...p.extras,meshSource:source};}m.extras={...m.extras,source};out.meshes.push(m);}
    for(const s of doc.skins??[]){s.joints=s.joints.map(x=>x+base.nodes);if(s.skeleton!==undefined)s.skeleton+=base.nodes;if(s.inverseBindMatrices!==undefined)s.inverseBindMatrices+=base.accessors;out.skins.push(s);}
    for(const n of doc.nodes??[]){if(n.mesh!==undefined)n.mesh+=base.meshes;if(n.skin!==undefined)n.skin+=base.skins;if(n.children)n.children=n.children.map(x=>x+base.nodes);out.nodes.push(n);}
    out.scenes[0].nodes.push(...doc.scenes[doc.scene??0].nodes.map(x=>x+base.nodes));
    for(const k of ['extensionsUsed','extensionsRequired'])if(doc[k])out[k]=[...new Set([...(out[k]??[]),...doc[k]])];
    out.extras.sourceComponents.push({file:path.basename(input),source,provenance:doc.extras});blocks.push(bin);offset+=bin.length;
  }
  for(const k of ['images','textures','samplers'])if(!out[k].length)delete out[k];
  const pad=(4-offset%4)%4;if(pad){blocks.push(Buffer.alloc(pad));offset+=pad;}out.buffers[0].byteLength=offset;
  const raw=Buffer.from(JSON.stringify(out)),json=Buffer.alloc((raw.length+3)&~3,32);raw.copy(json);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+offset,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);const bh=Buffer.alloc(8);bh.writeUInt32LE(offset);bh.writeUInt32LE(0x004e4942,4);
  fs.writeFileSync(output,Buffer.concat([header,json,bh,...blocks]));return {output,components:inputs.length,bytes:28+json.length+offset};
}
if(process.argv[1]?.endsWith('merge-character.mjs'))console.log(mergeCharacter(process.argv[2],process.argv.slice(3)));
