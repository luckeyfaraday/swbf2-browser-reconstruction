#!/usr/bin/env node
/**
 * bake-navmesh.mjs — bake a Detour navmesh for AI pathing from a level file.
 * The browser never bakes; navigation.js only loads the result.
 *
 *   node bake/bake-navmesh.mjs level.glb [options]
 *
 *   --out <path>          output .bin (default "<name>.navmesh.bin"; metadata
 *                         goes next to it as .json)
 *   --agent-radius <m>    default 0.35   (matches the player capsule)
 *   --agent-height <m>    default 1.8
 *   --agent-climb <m>     default 0.45   (= player stepHeight)
 *   --max-slope <deg>     default 50     (= player maxSlopeAngle)
 *   --cs <m> --ch <m>     voxel size / height (default radius/3.5, cs/2)
 *   --unit-scale <n>      multiply all metre defaults (39.37 for inch maps)
 *   --include / --exclude <regex>, --z-up   as for bake-collision-bvh.mjs
 *   --offmesh <file.json> jump/drop links:
 *                         [{ "start": [x,y,z], "end": [x,y,z], "radius": 0.5,
 *                            "bidirectional": true }]
 *
 * Programmatic use (tests, custom pipelines):
 *   const { bytes, navMesh, config } = await bakeNavMesh(positions, indices, { agentRadius: 0.35 });
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { exportNavMesh, init } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';

import { parseArgs, readLevelGeometry } from './gltf-geometry.mjs';

export const NAV_AGENT_DEFAULTS = Object.freeze({
  agentRadius: 0.35,
  agentHeight: 1.8,
  agentClimb: 0.45,
  maxSlope: 50,
});

/**
 * Recast config from agent dimensions in world units.  Recast measures
 * height, climb and radius in voxels, so they are derived from cs/ch here.
 */
export function navConfigFor(options = {}) {
  const unitScale = Number(options.unitScale) || 1;
  const pick = (name) => Number(options[name] ?? NAV_AGENT_DEFAULTS[name] * (name === 'maxSlope' ? 1 : unitScale));
  const agentRadius = pick('agentRadius');
  const agentHeight = pick('agentHeight');
  const agentClimb = pick('agentClimb');
  const cs = Number(options.cs ?? agentRadius / 3.5);
  const ch = Number(options.ch ?? cs / 2);
  // Tolerance keeps float noise from adding a voxel (1.8 / 0.05 = 36.0000001).
  const voxels = (length, size, round) => round(length / size + (round === Math.ceil ? -1e-6 : 1e-6));
  return {
    cs,
    ch,
    walkableSlopeAngle: pick('maxSlope'),
    walkableHeight: voxels(agentHeight, ch, Math.ceil),
    walkableClimb: voxels(agentClimb, ch, Math.floor),
    walkableRadius: voxels(agentRadius, cs, Math.ceil),
    maxEdgeLen: voxels(1.2 * unitScale, cs, Math.ceil),
    maxSimplificationError: 1.3,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    ...(options.bounds ? { bounds: options.bounds } : {}),
  };
}

function vector(value, label) {
  const v = Array.isArray(value) ? { x: value[0], y: value[1], z: value[2] } : value;
  if (![v?.x, v?.y, v?.z].every((n) => Number.isFinite(Number(n)))) throw new Error(`${label} must be [x,y,z] or {x,y,z}`);
  return { x: Number(v.x), y: Number(v.y), z: Number(v.z) };
}

/** Normalise off-mesh link descriptors ({ start, end } or [start, end]). */
export function offMeshConnections(list = [], unitScale = 1) {
  return list.map((item, index) => {
    const [start, end] = Array.isArray(item) ? item : [item.startPosition ?? item.start, item.endPosition ?? item.end];
    return {
      startPosition: vector(start, `off-mesh ${index} start`),
      endPosition: vector(end, `off-mesh ${index} end`),
      radius: Number(item.radius ?? 0.5 * unitScale),
      bidirectional: item.bidirectional ?? true,
      area: Number(item.area ?? 0),
      flags: Number(item.flags ?? 1),
    };
  });
}

/**
 * Generate a navmesh from world-space triangles.  Resolves to
 * { navMesh, bytes, config }; call navMesh.destroy() when done with it.
 */
export async function bakeNavMesh(positions, indices, options = {}) {
  await init();
  const config = navConfigFor(options);
  const links = offMeshConnections(options.offMeshConnections, Number(options.unitScale) || 1);
  const generated = generateSoloNavMesh(positions, indices, { ...config, offMeshConnections: links });
  if (!generated.success || !generated.navMesh) throw new Error(`navmesh generation failed: ${generated.error ?? 'unknown error'}`);
  return { navMesh: generated.navMesh, bytes: exportNavMesh(generated.navMesh), config: { ...config, offMeshConnections: links.length } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ['zUp', 'help']);
  const input = args._[0];
  if (args.help || !input) {
    console.log('usage: node bake/bake-navmesh.mjs <level.glb|.gltf|.obj> [--out file.bin] [--agent-radius m] [--agent-height m] [--agent-climb m] [--max-slope deg] [--cs m] [--ch m] [--unit-scale n] [--include re] [--exclude re] [--offmesh links.json] [--z-up]');
    process.exitCode = input || args.help ? 0 : 2;
    return;
  }
  const absolute = path.resolve(input);
  const output = path.resolve(args.out ?? absolute.replace(/\.(glb|gltf|obj)$/i, '.navmesh.bin'));
  const metadataPath = output.replace(/\.bin$/i, '') + '.json';
  const level = readLevelGeometry(absolute, { include: args.include, exclude: args.exclude, zUp: Boolean(args.zUp) });
  const sidecar = args.offmesh ? JSON.parse(fs.readFileSync(path.resolve(args.offmesh), 'utf8')) : [];
  const links = [
    ...level.offMeshConnections,
    ...(Array.isArray(sidecar) ? sidecar : sidecar.links ?? sidecar.connections ?? sidecar.offMeshConnections ?? []),
  ];
  const options = {
    unitScale: args.unitScale,
    agentRadius: args.agentRadius,
    agentHeight: args.agentHeight,
    agentClimb: args.agentClimb,
    maxSlope: args.maxSlope,
    cs: args.cs,
    ch: args.ch,
    offMeshConnections: links,
  };
  for (const key of Object.keys(options)) if (options[key] === undefined) delete options[key];
  const started = performance.now();
  const { navMesh, bytes, config } = await bakeNavMesh(level.positions, level.indices, options);
  navMesh.destroy();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
  const metadata = {
    format: 'detour-navmesh',
    recastNavigationVersion: '0.43.1',
    coordinateSystem: 'three-y-up',
    source: path.basename(absolute),
    geometry: { vertices: level.positions.length / 3, triangles: level.indices.length / 3, meshes: level.meshes.length },
    bounds: level.bounds,
    config,
    buildMilliseconds: Math.round(performance.now() - started),
    byteLength: bytes.byteLength,
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`navmesh: cs=${config.cs.toFixed(3)} ch=${config.ch.toFixed(3)} climb=${(config.walkableClimb * config.ch).toFixed(3)} radius=${(config.walkableRadius * config.cs).toFixed(3)}`);
  console.log(`wrote ${output} (${bytes.byteLength} bytes)`);
  console.log(`wrote ${metadataPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
