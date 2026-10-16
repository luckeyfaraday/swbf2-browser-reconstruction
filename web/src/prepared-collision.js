import {deserializeCollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';

export function mapCollisionIdentity(manifest,doors) {
  return JSON.stringify({mapId:manifest.metadata.mapId,
    assets:manifest.assets.map(({id,url,collision})=>({id,url,collision})),
    instances:manifest.instances.map(({assetId,matrix,collision})=>({assetId,matrix,collision})),
    excluded:doors.doors.flatMap(door=>door.leaves.map(leaf=>leaf.sceneMatch.index)).sort((a,b)=>a-b),batchCellSize:48});
}
export async function collisionDigest(data) {
  const bytes=typeof data==='string'?new TextEncoder().encode(data):data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function loadPreparedMapCollision(manifest,doors,{fetch:fetchImpl=globalThis.fetch,onProgress}={}) {
  const started=performance.now(),response=await fetchImpl('/assets/collision/static-map.json');
  if(response.status===404)return null;
  if(!response.ok)throw new Error('Prepared map collision is unavailable');
  const metadata=await response.json();
  if(metadata.sourceIdentity!==await collisionDigest(mapCollisionIdentity(manifest,doors)))return null;
  const binaryResponse=await fetchImpl('/assets/collision/static-map.bin');
  if(!binaryResponse.ok)throw new Error('Prepared map collision payload is unavailable');
  const buffer=await binaryResponse.arrayBuffer();
  if(buffer.byteLength!==metadata.byteLength||await collisionDigest(buffer)!==metadata.binarySha256)throw new Error('Prepared map collision integrity mismatch');
  const world=deserializeCollisionWorld(metadata,buffer);
  world.loadMilliseconds=performance.now()-started;
  onProgress?.({fraction:.88,message:'Original map collision ready'});
  return world;
}
