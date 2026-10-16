/**
 * collision-world.js — static triangle collision for capsule characters,
 * accelerated by three-mesh-bvh.
 *
 * A drop-in replacement for three's `Octree` as far as the player controller
 * is concerned (same `capsuleIntersect` / `rayIntersect` result shapes), but
 * faster on large maps and "character aware": when the caller passes
 * `{ floorNormalY, skin, stepHeight }` it resolves walkable support first and
 * lifts the capsule vertically onto floors, ramps and low tread edges instead
 * of shoving it sideways.  That is what removes floor sliding, threshold snags
 * and most stair stalls in the controller.
 *
 * Coordinates are three.js world coordinates (Y up), in whatever unit your
 * level uses (the kit defaults to metres).
 *
 * API
 *   new CollisionWorld(geometry, metadata?)
 *       geometry: BufferGeometry with world-space `position` (index optional).
 *       A BVH is built if `geometry.boundsTree` is missing.
 *   CollisionWorld.fromObject3D(object3d, { filter, includeInvisible = true })
 *       Bakes every Mesh / InstancedMesh under `object3d` (world matrices
 *       applied) into one BVH at runtime — no offline bake step needed.
 *   world.capsuleIntersect(capsule, { floorNormalY?, skin?, stepHeight? })
 *       -> false | { normal: Vector3, depth: number, contacts?: Vector3[] }
 *       `normal * depth` moves the capsule out of the geometry.  With
 *       `floorNormalY` set, `contacts` lists one normal per touched triangle
 *       (walkable supports report the upward face normal).
 *   world.raycastFirst(ray, near = 0, far = Infinity, side = DoubleSide)
 *       -> raw three-mesh-bvh hit ({ point, distance, faceIndex, ... }) | null
 *   world.rayIntersect(ray, near = 0, far = Infinity)
 *       -> false | { distance, point, position, faceIndex, triangle }
 *       Octree-compatible; `triangle` is wound to face the ray origin.
 *   world.serialize() -> { metadata, binary: Uint8Array }
 *   world.debugMesh / world.setDebugVisible(bool)   lazy wireframe helper
 *   world.stats, world.dispose()
 *
 *   deserializeCollisionWorld(metadata, binary) -> CollisionWorld
 *   loadCollisionWorld(url | { url, fetch, cache, onProgress }) -> Promise<CollisionWorld>
 *       Loads the `.json` + `.bin` pair written by bake/bake-collision-bvh.mjs.
 *
 *   new CompositeCollision(base)   static world + movable/removable parts
 *       .add(key, CollisionWorld | BufferGeometry | Object3D) -> part
 *       .remove(key); part.offset (Vector3), part.enabled (bool)
 *       Same capsuleIntersect / rayIntersect API, so the controller can use it.
 */

import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH, SAH } from 'three-mesh-bvh';

export const COLLISION_FORMAT = 'vibe-collision-bvh-v1';
// Byte-identical layout written by the game repos' bakers before the kit.
const COMPATIBLE_FORMATS = new Set([COLLISION_FORMAT, 'hijacked-collision-bvh-v1']);

const _bounds = new THREE.Box3();
const _segment = new THREE.Line3();
const _trianglePoint = new THREE.Vector3();
const _capsulePoint = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _faceNormal = new THREE.Vector3();
const _originalCenter = new THREE.Vector3();
const _resolvedCenter = new THREE.Vector3();
const _segmentCenter = new THREE.Vector3();
const _vertex = new THREE.Vector3();
const _instanceMatrix = new THREE.Matrix4();
const _worldMatrix = new THREE.Matrix4();

const TYPED_ARRAYS = { Float32Array, Uint16Array, Uint32Array, Int32Array };

function typedArray(buffer, descriptor) {
  const Constructor = TYPED_ARRAYS[descriptor.type];
  if (!Constructor) throw new Error(`unsupported collision array type ${descriptor.type}`);
  return new Constructor(buffer, descriptor.byteOffset, descriptor.count);
}

function sliceBuffer(buffer, descriptor) {
  return buffer.slice(descriptor.byteOffset, descriptor.byteOffset + descriptor.byteLength);
}

/** ArrayBuffer view of `binary` (ArrayBuffer, typed array or Node Buffer). */
function asArrayBuffer(binary) {
  if (binary instanceof ArrayBuffer) return binary;
  if (ArrayBuffer.isView(binary)) {
    const { buffer, byteOffset, byteLength } = binary;
    // Typed-array views into the result require 4-byte alignment, so copy
    // whenever the view does not start at the beginning of its buffer.
    return byteOffset === 0 && byteLength === buffer.byteLength
      ? buffer
      : buffer.slice(byteOffset, byteOffset + byteLength);
  }
  throw new TypeError('collision binary must be an ArrayBuffer or typed array');
}

/** Rebuild a CollisionWorld from baked metadata and its binary payload. */
export function deserializeCollisionWorld(metadata, binary) {
  if (!COMPATIBLE_FORMATS.has(metadata?.format)) {
    throw new Error(`unsupported collision format ${metadata?.format ?? 'unknown'}`);
  }
  const buffer = asArrayBuffer(binary);
  const positions = typedArray(buffer, metadata.layout.position);
  const index = typedArray(buffer, metadata.layout.index);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  if (metadata.bounds) {
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(...metadata.bounds.min),
      new THREE.Vector3(...metadata.bounds.max),
    );
  } else {
    geometry.computeBoundingBox();
  }
  geometry.boundsTree = MeshBVH.deserialize({
    version: 1,
    roots: metadata.layout.roots.map((root) => sliceBuffer(buffer, root)),
    index,
    indirectBuffer: null,
  }, geometry, { setIndex: false });
  return new CollisionWorld(geometry, metadata);
}

/**
 * Fetch every binary part straight into one allocation.  Holding all parts
 * before joining them doubled the peak memory of large maps during startup.
 */
async function loadBinaryParts(parts, { baseUrl, byteLength, fetchImpl, cache, onProgress }) {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || !parts?.length) {
    throw new Error('invalid collision binary layout');
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  onProgress?.({ loaded: 0, total: byteLength });
  for (const part of parts) {
    const response = await fetchImpl(new URL(part.uri, baseUrl), { cache });
    if (!response.ok) throw new Error(`collision BVH HTTP ${response.status}: ${part.uri}`);
    const start = offset;
    const append = (bytes) => {
      if (offset + bytes.byteLength > byteLength
        || (part.byteLength != null && offset - start + bytes.byteLength > part.byteLength)) {
        throw new Error(`collision BVH size mismatch: ${part.uri}`);
      }
      output.set(bytes, offset);
      offset += bytes.byteLength;
      onProgress?.({ loaded: offset, total: byteLength });
    };
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          append(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
    } else {
      append(new Uint8Array(await response.arrayBuffer()));
    }
    if (part.byteLength != null && offset - start !== part.byteLength) {
      throw new Error(`collision BVH size mismatch: ${part.uri}`);
    }
  }
  if (offset !== byteLength) throw new Error('collision BVH total size mismatch');
  return output.buffer;
}

/**
 * Load a baked collision world.  `url` points at the metadata `.json`; the
 * binary (or its `binaryParts`, for hosts with a per-file size limit) is
 * resolved relative to it.
 */
export async function loadCollisionWorld(options = {}) {
  const {
    url,
    metadataUrl = url,
    fetch: fetchImpl = globalThis.fetch,
    cache = 'default',
    onProgress = null,
  } = typeof options === 'string' ? { url: options } : options;
  if (!metadataUrl) throw new TypeError('loadCollisionWorld requires the metadata url');
  const clock = globalThis.performance ?? Date;
  const started = clock.now();
  const metadataResponse = await fetchImpl(metadataUrl, { cache });
  if (!metadataResponse.ok) throw new Error(`collision metadata HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  const parts = metadata.binaryParts ?? [{ uri: metadata.binary, byteLength: metadata.byteLength }];
  const baseUrl = metadataResponse.url || new URL(metadataUrl, globalThis.location?.href).href;
  const binary = await loadBinaryParts(parts, {
    baseUrl,
    byteLength: metadata.byteLength,
    fetchImpl,
    cache,
    onProgress,
  });
  const world = deserializeCollisionWorld(metadata, binary);
  world.loadMilliseconds = clock.now() - started;
  return world;
}

function isVisibleInHierarchy(object, root) {
  for (let node = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === root) break;
  }
  return true;
}

export class CollisionWorld {
  /**
   * @param {THREE.BufferGeometry} geometry world-space collision triangles
   * @param {object} metadata optional bake metadata (kept for `stats`)
   * @param {object} bvhOptions MeshBVH options when a tree must be built
   */
  constructor(geometry, metadata = {}, bvhOptions = {}) {
    if (!geometry?.attributes?.position) throw new TypeError('CollisionWorld requires position geometry');
    if (!geometry.boundsTree) {
      geometry.boundsTree = new MeshBVH(geometry, { targetLeafSize: 12, ...bvhOptions });
    }
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    this.geometry = geometry;
    this.bvh = geometry.boundsTree;
    this.metadata = metadata;
    this.loadMilliseconds = 0;
    this._hitTriangle = new THREE.Triangle();
    this._debugMesh = null;
  }

  /**
   * Build a collision world from the meshes under `object`.  World matrices
   * are applied, InstancedMesh instances are expanded, and SkinnedMesh
   * objects (characters) are skipped.  Collision proxies are often hidden,
   * so invisible meshes are included unless `includeInvisible` is false.
   *
   * @param {THREE.Object3D} object
   * @param {{ filter?: (mesh: THREE.Mesh) => boolean, includeInvisible?: boolean,
   *           strategy?: number }} options
   */
  static fromObject3D(object, { filter = null, includeInvisible = true, strategy = SAH } = {}) {
    if (!object?.isObject3D) throw new TypeError('CollisionWorld.fromObject3D requires an Object3D');
    object.updateWorldMatrix(true, true);
    const meshes = [];
    let vertexCount = 0;
    let indexCount = 0;
    object.traverse((node) => {
      if (!node.isMesh || node.isSkinnedMesh) return;
      const position = node.geometry?.attributes?.position;
      if (!position) return;
      if (!includeInvisible && !isVisibleInHierarchy(node, object)) return;
      if (filter && !filter(node)) return;
      const instances = node.isInstancedMesh ? node.count : 1;
      const indices = node.geometry.index ? node.geometry.index.count : position.count;
      meshes.push(node);
      vertexCount += position.count * instances;
      indexCount += (indices - (indices % 3)) * instances;
    });
    if (indexCount === 0) throw new Error('CollisionWorld.fromObject3D found no mesh triangles');

    const positions = new Float32Array(vertexCount * 3);
    const index = new Uint32Array(indexCount);
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const mesh of meshes) {
      const position = mesh.geometry.attributes.position;
      const source = mesh.geometry.index;
      const count = source ? source.count : position.count;
      const triangleIndices = count - (count % 3);
      const instances = mesh.isInstancedMesh ? mesh.count : 1;
      for (let instance = 0; instance < instances; instance += 1) {
        if (mesh.isInstancedMesh) {
          mesh.getMatrixAt(instance, _instanceMatrix);
          _worldMatrix.multiplyMatrices(mesh.matrixWorld, _instanceMatrix);
        } else {
          _worldMatrix.copy(mesh.matrixWorld);
        }
        for (let i = 0; i < position.count; i += 1) {
          _vertex.fromBufferAttribute(position, i).applyMatrix4(_worldMatrix);
          positions[(vertexOffset + i) * 3] = _vertex.x;
          positions[(vertexOffset + i) * 3 + 1] = _vertex.y;
          positions[(vertexOffset + i) * 3 + 2] = _vertex.z;
        }
        for (let i = 0; i < triangleIndices; i += 1) {
          index[indexOffset + i] = vertexOffset + (source ? source.getX(i) : i);
        }
        vertexOffset += position.count;
        indexOffset += triangleIndices;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return new CollisionWorld(geometry, { format: 'runtime-bvh', source: object.name || 'Object3D' }, { strategy });
  }

  get stats() {
    const { geometry } = this;
    return {
      format: this.metadata.format ?? 'runtime-bvh',
      vertices: geometry.attributes.position.count,
      triangles: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3,
      bytes: this.metadata.byteLength ?? 0,
      loadMilliseconds: Math.round(this.loadMilliseconds),
    };
  }

  /** Wireframe helper, created on first use and hidden by default. */
  get debugMesh() {
    if (!this._debugMesh) {
      const mesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({
        color: 0xff3b30,
        wireframe: true,
        transparent: true,
        opacity: 0.24,
        depthTest: false,
      }));
      mesh.name = 'collision_bvh_debug';
      mesh.visible = false;
      mesh.renderOrder = 40;
      mesh.matrixAutoUpdate = false;
      mesh.raycast = acceleratedRaycast;
      this._debugMesh = mesh;
    }
    return this._debugMesh;
  }

  /** Backwards-compatible alias for the game copies' eager `mesh` field. */
  get mesh() {
    return this.debugMesh;
  }

  setDebugVisible(visible) {
    this.debugMesh.visible = Boolean(visible);
  }

  /**
   * Push a capsule out of the world.  Without options this behaves like
   * `Octree.capsuleIntersect`.  With `floorNormalY` (cos of the max walkable
   * slope) it becomes character-aware:
   *   - walkable supports are resolved before walls, because a stair's tread
   *     and riser share an edge and resolving the riser first can push the
   *     capsule away before its foot reaches the tread;
   *   - support is resolved vertically, so gravity on a slope never becomes a
   *     downhill shove, and a tread edge no higher than `stepHeight` above the
   *     feet lifts the bottom sphere over it with no lateral drift;
   *   - every resolution adds `skin`, so the result is already separated.
   */
  capsuleIntersect(capsule, options = {}) {
    _segment.start.copy(capsule.start);
    _segment.end.copy(capsule.end);
    _originalCenter.addVectors(capsule.start, capsule.end).multiplyScalar(0.5);
    _bounds.makeEmpty();
    _bounds.expandByPoint(capsule.start);
    _bounds.expandByPoint(capsule.end);
    _bounds.min.addScalar(-capsule.radius);
    _bounds.max.addScalar(capsule.radius);
    let hit = false;
    const character = Number.isFinite(options.floorNormalY);
    const contacts = character ? [] : null;
    const skin = options.skin ?? 0;
    const stepHeight = options.stepHeight ?? 0;
    const feetY = capsule.start.y - capsule.radius;

    for (let pass = 0; pass < (character ? 2 : 1); pass += 1) {
      this.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_bounds),
        intersectsTriangle: (triangle) => {
          const distance = triangle.closestPointToSegment(_segment, _trianglePoint, _capsulePoint);
          if (distance >= capsule.radius) return false;
          const depth = capsule.radius - distance;
          _normal.subVectors(_capsulePoint, _trianglePoint);
          if (_normal.lengthSq() < 1e-12) {
            // The segment pierces the triangle: push out of its face, on the
            // side the capsule's centre is on.
            triangle.getNormal(_normal);
            _segmentCenter.addVectors(_segment.start, _segment.end).multiplyScalar(0.5);
            if (_normal.dot(_segmentCenter.sub(triangle.a)) < 0) _normal.negate();
          } else {
            _normal.multiplyScalar(1 / Math.max(distance, 1e-12));
          }
          triangle.getNormal(_faceNormal);
          if (_faceNormal.dot(_normal) < 0) _faceNormal.negate();
          const top = character && _faceNormal.y >= options.floorNormalY && _normal.y > 0
            && (_normal.y >= options.floorNormalY || _trianglePoint.y <= feetY + stepHeight);
          if (character && (pass === 0) !== top) return false;
          contacts?.push((top ? _faceNormal : _normal).clone());
          if (top || _normal.y >= (options.floorNormalY ?? Infinity)) {
            // At tread edges the contact normal points diagonally away from
            // the edge.  Lift the bottom sphere over it without lateral drift.
            const horizontalSq = (_capsulePoint.x - _trianglePoint.x) ** 2
              + (_capsulePoint.z - _trianglePoint.z) ** 2;
            const lift = top && _normal.y < options.floorNormalY
              ? _trianglePoint.y + Math.sqrt(Math.max(0, (capsule.radius + skin) ** 2 - horizontalSq)) - _capsulePoint.y
              : (depth + skin) / _normal.y;
            _segment.start.y += lift;
            _segment.end.y += lift;
          } else {
            _segment.start.addScaledVector(_normal, depth + skin);
            _segment.end.addScaledVector(_normal, depth + skin);
          }
          hit = true;
          return false;
        },
      });
    }

    if (!hit) return false;
    _resolvedCenter.addVectors(_segment.start, _segment.end).multiplyScalar(0.5);
    _normal.subVectors(_resolvedCenter, _originalCenter);
    const depth = _normal.length();
    if (!(depth > 0)) return false;
    const result = { normal: _normal.multiplyScalar(1 / depth).clone(), depth };
    if (contacts) result.contacts = contacts;
    return result;
  }

  raycastFirst(ray, near = 0, far = Infinity, side = THREE.DoubleSide) {
    return this.bvh.raycastFirst(ray, side, near, far);
  }

  /** Octree-compatible nearest hit, with the triangle wound towards the ray. */
  rayIntersect(ray, near = 0, far = Infinity) {
    const hit = this.raycastFirst(ray, near, far);
    if (!hit) return false;
    const index = this.geometry.index;
    const position = this.geometry.attributes.position;
    const triangleOffset = hit.faceIndex * 3;
    const a = index ? index.getX(triangleOffset) : triangleOffset;
    const b = index ? index.getX(triangleOffset + 1) : triangleOffset + 1;
    const c = index ? index.getX(triangleOffset + 2) : triangleOffset + 2;
    this._hitTriangle.a.fromBufferAttribute(position, a);
    this._hitTriangle.b.fromBufferAttribute(position, b);
    this._hitTriangle.c.fromBufferAttribute(position, c);
    // Collision queries are double-sided.  Report the contacted side so floor
    // probes also work on meshes exported with downward winding.
    this._hitTriangle.getNormal(_normal);
    if (_normal.dot(ray.direction) > 0) {
      _trianglePoint.copy(this._hitTriangle.b);
      this._hitTriangle.b.copy(this._hitTriangle.c);
      this._hitTriangle.c.copy(_trianglePoint);
    }
    return {
      distance: hit.distance,
      point: hit.point.clone(),
      position: hit.point.clone(),
      faceIndex: hit.faceIndex,
      triangle: this._hitTriangle,
    };
  }

  /**
   * Serialize to the baked format: one binary (positions, BVH index, BVH
   * roots) plus JSON metadata describing its layout.
   */
  serialize(extraMetadata = {}) {
    const serialized = MeshBVH.serialize(this.bvh, { cloneBuffers: false });
    const positions = this.geometry.attributes.position.array;
    if (!(positions instanceof Float32Array)) throw new Error('serialize requires Float32Array positions');
    const chunks = [];
    const layout = {};
    let offset = 0;
    const append = (key, array) => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      layout[key] = { byteOffset: offset, byteLength: bytes.byteLength, type: array.constructor.name, count: array.length };
      chunks.push(bytes);
      offset += bytes.byteLength;
    };
    append('position', positions);
    append('index', serialized.index);
    layout.roots = [];
    for (const root of serialized.roots) {
      const bytes = new Uint8Array(root);
      layout.roots.push({ byteOffset: offset, byteLength: bytes.byteLength });
      chunks.push(bytes);
      offset += bytes.byteLength;
    }
    const binary = new Uint8Array(offset);
    let cursor = 0;
    for (const chunk of chunks) {
      binary.set(chunk, cursor);
      cursor += chunk.byteLength;
    }
    const box = this.geometry.boundingBox;
    const metadata = {
      format: COLLISION_FORMAT,
      binary: 'collision.bin',
      coordinateSystem: 'three-y-up',
      vertices: this.geometry.attributes.position.count,
      triangles: serialized.index.length / 3,
      bounds: { min: box.min.toArray(), max: box.max.toArray() },
      ...extraMetadata,
      byteLength: offset,
      layout,
    };
    return { metadata, binary };
  }

  dispose() {
    this._debugMesh?.material.dispose();
    this.geometry.dispose();
  }
}

/**
 * A static world plus named parts that can move (doors, lifts) or disappear
 * (debris) without rebaking.  Each part is queried in its own local space and
 * offset by `part.offset`, so moving one is just `part.offset.set(...)`.
 */
export class CompositeCollision {
  constructor(base = null) {
    this.base = base;
    this.parts = new Map();
    this.metadata = base?.metadata ?? {};
  }

  add(key, source) {
    const world = source instanceof CollisionWorld || typeof source?.capsuleIntersect === 'function'
      ? source
      : source?.isBufferGeometry
        ? new CollisionWorld(source)
        : CollisionWorld.fromObject3D(source);
    const part = { world, offset: new THREE.Vector3(), enabled: true };
    this.parts.set(key, part);
    return part;
  }

  remove(key) {
    return this.parts.delete(key);
  }

  capsuleIntersect(capsule, options) {
    let best = this.base ? this.base.capsuleIntersect(capsule, options) : false;
    for (const part of this.parts.values()) {
      if (!part.enabled) continue;
      const local = capsule.clone();
      local.translate(_vertex.copy(part.offset).negate());
      const hit = part.world.capsuleIntersect(local, options);
      if (hit && (!best || hit.depth > best.depth)) best = hit;
    }
    return best;
  }

  rayIntersect(ray, near = 0, far = Infinity) {
    let best = this.base ? this.base.rayIntersect(ray, near, far) : false;
    for (const part of this.parts.values()) {
      if (!part.enabled) continue;
      const local = ray.clone();
      local.origin.sub(part.offset);
      const hit = part.world.rayIntersect(local, near, far);
      if (!hit || (best && hit.distance >= best.distance)) continue;
      hit.point?.add(part.offset);
      if (hit.position && hit.position !== hit.point) hit.position.add(part.offset);
      hit.triangle = hit.triangle.clone();
      hit.triangle.a.add(part.offset);
      hit.triangle.b.add(part.offset);
      hit.triangle.c.add(part.offset);
      best = hit;
    }
    return best;
  }
}

export default CollisionWorld;
