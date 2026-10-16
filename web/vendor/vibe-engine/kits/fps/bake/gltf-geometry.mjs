/**
 * gltf-geometry.mjs — read world-space triangles from a .glb, .gltf or .obj
 * file in Node, with no browser APIs and no three.js loaders.
 *
 *   readLevelGeometry(file, { include, exclude, zUp }) ->
 *     { positions: Float32Array, indices: Uint32Array, meshes: string[],
 *       bounds: { min, max }, offMeshConnections: [] }
 *
 * glTF: node hierarchies (matrix or TRS), multiple scenes (the default one),
 * external / data-URI / GLB buffers, interleaved and normalized (quantized)
 * accessors, triangles / strips / fans.  Compressed geometry (Draco,
 * meshopt) is rejected with a clear error — bake from the uncompressed file.
 * OBJ: v / f records (any polygon, negative indices, v/vt/vn tokens) with
 * `o` / `g` names used for filtering.
 * `include` / `exclude` are RegExps (or strings) tested against
 * "<node name> <mesh name>" (glTF) or the current o/g name (OBJ).
 * `zUp` converts Z-up sources (some OBJ exporters) to three's Y-up.
 * `extras.offMeshConnections` on the glTF root are passed through.
 */

import fs from 'node:fs';
import path from 'node:path';

const COMPONENT_TYPES = {
  5120: { size: 1, read: 'getInt8', max: 127 },
  5121: { size: 1, read: 'getUint8', max: 255 },
  5122: { size: 2, read: 'getInt16', max: 32767 },
  5123: { size: 2, read: 'getUint16', max: 65535 },
  5125: { size: 4, read: 'getUint32', max: 0 },
  5126: { size: 4, read: 'getFloat32', max: 0 },
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const UNSUPPORTED_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression'];

function asRegExp(value) {
  if (!value) return null;
  return value instanceof RegExp ? value : new RegExp(value, 'i');
}

function accepts(name, include, exclude) {
  if (include && !include.test(name)) return false;
  if (exclude && exclude.test(name)) return false;
  return true;
}

function decodeDataUri(uri) {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new Error('invalid data URI');
  const header = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  return header.toLowerCase().includes(';base64')
    ? Buffer.from(body, 'base64')
    : Buffer.from(decodeURIComponent(body), 'utf8');
}

function parseGlb(filename) {
  const bytes = fs.readFileSync(filename);
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${filename} is not a glTF 2.0 binary`);
  const chunks = new Map();
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    chunks.set(type, bytes.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  const jsonChunk = chunks.get(0x4e4f534a);
  if (!jsonChunk) throw new Error(`${filename} has no JSON chunk`);
  const json = JSON.parse(Buffer.from(jsonChunk).toString('utf8').replace(/\0+$/, '').trim());
  return { json, binary: chunks.get(0x004e4942) };
}

function readBuffers(gltf, filename, glbBinary) {
  return (gltf.buffers ?? []).map((buffer, index) => {
    if (buffer.uri) {
      return buffer.uri.startsWith('data:')
        ? decodeDataUri(buffer.uri)
        : fs.readFileSync(path.resolve(path.dirname(filename), decodeURIComponent(buffer.uri)));
    }
    if (index === 0 && glbBinary) return glbBinary;
    throw new Error(`${filename} buffer ${index} has no URI and no GLB BIN chunk`);
  });
}

function accessorValues(gltf, buffers, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`missing glTF accessor ${accessorIndex}`);
  if (accessor.sparse) throw new Error(`sparse glTF accessor ${accessorIndex} is not supported`);
  const view = accessor.bufferView === undefined ? undefined : gltf.bufferViews?.[accessor.bufferView];
  const component = COMPONENT_TYPES[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  if (!component || !components) throw new Error(`unsupported glTF accessor ${accessorIndex}`);
  if (!view) throw new Error(`glTF accessor ${accessorIndex} has no bufferView`);
  const buffer = buffers[view.buffer ?? 0];
  const baseOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? component.size * components;
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const scale = accessor.normalized && component.max ? 1 / component.max : 1;
  const values = new Float64Array(accessor.count * components);
  for (let item = 0; item < accessor.count; item += 1) {
    for (let c = 0; c < components; c += 1) {
      const value = data[component.read](baseOffset + item * stride + c * component.size, true) * scale;
      values[item * components + c] = scale === 1 ? value : Math.max(value, -1);
    }
  }
  return { values, components };
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1]
        + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return Array.from(node.matrix, Number);
  const t = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function primitiveTriangles(mode, indices) {
  const triangles = [];
  if (mode === 4) {
    for (let i = 0; i + 2 < indices.length; i += 3) triangles.push(indices[i], indices[i + 1], indices[i + 2]);
  } else if (mode === 5) {
    for (let i = 0; i + 2 < indices.length; i += 1) {
      if (i % 2) triangles.push(indices[i + 1], indices[i], indices[i + 2]);
      else triangles.push(indices[i], indices[i + 1], indices[i + 2]);
    }
  } else if (mode === 6) {
    for (let i = 1; i + 1 < indices.length; i += 1) triangles.push(indices[0], indices[i], indices[i + 1]);
  }
  // Points and lines (modes 0-3) carry no collision surface.
  return triangles;
}

function readGltf(filename, { include, exclude }) {
  const { json: gltf, binary } = path.extname(filename).toLowerCase() === '.glb'
    ? parseGlb(filename)
    : { json: JSON.parse(fs.readFileSync(filename, 'utf8')), binary: undefined };
  const blocked = (gltf.extensionsRequired ?? []).filter((name) => UNSUPPORTED_EXTENSIONS.includes(name));
  if (blocked.length) throw new Error(`${filename} uses ${blocked.join(', ')}; bake from an uncompressed export`);
  const buffers = readBuffers(gltf, filename, binary);
  const nodes = gltf.nodes ?? [];
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, index) => index);
  const positions = [];
  const indices = [];
  const meshes = [];
  const visit = (nodeIndex, parentMatrix, seen) => {
    if (seen.has(nodeIndex)) return;
    seen.add(nodeIndex);
    const node = nodes[nodeIndex];
    if (!node) return;
    const matrix = multiply(parentMatrix, nodeMatrix(node));
    const mesh = node.mesh === undefined ? null : gltf.meshes?.[node.mesh];
    const name = `${node.name ?? ''} ${mesh?.name ?? ''}`.trim();
    if (mesh && accepts(name, include, exclude)) {
      meshes.push(name || `mesh ${node.mesh}`);
      for (const primitive of mesh.primitives ?? []) {
        const accessor = primitive.attributes?.POSITION;
        if (accessor === undefined) continue;
        const source = accessorValues(gltf, buffers, accessor);
        if (source.components !== 3) throw new Error(`POSITION accessor ${accessor} is not VEC3`);
        const base = positions.length / 3;
        const v = source.values;
        for (let i = 0; i < v.length; i += 3) {
          positions.push(
            matrix[0] * v[i] + matrix[4] * v[i + 1] + matrix[8] * v[i + 2] + matrix[12],
            matrix[1] * v[i] + matrix[5] * v[i + 1] + matrix[9] * v[i + 2] + matrix[13],
            matrix[2] * v[i] + matrix[6] * v[i + 1] + matrix[10] * v[i + 2] + matrix[14],
          );
        }
        const list = primitive.indices !== undefined
          ? Array.from(accessorValues(gltf, buffers, primitive.indices).values)
          : Array.from({ length: v.length / 3 }, (_, i) => i);
        for (const index of primitiveTriangles(primitive.mode ?? 4, list)) indices.push(base + index);
      }
    }
    // Instances along each path are distinct, so only guard against cycles.
    for (const child of node.children ?? []) visit(child, matrix, new Set(seen));
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of roots) visit(root, identity, new Set());
  return { positions, indices, meshes, offMeshConnections: gltf.extras?.offMeshConnections ?? [] };
}

function readObj(filename, { include, exclude }) {
  const positions = [];
  const vertices = [];
  const indices = [];
  const meshes = new Set();
  let current = '';
  const lines = fs.readFileSync(filename, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const tag = parts[0];
    if (tag === 'v') {
      vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (tag === 'o' || tag === 'g') {
      current = parts.slice(1).join(' ');
    } else if (tag === 'f' && accepts(current, include, exclude)) {
      meshes.add(current || 'default');
      const face = parts.slice(1).map((token) => {
        const index = parseInt(token.split('/')[0], 10);
        const resolved = index < 0 ? vertices.length + index : index - 1;
        if (!vertices[resolved]) throw new Error(`${filename}: face references missing vertex ${index}`);
        return resolved;
      });
      // Fan-triangulate the polygon, copying vertices lazily.
      const local = face.map((vertex) => {
        positions.push(...vertices[vertex]);
        return positions.length / 3 - 1;
      });
      for (let i = 1; i + 1 < local.length; i += 1) indices.push(local[0], local[i], local[i + 1]);
    }
  }
  return { positions, indices, meshes: [...meshes], offMeshConnections: [] };
}

/** Read a level file into world-space triangles (see file header). */
export function readLevelGeometry(filename, { include = null, exclude = null, zUp = false } = {}) {
  const filters = { include: asRegExp(include), exclude: asRegExp(exclude) };
  const extension = path.extname(filename).toLowerCase();
  let result;
  if (extension === '.glb' || extension === '.gltf') result = readGltf(filename, filters);
  else if (extension === '.obj') result = readObj(filename, filters);
  else throw new Error(`unsupported level format ${extension}; use .glb, .gltf or .obj`);
  if (!result.indices.length) throw new Error(`${filename} contains no triangles${include || exclude ? ' after filtering' : ''}`);

  const positions = new Float32Array(result.positions);
  if (zUp) {
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      positions[i + 1] = positions[i + 2];
      positions[i + 2] = -y;
    }
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 1) {
    const axis = i % 3;
    if (positions[i] < min[axis]) min[axis] = positions[i];
    if (positions[i] > max[axis]) max[axis] = positions[i];
  }
  return {
    positions,
    indices: new Uint32Array(result.indices),
    meshes: result.meshes,
    bounds: { min, max },
    offMeshConnections: result.offMeshConnections,
  };
}

/** Tiny argv parser shared by the bake CLIs: --key value, --flag, positionals. */
export function parseArgs(argv, flags = []) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (flags.includes(key)) args[key] = true;
    else if (i + 1 < argv.length) args[key] = argv[++i];
    else throw new Error(`${arg} needs a value`);
  }
  return args;
}
