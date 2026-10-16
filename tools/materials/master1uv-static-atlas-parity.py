"""Instruction/dataflow parity, with exact float32 constants from original DXBC.

This is symbolic static analysis, not execution of the original shaders.
"""
from pathlib import Path
import hashlib
import json
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/master1uv-static-atlas'
NODES, INTERN = [], {}


def node(op, *args):
    # The two variants emit sat(n)+sat(-n) in opposite operand order.
    # This sole canonicalization commutes one scalar addition; no reassociation.
    if op == 'add' and len(args) == 2 and all(NODES[x][0] == 'saturate' for x in args):
        a, b = (NODES[x][1] for x in args)
        if NODES[a] == ('neg', b) or NODES[b] == ('neg', a):
            args = tuple(sorted(args))
    key = (op, *args)
    if key not in INTERN:
        INTERN[key] = len(NODES)
        NODES.append(key)
    return INTERN[key]


def symbol(name):
    return node('input', name)


class Machine:
    def __init__(self, path, texture_shift=0, sampler_bindings=None):
        self.asm = path.with_suffix('.asm').read_text()
        self.raw = path.read_bytes()
        self.texture_shift = texture_shift
        self.sampler_bindings = sampler_bindings
        self.reg = {f'r{i}': [symbol(f'uninitialized.r{i}.{c}') for c in 'xyzw'] for i in range(16)}
        self.reg.update({f'o{i}': [symbol(f'uninitialized.o{i}.{c}') for c in 'xyzw'] for i in range(4)})
        self.literals = {}

    def set(self, target, values):
        name, mask = target.split('.')
        self.reg.setdefault(name, [symbol(f'uninitialized.{name}.{c}') for c in 'xyzw'])
        for channel, value in zip(mask, values):
            self.reg[name]['xyzw'.index(channel)] = value

    def seed(self, target, names):
        self.set(target, [symbol(name) for name in names])

    def literal(self, text):
        if text not in self.literals:
            value = float(text)
            if value == int(value):
                bits = struct.unpack('<I', struct.pack('<f', value))[0]
                assert struct.pack('<I', bits) in self.raw
            else:
                candidates = {bits for (bits,) in struct.iter_unpack('<I', self.raw)
                              if struct.unpack('<f', struct.pack('<I', bits))[0] == struct.unpack('<f', struct.pack('<I', bits))[0]
                              and format(struct.unpack('<f', struct.pack('<I', bits))[0], '.6f') == text}
                assert len(candidates) == 1, (text, candidates)
                bits = next(iter(candidates))
            self.literals[text] = bits
        return node('float32', self.literals[text])

    def read(self, text):
        if text.startswith('l('):
            values = [self.literal(x.strip()) for x in text[2:-1].split(',')]
            return values * 4 if len(values) == 1 else values
        negative = text.startswith('-')
        if negative:
            text = text[1:]
        absolute = text.startswith('|')
        if absolute:
            text = text[1:-1]
        name, swizzle = text.split('.') if '.' in text else (text, 'xyzw')
        if len(swizzle) == 1:
            swizzle *= 4
        assert len(swizzle) == 4
        values = [self.reg[name]['xyzw'.index(c)] for c in swizzle]
        if absolute:
            values = [node('abs', x) for x in values]
        if negative:
            values = [node('neg', x) for x in values]
        return values

    def run(self, lines):
        branches = []
        for original in lines:
            line = original.strip()
            if line == 'else':
                condition, before, _ = branches[-1]
                branches[-1] = condition, before, {k: v[:] for k, v in self.reg.items()}
                self.reg = {k: v[:] for k, v in before.items()}
                continue
            if line == 'endif':
                condition, before, yes = branches.pop()
                no = self.reg
                self.reg = {k: [a if a == b else node('select', condition, a, b) for a, b in zip(yes[k], no[k])] for k in before}
                continue
            op, args = line.split(' ', 1)
            if op == 'if_nz':
                branches.append((self.read(args)[0], {k: v[:] for k, v in self.reg.items()}, None))
                continue
            args = [x.strip() for x in re.split(r',\s*(?![^()]*\))', args)]
            name, mask = args[0].split('.')
            if op.startswith('sample_'):
                is_array = 'texture2darray' in op
                coordinate = self.read(args[1])[:3 if is_array else 2]
                texture, swizzle = args[2].split('.')
                register = int(texture[1:]) - self.texture_shift
                if self.sampler_bindings is not None:
                    # Use the independently recovered source sampler identity;
                    # register relocation alone does not imply sampler parity.
                    register = f'{register}@{self.sampler_bindings[args[3]]}'
                values = [node('sampleArray' if is_array else 'sample', register, *coordinate, c) for c in swizzle]
            else:
                saturate = op.endswith('_sat')
                if saturate:
                    op = op[:-4]
                operands = [self.read(x) for x in args[1:]]
                if op == 'mov':
                    values = operands[0]
                elif op in ('dp2', 'dp3', 'dp4'):
                    count = int(op[-1])
                    values = [node(op, *operands[0][:count], *operands[1][:count])] * 4
                else:
                    assert op in ('add', 'mul', 'mad', 'log', 'exp', 'div', 'sqrt', 'rsq', 'max', 'min', 'eq'), op
                    values = [node(op, *lane) for lane in zip(*operands)]
                if saturate:
                    values = [node('saturate', value) for value in values]
            self.set(name + '.' + mask, [values['xyzw'.index(c)] for c in mask])
        assert not branches


def section(machine, start, end):
    return machine.asm[machine.asm.index(start):machine.asm.index(end)].strip().splitlines()


def material(machine, atlas):
    uv, pos, normal = ['uv.x', 'uv.y'], ['position.' + c for c in 'xyz'], ['geometricNormal.' + c for c in 'xyz']
    if atlas:
        machine.seed('v2.xyz', pos)
        machine.seed('v3.xyz', normal)
        machine.seed('v7.xy', uv)
    else:
        machine.seed('v1.xyz', pos)
        machine.seed('v1.w', uv[:1])
        machine.seed('v2.xyz', normal)
        machine.seed('v2.w', uv[1:])
    for index in range(3):
        machine.seed(f'v{index + (4 if atlas else 3)}.xyz', [f'TBN.row{index}.{c}' for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    for index in range(9):
        machine.seed(f'cb1[{index}].xyzw', [f'constant{index}.{c}' for c in 'xyzw'])
    machine.run(section(machine, 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1', 'mad r2.x, v1.x' if atlas else 'ld_indexable(buffer)'))
    outputs = {'smoothness': machine.reg['r1'][3], 'normal': machine.reg['r3' if atlas else 'r2'][:3],
               'materialAO': machine.reg['r4' if atlas else 'r5'][3]}
    # The lighting path preserves all material blend operands used by this tail.
    machine.run(section(machine, 'add r1.xyz, cb1[4]', 'mul r0.xyz, r4.wwww' if atlas else 'mul r0.xyz, r5.wwww'))
    outputs.update({'albedo': machine.reg['o1'][:3], 'metalness': machine.reg['o2'][1]})
    return outputs


def atlas_kernel(machine, master):
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r1.w', ['smoothness'])
    machine.seed('r3.xyz' if master else 'r4.xyz', ['normal.' + c for c in 'xyz'])
    machine.seed('r5.xyz' if master else 'r3.yzw', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r7.xyw', 'r8.xyz', 'r9.xyz'] if master else ['r5.xyz', 'r6.xyz', 'r7.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.{c}' for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    start = 'mul r10.xyz, r7.xywx' if master else 'mul r8.xyz, r5.xyzx'
    machine.run(section(machine, start, 'sample_indexable(texture2d)(float,float,float,float) r0.w, r2.xyxx, t6'))
    return machine.reg['r0'][:3]


def digest(values):
    # Hash a stable reachable DAG rather than exponentially expanded expression trees.
    cache = {}
    def hashed(index):
        if index not in cache:
            op, *args = NODES[index]
            if op in ('float32', 'input'):
                encoded = [op, *args]
            elif op == 'sample':
                encoded = [op, args[0], hashed(args[1]), hashed(args[2]), args[3]]
            elif op == 'sampleArray':
                encoded = [op, args[0], hashed(args[1]), hashed(args[2]), hashed(args[3]), args[4]]
            else:
                encoded = [op, *[hashed(x) for x in args]]
            cache[index] = hashlib.sha256(json.dumps(encoded).encode()).hexdigest()
        return cache[index]
    return [hashed(value) for value in values] if isinstance(values, list) else hashed(values)


def assert_initialized(values):
    pending = list(values) if isinstance(values, list) else [values]
    seen = set()
    while pending:
        index = pending.pop()
        if index in seen:
            continue
        seen.add(index)
        op, *args = NODES[index]
        if op == 'input':
            assert not args[0].startswith('uninitialized.'), args[0]
        elif op == 'sample':
            pending.extend(args[1:3])
        elif op == 'sampleArray':
            pending.extend(args[1:4])
        elif op != 'float32':
            pending.extend(args)


def main():
    regular = Machine(ROOT / 'exports/materials/master1uv-shader/6d0dd89b35.dxbc')
    atlas = Machine(ROOT / 'exports/materials/master1uv-shader/965fbe264b.dxbc', texture_shift=5)
    old, new = material(regular, False), material(atlas, True)
    assert old == new, {k: (old[k], new[k]) for k in old if old[k] != new[k]}
    for values in old.values():
        assert_initialized(values)
    floor = Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    master = Machine(ROOT / 'exports/materials/master1uv-shader/965fbe264b.dxbc')
    floor_result, master_result = atlas_kernel(floor, False), atlas_kernel(master, True)
    assert floor_result == master_result, (floor_result, master_result)
    assert_initialized(floor_result)
    result = {'evidenceId': 'BF2-MASTER1UV-STATIC-ATLAS-PARITY-001', 'runtimeObserved': False,
              'method': 'Lane-level symbolic original text-DXBC instruction dataflow; exact unique float32 literal words verified against each original DXBC. Only sat(n)+sat(-n) operand exchange is canonicalized for geometric-normal components; no reassociation or random samples.',
              'materialExpressionsEqual': {k: digest(value) for k, value in old.items()},
              'atlasRGBExpressionsEqual': digest(floor_result), 'uniqueSymbolicNodes': len(NODES),
              'literalMaps': {name: machine.literals for name, machine in [('ordinary', regular), ('atlasMaterial', atlas), ('floorKernel', floor), ('masterKernel', master)]},
              'limitations': ['Static symbolic equivalence covers scoped arithmetic and source register routing, not sampler filtering, hardware scheduling or GBuffer quantization.',
                              'Inputs to the common atlas kernel are decoded directions, normalized final world normal, normalized view and raw source smoothness. Master1UV material AO is a separate subsequent multiply.',
                              'Native branch conditions are preserved symbolically, including the zero-length per-channel directional fallback. Native undefined average/half-vector normalization is not repaired.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'binding-evidence.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-MASTER1UV-STATIC-ATLAS-RECIPE-001',
        'family': 'master1uv', 'shaderName': binding['shaderName'],
        'pixelShader': binding['pixelShader'], 'pixelShaderSha256': binding['pixelShaderSha256'],
        'bindingEvidence': 'exports/materials/master1uv-static-atlas/binding-evidence.json',
        'parityEvidence': 'exports/materials/master1uv-static-atlas/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting',
            'equivalence': 'Identical symbolic lane-level instruction expressions with exact original float32 literal bits; no kernel algebraic canonicalization needed.'},
        'atlasRegisters': {row['register']: row['producer']['name'] for row in binding['functionInstances'][0]['textureMapping'] if 'producer' in row},
        'normal': {'nativeVariable': 'r3.xyz after dp3/rsq/mul normalization of TBN-mapped material normal',
            'space': 'source world', 'normalized': True,
            'browserExpression': 'inverseTransformDirection(geometryNormal, viewMatrix)',
            'stage': 'After source normal-map/TBN material evaluation; geometric grunge normal is not this input.'},
        'smoothness': {'nativeVariable': 'r1.w, also written unmodified to o0.z',
            'browserExpression': 'bf2_master_surface.smoothness',
            'kernelOperation': 'saturate raw source smoothness; do not supply Three roughness'},
        'materialAO': {'source': 't10.a (normalAO; ordinary t5.a)', 'nativeVariable': 'r4.w',
            'browserExpression': 'bf2_master_surface.ao', 'applications': 1,
            'scope': 'Multiply entire atlas prelighting RGB, including directional diffuse and broadened baked specular, before frame exposure.',
            'existingHook': 'reflectedLight.indirectDiffuse *= bf2_master_surface.ao;',
            'doNotMultiplyInsideAtlasHelper': True},
        'gbuffer': {'materialID': 0, 'metalness': 'unchanged material expression in o2.y', 'reflectance': 0.5,
            'skyVisibility': 't6.r written directly to o2.w; no material-AO multiplication or additional clamp',
            'prelighting': 'o3.rgb = commonAtlasKernel * materialAO * cb2[40].x',
            'prelightingFinalMaxZero': False},
        'uv': {'sourceAttribute': 'RadiosityTexCoord',
            'pixelExpression': ['v1.x * v2.w + v7.z', 'v1.w * v3.w + v7.w'],
            'layoutPolicy': 'Use original-size compressed atlas and source affine transform, with no cropping or UV rebasing.'},
        'materialParity': ['albedo', 'raw smoothness', 'final normalized world normal', 'metalness', 'normalAO alpha'],
        'runtimeObserved': False,
        'limitations': ['Native pass activation is static RVM evidence, not a recorded original-game frame.',
            'Browser TBN/world coordinate mapping remains the independently validated adapter boundary; material/kernel parity does not validate a different tangent frame.',
            'Exact compressed sampling and LightMapPreExposure come from the separate floor/original-atlas recovery.']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'atlasRGBEqual': floor_result == master_result, 'symbolicNodes': len(NODES)}))


if __name__ == '__main__':
    main()
