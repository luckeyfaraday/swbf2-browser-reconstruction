import path from 'node:path';
import {root,readExports,getDocument,getObject,observation,hashField,writeJson} from './ebx-evidence.mjs';
const documents=await readExports(['map','core','detail']),get=name=>getDocument(documents,name);
const level='Levels/MP/DeathStar02_01/',global=get(level+'TeamDeathmatch_Global'),base=get(level+'TeamDeathmatch');
const vector=v=>[v.x,v.y,v.z];
const shape=getObject(global,'VolumeVectorShapeData').object;
const spawns=global.asset.objects.filter(object=>object.$type==='FrostySdk.Ebx.AlternateSpawnEntityData').map(object=>({
  objectId:object.$id,sourceTeam:object.Team,enabled:object.Enabled,priority:object.Priority,
  position:vector(object.Transform.trans),right:vector(object.Transform.right),up:vector(object.Transform.up),forward:vector(object.Transform.forward),
  evidence:observation(global,object.$id,['Transform']),
}));
const extents=points=>({min:[0,1,2].map(axis=>Math.min(...points.map(p=>p[axis]))),max:[0,1,2].map(axis=>Math.max(...points.map(p=>p[axis])))});
const points=shape.Points.map(vector),connections=base.asset.objects[0].LinkConnections;
const links=connections.map((link,index)=>({link,index})).filter(({link})=>link.Target?.classGuid===shape.$id);
if(links.length!==2||links.some(({link})=>link.SourceFieldId!==hashField('CombatArea')))throw new Error('Expected CombatArea links to Global volume');
const report={
  evidenceId:'EV-MAP-REGION-20261015-01',createdAtUtc:new Date().toISOString(),runtimeObserved:false,
  source:global.source,coordinateSystem:'Untransformed source XYZ. Browser origin/handedness conversion belongs to the scene importer.',
  spawns,spawnExtents:extents(spawns.map(spawn=>spawn.position)),
  combatArea:{objectId:shape.$id,closed:shape.IsClosed,height:shape.Height,points,extents:extents(points),evidence:observation(global,shape.$id,['Points']),
    connectionEvidence:links.map(({index})=>observation(base,base.asset.objects[0].$id,['LinkConnections',index])),
    fieldHash:{name:'CombatArea',value:hashField('CombatArea'),algorithm:'EBX DJB2 XOR'},
  },
  findings:[
    {status:'observation',statement:'Online and Skirmish subworld CombatArea links both target this same Global layer volume.'},
    {status:'observation',statement:'AlternateSpawnEntityData stores ground-level transforms and explicit source TeamId values.'},
    {status:'inference',statement:'Use projected XZ combat polygon to select original Blast map geometry, preserving meshes intersecting its boundary.'},
    {status:'unknown',statement:'All volume points have Y616.7317 and Height0. Vertical volume semantics are unresolved; do not use this Y as a spawn floor.'},
    {status:'unknown',statement:'SpawnLocationFinderShapeData has much higher Y coordinates than AlternateSpawnEntityData. Do not use sampling shape Y as player spawn coordinates.'},
  ],
};
await writeJson(path.join(root,'map-region-evidence.json'),report);
console.log(JSON.stringify({evidenceId:report.evidenceId,spawns:spawns.length,spawnExtents:report.spawnExtents,combatArea:report.combatArea.extents}));
