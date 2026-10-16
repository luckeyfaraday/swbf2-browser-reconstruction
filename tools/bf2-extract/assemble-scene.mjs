import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// This stage only follows spatial graph edges. It never treats bundle membership
// or an arbitrary external dependency as a placed object.
export const identity = () => [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function matrix(t) {
  if (!t) return identity();
  const parts=['right','up','forward','trans'].map(k => t[k] && ['x','y','z'].map(c => t[k][c]));
  if (parts.some(v => !v || v.some(n => !Number.isFinite(n)))) throw new Error('Malformed LinearTransform');
  return parts.flatMap((v,i) => [...v,i === 3 ? 1 : 0]);
}
export function multiply(a,b) {
  const result=Array(16).fill(0);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++) for(let k=0;k<4;k++) result[c*4+r]+=a[k*4+r]*b[c*4+k];
  return result;
}
const typename = o => o?.$type?.split('.').at(-1) ?? '';
const number = value => typeof value === 'number' ? value : Number(value?.value);

export class Graph {
  constructor(dirs) {
    this.files=new Map();this.names=new Map();this.documents=new Map();
    for(const dir of dirs) {
      const manifest=JSON.parse(fs.readFileSync(path.join(dir,'export.manifest.json'),'utf8'));
      for(const row of manifest.results) {
        const entry={...row,path:path.join(dir,row.file)};
        this.files.set(row.guid,entry);this.names.set(row.name.toLowerCase(),entry);
      }
    }
  }
  document(guid) {
    if(this.documents.has(guid))return this.documents.get(guid);
    const entry=this.files.get(guid);if(!entry)return null;
    const doc=JSON.parse(fs.readFileSync(entry.path,'utf8'));
    const result={entry:doc.entry,asset:doc.asset,nodes:new Map(doc.asset.objects.map(o=>[o.$id,o])),sourcePath:entry.path};
    this.documents.set(guid,result);return result;
  }
  resolve(value,doc) {
    if(!value)return null;
    if(value.$ref)return doc.nodes.has(value.$ref)?{doc,node:doc.nodes.get(value.$ref)}:null;
    if(value.$external) {
      const target=this.document(value.$external);if(!target)return null;
      const requested=value.classGuid;
      const node=target.nodes.get(requested) ?? (requested === '00000000-0000-0000-0000-000000000000' ? target.nodes.get(target.asset.root) : null);
      return node?{doc:target,node}:null;
    }
    return {doc,node:value};
  }
}

export function assemble(graph,roots,recoveredGroups=[]) {
  const placements=[],spawnCandidates=[],lightCandidates=[],unresolved=[],warnings=[],meshAssets=new Map(),visitedTypes=new Map();
  const skipped=[];
  function provenance(doc,node,route) { return {asset:doc.entry.name,fileGuid:doc.entry.guid,classGuid:node.$id ?? null,route}; }
  function missing(value,doc,route) {
    unresolved.push({source:doc.entry.name,route,reference:value});
  }
  function walk(value,doc,parent,variation,route,active=new Set(),sourcePhysics=null) {
    const resolved=graph.resolve(value,doc);
    if(!resolved){if(value)missing(value,doc,route);return;}
    const {node}=resolved;doc=resolved.doc;
    const type=typename(node);visitedTypes.set(type,(visitedTypes.get(type)??0)+1);
    const key=doc.entry.guid+':'+node.$id;
    if(node.$id&&active.has(key)){warnings.push({kind:'spatial-cycle',...provenance(doc,node,route)});return;}
    const next=new Set(active);if(node.$id)next.add(key);
    if(node.Excluded===true){skipped.push({reason:'Excluded=true',...provenance(doc,node,route)});return;}
    let current=parent;
    try {if(node.BlueprintTransform)current=multiply(parent,matrix(node.BlueprintTransform));else if(node.Transform)current=multiply(parent,matrix(node.Transform));}
    catch(error){warnings.push({kind:'invalid-transform',error:error.message,...provenance(doc,node,route)});return;}
    if(node.Enabled===false || node.Visible===false)warnings.push({kind:'runtime-activation-unverified',enabled:node.Enabled,visible:node.Visible,...provenance(doc,node,route)});
    if(/SpawnReferenceObjectData$/.test(type)||type==='AlternateSpawnEntityData') {
      spawnCandidates.push({position:current.slice(12,15),forward:current.slice(8,11),sourceTeam:node.Team,sourceRotationYaw:node.RotationYaw,useAsSpawnPoint:node.UseAsSpawnPoint,enabled:node.Enabled,...provenance(doc,node,route)});
      // A spawner's Blueprint is a dynamic character/vehicle, not static map geometry.
      return;
    }
    if(/Light.*EntityData$/.test(type))lightCandidates.push({matrix:current,properties:node,...provenance(doc,node,route)});
    if(node.MeshSetResource) {
      const assetId=doc.entry.guid;
      meshAssets.set(assetId,{id:assetId,name:doc.entry.name,type:doc.entry.type,resource:node.MeshSetResource,sourceSha1:doc.entry.sha1});
      placements.push({assetId,matrix:current,variation:variation??null,sourcePhysics,...provenance(doc,node,route)});return;
    }
    if(type==='StaticModelGroupEntityData') {
      const recovered=recoveredGroups.find(r=>r.fileGuid===doc.entry.guid&&r.groupId===node.$id);
      for(const [i,member] of (node.MemberDatas??[]).entries()) {
        const originals=member.InstanceTransforms??[];
        const recoveredMember=recovered?.members.find(m=>m.memberIndex===i);
        const transforms=originals.length?originals:recoveredMember?.matrices??[];
        if(Number(member.InstanceCount)!==transforms.length)warnings.push({kind:'group-instance-count-mismatch',declared:member.InstanceCount,transforms:transforms.length,...provenance(doc,node,route+'/MemberDatas/'+i)});
        for(const [j,transform] of transforms.entries()) {
          const target=member.MeshAsset??member.MemberType;
          const instance=multiply(current,Array.isArray(transform)?transform:matrix(transform));
          walk(target,doc,instance,member.InstanceObjectVariation?.[j]??variation,route+'/MemberDatas/'+i+'/InstanceTransforms/'+j,next,{partCount:member.PhysicsPartCountPerInstance,groupFileGuid:doc.entry.guid,memberIndex:i});
        }
      }
      return;
    }
    if(type==='StaticModelEntityData' || node.Mesh) {
      if(node.Mesh)walk(node.Mesh,doc,current,variation,route+'/Mesh',next,sourcePhysics);
    }
    // MeshAndVariationPair is an ObjectBlueprint; its MeshAsset is the render
    // target. Following Object as well would count the same placement twice.
    if(node.MeshAsset) {walk(node.MeshAsset,doc,current,node.Variation??variation,route+'/MeshAsset',next,sourcePhysics);return;}
    if(node.Blueprint) {walk(node.Blueprint,doc,current,node.ObjectVariation??variation,route+'/Blueprint',next,sourcePhysics);return;}
    const objectRefs=new Set();
    for(const [field,list] of [['Object',node.Object?[node.Object]:[]],['Objects',node.Objects??[]],['Components',node.Components??[]],['AutoloadedDetachedSubWorldDatas',node.AutoloadedDetachedSubWorldDatas??[]]]) {
      for(const [i,child] of list.entries()) {
        const refKey=JSON.stringify(child);if(objectRefs.has(refKey))continue;objectRefs.add(refKey);
        walk(child,doc,current,variation,route+'/'+field+'/'+i,next,sourcePhysics);
      }
    }
  }
  for(const name of roots) {
    const entry=graph.names.get(name.toLowerCase());if(!entry)throw new Error('Root graph not exported: '+name);
    const doc=graph.document(entry.guid);walk({$ref:doc.asset.root},doc,identity(),null,name);
  }
  const requiredNames=[...new Set(unresolved.map(r=>r.reference?.name).filter(Boolean))].sort();
  return {schemaVersion:1,createdUtc:new Date().toISOString(),evidenceClass:'decoded spatial EBX graph; source transforms composed column-major; runtime mode activation unverified',roots,
    complete:unresolved.length===0&&placements.length>0,assets:[...meshAssets.values()],instances:placements,spawnCandidates,lightCandidates,unresolved,warnings,skipped,
    visitedTypes:Object.fromEntries([...visitedTypes.entries()].sort()),requiredNames,
    limitations:['This is an assembly plan, not a verified final map.scene.json.','Mode-specific layer activation must be selected from native evidence.','Collision, material variation, lighting intensity, dynamic entities and spawn-team mapping remain unverified.']};
}

function main(args) {
  const options={graph:[],root:[],'group-transforms':[]};
  for(let i=0;i<args.length;i++) {const key=args[i].replace(/^--/,'');if(key==='graph'||key==='root'||key==='group-transforms')options[key].push(args[++i]);else if(key==='out')options.out=args[++i];else throw new Error('Unknown option '+args[i]);}
  if(!options.graph.length||!options.root.length||!options.out)throw new Error('Usage: node assemble-scene.mjs --graph DIR [--graph DIR] --root EXACT_NAME [--root EXACT_NAME] --out DIRECTORY');
  const report=assemble(new Graph(options.graph),options.root,options['group-transforms'].map(f=>JSON.parse(fs.readFileSync(f,'utf8'))));fs.mkdirSync(options.out,{recursive:true});
  fs.writeFileSync(path.join(options.out,'scene.plan.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(options.out,'required-names.txt'),report.requiredNames.join('\n'));
  fs.writeFileSync(path.join(options.out,'mesh-names.txt'),report.assets.map(a=>a.name).sort().join('\n'));
  console.log(JSON.stringify({complete:report.complete,assets:report.assets.length,instances:report.instances.length,spawnCandidates:report.spawnCandidates.length,unresolved:report.unresolved.length,requiredNames:report.requiredNames.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2));
