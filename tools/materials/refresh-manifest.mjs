import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function refreshMaterialProvenance(manifest, directory) {
  const materialFile = path.join(directory, 'meshes/material-conversion.json');
  if (fs.existsSync(materialFile)) {
    const conversion = JSON.parse(fs.readFileSync(materialFile, 'utf8'));
    const converted = new Set(conversion.meshes.map(mesh => mesh.guid));
    const covered = manifest.assets.filter(asset => converted.has(asset.id)).length;
    manifest.metadata.fidelity.materials = `Source section/default-variation texture bindings processed for ${covered}/${manifest.assets.length} meshes; remaining packed shaders, material variants and native tangent parity are incomplete.`;
    manifest.metadata.source.materialConversion = { path: 'meshes/material-conversion.json', evidenceId: conversion.evidenceId, coveredMeshes: covered, shaderFidelityComplete: false };
    for (const asset of manifest.assets) {
      const file = path.join(directory, asset.url);
      asset.source.browserGlbSha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  const floorFile = path.join(directory, 'recovered-floor-materials.json');
  if (fs.existsSync(floorFile)) {
    const floor = JSON.parse(fs.readFileSync(floorFile, 'utf8'));
    manifest.metadata.source.recoveredFloorShader = { path: 'recovered-floor-materials.json', evidenceId: floor.evidenceId, sections: floor.materials.length, pixelShader: floor.pixelShader, vertexShader: floor.vertexShader };
    manifest.metadata.fidelity.materials += ` ${floor.materials.length} SS_DSI_Floor_01 sections use source DXBC-derived color, roughness and world-space normal equations.`;
  }
  const collisionFile = path.join(directory, 'collision-overrides.json');
  if (fs.existsSync(collisionFile)) {
    const collision = JSON.parse(fs.readFileSync(collisionFile, 'utf8'));
    manifest.metadata.source.collisionOverrides = { path: 'collision-overrides.json', overrides: collision.overrides?.length ?? 0 };
    manifest.metadata.fidelity.collision = 'Render-derived collision for most geometry plus original catwalk convex movement hulls. Original catwalk raycast root and remaining native collision shapes are not reconstructed.';
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = path.resolve(process.argv[2] ?? 'web/public/assets');
  const file = path.join(directory, 'map.scene.json');
  const manifest = refreshMaterialProvenance(JSON.parse(fs.readFileSync(file, 'utf8')), directory);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest.metadata.fidelity));
}
