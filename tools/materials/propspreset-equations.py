"""Compact equations independently compared with four original material PS paths."""
import ast
import json
import math
from pathlib import Path
import random
import re

ROOT = Path(__file__).resolve().parents[2]
SHADERS = ROOT / 'exports/materials/propspreset-shader'
OUT = ROOT / 'exports/materials/propspreset-routing'
scope = {'math': math, 're': re}
tree = ast.parse((ROOT / 'tools/materials/master1uv-test.py').read_text())
nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in ('Machine', 'sat', 'mix')]
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'shared-dxbc-arithmetic', 'exec'), scope)
tree = ast.parse((ROOT / 'tools/materials/array2uv-test.py').read_text())
nodes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'ArrayMachine']
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'shared-array-instruction', 'exec'), scope)


def sample(register, uv):
    u, v = uv[0] % 1, uv[1] % 1
    return [.5 + .49 * math.sin(register * .739 + channel * 1.913 + u * (channel + 1) * 6.373 + v * 4.197) for channel in range(4)]


def array_sample(coords):
    # Deterministic discrete fixture, not a claim about native tie behavior.
    layer = min(9, max(0, math.floor(coords[2] + .5)))
    return sample(4 + layer * .461, coords[:2])


scope['sample'], scope['array_sample'] = sample, array_sample
Machine = scope['ArrayMachine']
PIXELS = {'clampAll': 'c13680b516', 'clampVertical': '93681d7ffd', 'emissiveTwoUV': '3352783e34', 'lodSimple': '34120bd05e'}


def equations(family, uv0, uv1, cb, frame, prelighting):
    emissive, lod = family == 'emissiveTwoUV', family == 'lodSimple'
    base_uv = uv1 if emissive else uv0
    normal_uv = [uv0[0], max(0, min(1, uv0[1]))]
    if family in ['clampAll', 'emissiveTwoUV']:
        normal_uv[0] = max(0, min(1, normal_uv[0]))
    cs, nam = sample(2, base_uv), sample(3, base_uv)
    normal_xy = [2 * value - 1 for value in sample(3, normal_uv)[:2]]
    if lod:
        detail = [0.5, 0.5, 1]
        color = [2 * cs[i] * cb[0][i] for i in range(3)]
        smoothness = cs[3]
    else:
        scale = cb[3 if emissive else 0]
        detail = array_sample([uv0[i] * scale[i] for i in range(2)] + [nam[2] * 10])
        color = [4 * cs[i] * detail[2] * cb[4 if emissive else 1][i] for i in range(3)]
        smoothness = 2 * detail[2] * cs[3]
    tangent = [normal_xy[i] + (2 * detail[i] - 1 if not lod else 0) for i in range(2)]
    tangent.append(math.sqrt(max(0, 1 - sum(value * value for value in normal_xy))))
    normal = [sum(row[i] * tangent[i] for i in range(3)) for row in frame]
    length = math.sqrt(sum(value * value for value in normal))
    normal = [value / length for value in normal]
    metal = cb[2][0] if emissive else nam[3]
    emission = [nam[3] * cb[0][i] * cb[1][0] for i in range(3)] if emissive else [0, 0, 0]
    return [*color, smoothness, *normal, metal, *[prelighting[i] + emission[i] for i in range(3)]]


def original(family, uv0, uv1, cb, frame, prelighting):
    shader = (SHADERS / (PIXELS[family] + '.asm')).read_text()
    prefix = shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines()
    machine = Machine(uv0, [0, 0, 0], [1, 0, 0], cb)
    machine.reg.update({f'v{i + 2}': [*frame[i], [uv0[1], uv1[0], uv1[1]][i]] for i in range(3)})
    machine.run(prefix)
    normal = machine.reg['r4' if family in ['emissiveTwoUV', 'lodSimple'] else 'r5'][:3]
    smoothness = machine.reg['r3'][3] if family == 'lodSimple' else machine.reg['r1'][3]
    metal = cb[2][0] if family == 'emissiveTwoUV' else machine.reg['r2'][1 if family == 'clampVertical' else 3]
    start = ('mul r1.xyz, r2.yyyy, cb1[0].xyzx' if family == 'emissiveTwoUV' else
             'mul r1.xyz, r3.xyzx, cb1[0].xyzx' if family == 'lodSimple' else 'mul r1.xyz, r3.xyzx, r4.zzzz')
    color = shader[shader.index(start):shader.index('mul o3.xyz')].strip().splitlines()
    machine.reg['r0'][:3] = prelighting
    machine.run(color)
    if family == 'lodSimple':
        metal = machine.reg['r0'][3]
    return [*machine.reg['o1'][:3], smoothness, *normal, metal, *machine.reg['r0'][:3]]


def main():
    rng = random.Random(3130653852)
    maximum, count, clamp_mutations, uv_mutations = 0, 0, 0, 0
    for family in PIXELS:
        for _ in range(1000):
            uv0, uv1 = [[rng.uniform(-4, 5) for _ in range(2)] for _ in range(2)]
            cb = [[rng.uniform(-2, 5) for _ in range(4)] for _ in range(5)]
            frame = [[rng.uniform(-2, 2) for _ in range(3)] for _ in range(3)]
            prelighting = [rng.uniform(-2, 5) for _ in range(3)]
            a, z = equations(family, uv0, uv1, cb, frame, prelighting), original(family, uv0, uv1, cb, frame, prelighting)
            error = max(abs(x - y) for x, y in zip(a, z))
            assert error < 1e-10, (family, error)
            maximum, count = max(maximum, error), count + 1
            if family == 'clampVertical':
                wrong = equations('clampAll', uv0, uv1, cb, frame, prelighting)
                clamp_mutations += max(abs(x - y) for x, y in zip(a, wrong)) > .01
            if family == 'emissiveTwoUV':
                wrong = equations(family, uv0, uv0, cb, frame, prelighting)
                uv_mutations += max(abs(x - y) for x, y in zip(a, wrong)) > .01
    assert clamp_mutations > 500 and uv_mutations > 950
    result = {'evidenceId': 'BF2-PROPSPRESET-EQUATIONS-001', 'runtimeObserved': False,
        'cases': count, 'maximumAbsoluteError': maximum, 'normalClampMutationsDetected': clamp_mutations,
        'twoUvCollapsedMutationsDetected': uv_mutations, 'pixelShaders': PIXELS,
        'coverage': 'Four selected source material paths, wrap sampling plus explicit normal clamp, two independent UV pairs, typed 10-layer array, nonunit/nonorthogonal TBN rows, unrestricted constants, exact mask channels and prelighting emission.',
        'limitations': ['CPU double-precision instruction replay with deterministic analytic texture fixtures, not native float32/FMA or texture filtering execution.', 'Array rounding fixture is explicit and does not establish native tie semantics.']}
    (OUT / 'equation-validation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
