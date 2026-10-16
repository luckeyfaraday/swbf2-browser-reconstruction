/**
 * scene-optimizer.js — collapse repeated static meshes into InstancedMesh
 * batches, bucketed by spatial cell.
 *
 * Big exported levels are thousands of copies of the same prop (same
 * geometry + material).  Each becomes one draw call and one Object3D to
 * traverse every frame.  This groups identical, opaque, static meshes that
 * share a grid cell into one InstancedMesh per cell: most of the draw-call and
 * matrix work disappears, while keeping batches spatially small preserves
 * frustum culling (each batch gets its own bounding sphere).  Static objects
 * also get `matrixAutoUpdate = false`.
 *
 * Nothing that can move is touched: an object is dynamic when
 * `isDynamic(object)` returns true for it or any ancestor (default: userData
 * `dynamic`, `gameplayDynamic` or `dynamicBrush`).  Transparent, skinned,
 * morphing, already-instanced and invisible meshes are left alone.
 *
 * Batching replaces meshes, so do it after collision has been built from the
 * scene (CollisionWorld.fromObject3D) and after gameplay code has looked up
 * the objects it needs by name.
 *
 *   optimizeStaticScene(root, { cellSize = 16, verticalCellSize = 6,
 *                               minInstances = 2, isDynamic }) -> stats
 *   stats: { cellSize, inputMeshes, batches, instances, retainedMeshes,
 *            objectsBefore, objectsAfter }
 *
 * Cell sizes are in scene units (metres by default; the game copies used
 * 640 / 256 for inch-based maps).
 */

import * as THREE from 'three';

const _rootInverse = new THREE.Matrix4();
const _relativeMatrix = new THREE.Matrix4();
const _position = new THREE.Vector3();

export function isDynamicByUserData(object) {
  const data = object.userData;
  return Boolean(data && (data.dynamic || data.gameplayDynamic || data.dynamicBrush));
}

function identityFor(value, ids, cursor) {
  if (!ids.has(value)) ids.set(value, cursor.value++);
  return ids.get(value);
}

function opaqueMaterial(material) {
  const materials = Array.isArray(material) ? material : [material];
  return materials.length > 0 && materials.every((entry) => entry && !entry.transparent && entry.opacity >= 1);
}

function inDynamicSubtree(object, root, isDynamic) {
  for (let node = object; node; node = node.parent) {
    if (isDynamic(node)) return true;
    if (node === root) break;
  }
  return false;
}

export function optimizeStaticScene(root, {
  cellSize = 16,
  verticalCellSize = 6,
  minInstances = 2,
  isDynamic = isDynamicByUserData,
} = {}) {
  if (!root?.isObject3D) throw new TypeError('optimizeStaticScene requires an Object3D');
  root.updateWorldMatrix(true, true);
  _rootInverse.copy(root.matrixWorld).invert();
  const geometryIds = new WeakMap();
  const materialIds = new WeakMap();
  const cursor = { value: 1 };
  const groups = new Map();
  const meshes = [];
  let objectsBefore = 0;

  // traverseVisible: a mesh under a hidden parent must stay hidden, not be
  // batched into a visible InstancedMesh.
  root.traverseVisible((object) => {
    objectsBefore += 1;
    if (!object.isMesh || object.isSkinnedMesh || object.isInstancedMesh) return;
    if (!object.geometry || !opaqueMaterial(object.material) || object.morphTargetInfluences) return;
    if (inDynamicSubtree(object, root, isDynamic)) return;
    _relativeMatrix.multiplyMatrices(_rootInverse, object.matrixWorld);
    _position.setFromMatrixPosition(_relativeMatrix);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const key = [
      identityFor(object.geometry, geometryIds, cursor),
      materials.map((material) => identityFor(material, materialIds, cursor)).join(','),
      Math.floor(_position.x / cellSize),
      Math.floor(_position.y / verticalCellSize),
      Math.floor(_position.z / cellSize),
      object.castShadow ? 1 : 0,
      object.receiveShadow ? 1 : 0,
      object.renderOrder,
      object.layers.mask,
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    const entry = { object, matrix: _relativeMatrix.clone() };
    groups.get(key).push(entry);
    meshes.push(entry);
  });

  let batches = 0;
  let removedMeshes = 0;
  for (const entries of groups.values()) {
    if (entries.length < minInstances) continue;
    const source = entries[0].object;
    const batch = new THREE.InstancedMesh(source.geometry, source.material, entries.length);
    batch.name = `static_batch_${batches}`;
    batch.castShadow = source.castShadow;
    batch.receiveShadow = source.receiveShadow;
    batch.renderOrder = source.renderOrder;
    batch.layers.mask = source.layers.mask;
    batch.matrixAutoUpdate = false;
    batch.matrix.identity();
    for (let i = 0; i < entries.length; i += 1) batch.setMatrixAt(i, entries[i].matrix);
    batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    root.add(batch);
    for (const { object } of entries) object.removeFromParent();
    batches += 1;
    removedMeshes += entries.length;
  }

  root.updateWorldMatrix(true, true);
  let objectsAfter = 0;
  root.traverse((object) => {
    objectsAfter += 1;
    // Freeze static transforms; anything in a dynamic subtree keeps updating.
    if (object !== root && !inDynamicSubtree(object, root, isDynamic)) object.matrixAutoUpdate = false;
  });
  return {
    cellSize,
    inputMeshes: meshes.length,
    batches,
    instances: removedMeshes,
    retainedMeshes: meshes.length - removedMeshes,
    objectsBefore,
    objectsAfter,
  };
}

export default optimizeStaticScene;
