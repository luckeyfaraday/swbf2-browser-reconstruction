// BF2-NATIVE-REFLECTION-VOLUME-001. This consumes the native 224-byte runtime
// record, NOT an EBX entity matrix. The entity-to-record conversion is unknown.
export const SOURCE_REFLECTION_VOLUME_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-REFLECTION-VOLUME-001',
  builder: 'Original CPU function 0x140f86570 packs LocalIBLLightInfo, 192 bytes.',
  transform: 'Normalize all three basis columns; reverse right if the determinant is negative; build a camera-relative rigid inverse.',
  order: 'The observed main CPU path sorts positive volume-size keys ascending before upload. GPU tile-list order and equal-key order remain unresolved.',
  input: 'Requires explicit native runtime fields. Mapping EBX scale, LocalOffset and influence fields to this runtime structure is not established.',
});

const FADE_EPSILON = Math.fround(.0001);
const RADIUS_MARGIN = Math.fround(.01);
const FOUR_PI = 12.566370964050293;
const THIRD = .3333333432674408;
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

function finiteArray(value, length, name) {
  if (!value || value.length !== length || !Array.from(value).every(Number.isFinite)) {
    throw new Error(`Invalid native reflection ${name}`);
  }
  return Array.from(value);
}

export function decodeNativeReflectionRuntimeRecord(buffer, byteOffset = 0) {
  if (!(buffer instanceof ArrayBuffer) || !Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset + 224 > buffer.byteLength) {
    throw new Error('Invalid native reflection runtime record range');
  }
  const view = new DataView(buffer, byteOffset, 224);
  const vector = (offset, count = 3) => Array.from({length: count}, (_, i) => view.getFloat32(offset + i*4, true));
  return {
    transform: vector(0, 16), extent: vector(0x40), localOffset: vector(0x50),
    sideFadePos: vector(0x60), sideFadeNeg: vector(0x70), influenceFadeAnchor: vector(0x80),
    textureIndex: view.getUint16(0x90, true), type: view.getInt32(0x98, true),
    useProxyReprojection: view.getUint8(0xa4) !== 0,
    useSkyVisibilityAsAO: view.getUint8(0xa5) !== 0,
    useSkyVisibilityAsMask: view.getUint8(0xa6) !== 0,
    skySharpenInput: view.getFloat32(0xa8, true), skyBiasInput: view.getFloat32(0xac, true),
    influenceFadeDistance: view.getFloat32(0xb8, true), influenceExpandDistance: view.getFloat32(0xbc, true),
  };
}

// Return three row vectors [xyz, translation] exactly matching the native
// shader's dot4 transform. Scale is removed, but shear is not orthogonalized.
export function sourceReflectionInverseRows(transform, cameraOrigin = [0, 0, 0]) {
  const matrix = finiteArray(transform, 16, 'transform');
  const camera = finiteArray(cameraOrigin, 3, 'camera origin');
  const axes = [matrix.slice(0, 3), matrix.slice(4, 7), matrix.slice(8, 11)];
  const lengths = axes.map(axis => Math.sqrt(dot(axis, axis)));
  if (lengths.some(length => length === 0)) throw new Error('Degenerate native reflection transform');
  const determinant = dot(cross(axes[0], axes[1]), axes[2]);
  const rotation = axes.map((axis, index) => axis.map(value => value / lengths[index]));
  if (determinant < 0) rotation[0] = rotation[0].map(value => -value);
  const relativePosition = matrix.slice(12, 15).map((value, index) => value - camera[index]);
  return rotation.map(axis => [...axis, -dot(axis, relativePosition)]);
}

export function sourceReflectionVolumeSortKey(record) {
  const extent = finiteArray(record.extent, 3, 'extent');
  if (extent.some(value => value < 0)) throw new Error('Negative native reflection extent');
  // Native keys are stored as positive float32 then compared as unsigned bits.
  const e = extent.map(Math.fround), multiply = (a, b) => Math.fround(a*b);
  const value = record.type === 0 ? multiply(multiply(multiply(multiply(e[0], FOUR_PI), e[0]), e[0]), THIRD)
    : multiply(multiply(multiply(multiply(multiply(e[0], 2), 2), e[1]), 2), e[2]);
  const float = new Float32Array([value]);
  return {volume: float[0], unsignedBits: new Uint32Array(float.buffer)[0]};
}

export function buildSourceReflectionLightInfo(record, cameraOrigin = [0, 0, 0]) {
  const transform = finiteArray(record.transform, 16, 'transform');
  const camera = finiteArray(cameraOrigin, 3, 'camera origin');
  const extent = finiteArray(record.extent, 3, 'extent');
  const localOffset = finiteArray(record.localOffset, 3, 'local offset');
  const sideFadePos = finiteArray(record.sideFadePos, 3, 'positive side fade');
  const sideFadeNeg = finiteArray(record.sideFadeNeg, 3, 'negative side fade');
  const anchor = finiteArray(record.influenceFadeAnchor, 3, 'influence fade anchor');
  const scalars = [record.textureIndex, record.type, record.influenceFadeDistance,
    record.influenceExpandDistance, record.skySharpenInput, record.skyBiasInput];
  if (!scalars.every(Number.isFinite) || extent.some(value => value < 0)) throw new Error('Invalid native reflection fields');
  const expand = record.influenceExpandDistance, fade = record.influenceFadeDistance;
  const expanded = extent.map(value => value + expand);
  const radius = (record.type === 0 ? expanded[0] : Math.sqrt(dot(expanded, expanded))) + RADIUS_MARGIN;
  const rows = sourceReflectionInverseRows(transform, camera);
  const scale = 1 + 10 * record.skySharpenInput;
  const packed = new Float32Array(48);
  packed.set([...transform.slice(12, 15).map((value, i) => value-camera[i]), radius*radius], 0);
  rows.forEach((row, i) => packed.set(row, 4+i*4));
  packed.set([...extent, record.textureIndex], 16);
  packed.set([...expanded, 1/Math.max(fade, FADE_EPSILON)], 20);
  packed.set([...sideFadePos, fade], 24);
  packed.set([...sideFadeNeg, record.type], 28);
  packed.set([...localOffset, expand], 32);
  packed.set([...anchor.map((value, i) => value-(record.type === 0 ? extent[i] : expanded[i])), record.useSkyVisibilityAsAO ? 0 : 1], 36);
  packed.set([...expanded.map(value => value-fade), record.useSkyVisibilityAsMask ? 0 : 1], 40);
  packed.set([scale, -(scale-1)*record.skyBiasInput, record.useProxyReprojection ? 0 : 1, 0], 44);
  return packed;
}
