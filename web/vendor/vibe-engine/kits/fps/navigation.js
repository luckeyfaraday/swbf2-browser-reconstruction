/**
 * navigation.js — runtime queries on a navmesh baked by bake/bake-navmesh.mjs.
 *
 * Loads a serialized Detour navmesh and wraps the Recast query / crowd API
 * with three.js vectors.  Never bakes in the browser.
 *
 * Import map needs: three, @recast-navigation/core, @recast-navigation/wasm,
 * and — only if you pass `debug: true` — @recast-navigation/three.
 *
 *   const nav = await loadNavigation('level.navmesh.bin', { maxAgents: 32 });
 *   nav.findPath(from, to)            -> { success, path: Vector3[] }
 *   nav.projectPoint(p)               -> { success, point: Vector3|null, polyRef }
 *   nav.findNearest(p)                -> { success, nearestPoint, nearestRef }
 *   nav.constrainMovement(from, to)   -> { success, position: Vector3 }
 *   nav.addAgent(p, params?)          -> CrowdAgent   (needs maxAgents > 0)
 *   nav.update(dt)                    advance the crowd
 *   nav.debugDrawer / setDebugVisible(bool) / dispose()
 *
 * Options: fetch, maxNodes (4096), queryHalfExtents, maxAgents (0),
 * maxAgentRadius, agentDefaults, unitScale (1 = metres; scales the default
 * query extents and agent parameters), debug, debugDrawerParams, debugCrowd.
 * Positions accept Vector3, [x, y, z] or {x, y, z}.
 */

import * as THREE from 'three';
import { Crowd, importNavMesh, init, NavMeshQuery } from '@recast-navigation/core';

// Metres; multiplied by `unitScale`.
export const DEFAULT_QUERY_HALF_EXTENTS = Object.freeze({ x: 1.2, y: 3.2, z: 1.2 });
export const DEFAULT_AGENT_PARAMS = Object.freeze({
  radius: 0.35,
  height: 1.8,
  maxAcceleration: 5,
  maxSpeed: 4,
  collisionQueryRange: 1.6,
  pathOptimizationRange: 2.4,
  separationWeight: 2,
  updateFlags: 7,
  obstacleAvoidanceType: 0,
  queryFilterType: 0,
});
const SCALED_AGENT_PARAMS = ['radius', 'height', 'maxAcceleration', 'maxSpeed', 'collisionQueryRange', 'pathOptimizationRange'];

let initialization;

/** Initialise the Recast WASM module once for every navigation instance. */
export function initNavigation() {
  initialization ??= init();
  return initialization;
}

export function asVector3(value, label = 'position') {
  if (value?.isVector3) return value;
  if (Array.isArray(value) && value.length >= 3) return new THREE.Vector3(Number(value[0]), Number(value[1]), Number(value[2]));
  if (value && typeof value === 'object' && [value.x, value.y, value.z].every((n) => Number.isFinite(Number(n)))) {
    return new THREE.Vector3(Number(value.x), Number(value.y), Number(value.z));
  }
  throw new TypeError(`${label} must be a THREE.Vector3, [x,y,z], or {x,y,z}`);
}

const plain = (v) => ({ x: v.x, y: v.y, z: v.z });
const toVector3 = (v) => new THREE.Vector3(v.x, v.y, v.z);

async function readBytes(source, fetchImpl) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (source && typeof source.arrayBuffer === 'function') return new Uint8Array(await source.arrayBuffer());
  if (typeof source !== 'string' && !(source instanceof URL)) {
    throw new TypeError('navmesh source must be a URL, Response, ArrayBuffer, or Uint8Array');
  }
  const response = await (fetchImpl ?? globalThis.fetch)(source);
  if (!response.ok) throw new Error(`failed to load navmesh ${source}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Load a serialized navmesh (URL, Response, ArrayBuffer or Uint8Array) and
 * return query, path and crowd helpers.  No agents are spawned implicitly.
 */
export async function loadNavigation(source, options = {}) {
  await initNavigation();
  const unitScale = Number(options.unitScale) || 1;
  const bytes = await readBytes(source, options.fetch);
  const { navMesh } = importNavMesh(bytes);
  if (!navMesh) throw new Error('navmesh data could not be imported');
  const query = new NavMeshQuery(navMesh, { maxNodes: options.maxNodes ?? 4096 });
  const halfExtents = {
    x: DEFAULT_QUERY_HALF_EXTENTS.x * unitScale,
    y: DEFAULT_QUERY_HALF_EXTENTS.y * unitScale,
    z: DEFAULT_QUERY_HALF_EXTENTS.z * unitScale,
    ...(options.queryHalfExtents ?? {}),
  };
  query.defaultQueryHalfExtents = halfExtents;

  const agentDefaults = { ...DEFAULT_AGENT_PARAMS };
  for (const key of SCALED_AGENT_PARAMS) agentDefaults[key] *= unitScale;
  Object.assign(agentDefaults, options.agentDefaults);

  const maxAgents = Math.max(0, Math.floor(options.maxAgents ?? 0));
  const crowd = maxAgents > 0
    ? new Crowd(navMesh, { maxAgents, maxAgentRadius: Number(options.maxAgentRadius ?? agentDefaults.radius) })
    : null;

  let debugDrawer = null;
  let crowdHelper = null;
  if (options.debug || options.debugCrowd) {
    // Optional peer: only needed (and only imported) for debug drawing.
    const { CrowdHelper, DebugDrawer } = await import('@recast-navigation/three');
    if (options.debug) {
      debugDrawer = new DebugDrawer(options.debugDrawerParams);
      debugDrawer.drawNavMesh(navMesh);
    }
    if (crowd && options.debugCrowd) crowdHelper = new CrowdHelper(crowd, options.debugCrowdParams);
  }

  const projectPoint = (position, { filter, halfExtents: extents } = {}) => {
    const input = asVector3(position);
    const result = query.findClosestPoint(plain(input), { filter, halfExtents: extents ?? halfExtents });
    return { ...result, point: result.success ? toVector3(result.point) : null, input };
  };

  const findNearest = (position, { filter, halfExtents: extents } = {}) => {
    const input = asVector3(position);
    const result = query.findNearestPoly(plain(input), { filter, halfExtents: extents ?? halfExtents });
    return { ...result, nearestPoint: result.success ? toVector3(result.nearestPoint) : null, input };
  };

  const findPath = (start, end, pathOptions = {}) => {
    const result = query.computePath(plain(asVector3(start, 'start')), plain(asVector3(end, 'end')), {
      ...pathOptions,
      halfExtents: pathOptions.halfExtents ?? halfExtents,
    });
    return { ...result, path: (result.path ?? []).map(toVector3) };
  };

  /** Slide a desired move along the walkable surface (keeps agents on the mesh). */
  const constrainMovement = (current, desired, moveOptions = {}) => {
    const from = asVector3(current, 'current');
    const to = asVector3(desired, 'desired');
    const nearest = findNearest(from, moveOptions);
    if (!nearest.success || !nearest.nearestRef) return { success: false, position: from.clone(), nearest };
    const result = query.moveAlongSurface(nearest.nearestRef, plain(from), plain(to), {
      filter: moveOptions.filter,
      maxVisitedSize: moveOptions.maxVisitedSize,
    });
    return { ...result, position: result.success ? toVector3(result.resultPosition) : from.clone(), nearest };
  };

  const addAgent = (position, agentOptions = {}) => {
    if (!crowd) throw new Error('crowd is disabled; pass maxAgents > 0 to loadNavigation');
    const projected = projectPoint(position, agentOptions);
    if (!projected.success || !projected.point) throw new Error('cannot add a crowd agent outside the navmesh');
    const { filter: _filter, halfExtents: _extents, ...params } = agentOptions;
    return crowd.addAgent(plain(projected.point), { ...agentDefaults, ...params });
  };

  const update = (dt, timeSinceLastCalled, maxSubSteps) => {
    if (!crowd) return;
    crowd.update(dt, timeSinceLastCalled, maxSubSteps);
    crowdHelper?.update();
  };

  const setDebugVisible = (visible) => {
    if (debugDrawer) debugDrawer.visible = Boolean(visible);
    if (crowdHelper) crowdHelper.visible = Boolean(visible);
  };

  const dispose = () => {
    debugDrawer?.dispose();
    crowd?.destroy();
    query.destroy();
    navMesh.destroy();
  };

  return {
    bytes,
    navMesh,
    query,
    crowd,
    debugDrawer,
    crowdHelper,
    projectPoint,
    findNearest,
    findPath,
    constrainMovement,
    addAgent,
    update,
    setDebugVisible,
    dispose,
  };
}

export default loadNavigation;
