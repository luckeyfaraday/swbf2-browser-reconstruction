#!/usr/bin/env node
/**
 * bake-collision-bvh.mjs — bake a level's collision into a serialized
 * three-mesh-bvh that collision-world.js loads without rebuilding the tree.
 *
 *   node bake/bake-collision-bvh.mjs level.glb [options]
 *
 *   --out <path>        output prefix (default: next to the input,
 *                       "<name>.collision" -> .collision.bin + .collision.json)
 *   --include <regex>   only meshes whose "<node> <mesh>" name matches
 *   --exclude <regex>   skip matching meshes (e.g. "sky|decal|water|trigger")
 *   --weld <distance>   merge vertices closer than this (default 0.0001;
 *                       0 disables); shrinks the file, never changes shape
 *   --z-up              input is Z-up (OBJ exporters); convert to Y-up
 *
 * Runtime:
 *   const world = await loadCollisionWorld({ url: 'level.collision.json' });
 *
 * For small levels you can skip baking entirely and call
 * CollisionWorld.fromObject3D(gltf.scene) at load time.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';
import { SAH } from 'three-mesh-bvh';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

import { CollisionWorld } from '../collision-world.js';
import { parseArgs, readLevelGeometry } from './gltf-geometry.mjs';

/**
 * Build and serialize a collision BVH from world-space triangles.
 * @returns {{ metadata: object, binary: Uint8Array, world: CollisionWorld }}
 */
export function bakeCollision({ positions, indices }, { weld = 1e-4, binaryName = 'collision.bin', source = null } = {}) {
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1));
  if (weld > 0) geometry = mergeVertices(geometry, weld);
  // mergeVertices may hand back a 16-bit index; the loader supports both.
  const started = performance.now();
  const world = new CollisionWorld(geometry, {}, { strategy: SAH, maxDepth: 40, setBoundingBox: true });
  const buildMilliseconds = Math.round(performance.now() - started);
  const { metadata, binary } = world.serialize({ binary: binaryName, ...(source ? { source } : {}), buildMilliseconds });
  return { metadata, binary, world };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ['zUp', 'help']);
  const input = args._[0];
  if (args.help || !input) {
    console.log('usage: node bake/bake-collision-bvh.mjs <level.glb|.gltf|.obj> [--out prefix] [--include re] [--exclude re] [--weld d] [--z-up]');
    process.exitCode = input || args.help ? 0 : 2;
    return;
  }
  const absolute = path.resolve(input);
  const prefix = path.resolve(args.out ?? absolute.replace(/\.(glb|gltf|obj)$/i, '.collision'));
  const binaryPath = `${prefix}.bin`;
  const metadataPath = `${prefix}.json`;
  const level = readLevelGeometry(absolute, { include: args.include, exclude: args.exclude, zUp: Boolean(args.zUp) });
  const { metadata, binary } = bakeCollision(level, {
    weld: args.weld === undefined ? 1e-4 : Number(args.weld),
    binaryName: path.basename(binaryPath),
    source: path.basename(absolute),
  });
  metadata.meshes = level.meshes.length;
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, binary);
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`baked ${metadata.vertices} vertices / ${metadata.triangles} triangles from ${level.meshes.length} meshes in ${metadata.buildMilliseconds} ms`);
  console.log(`wrote ${binaryPath} (${binary.byteLength} bytes)`);
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
