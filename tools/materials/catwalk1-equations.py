"""Original text-DXBC against compact material equations and adverse fixtures."""
import ast
import json
import math
from pathlib import Path
import random
import re

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/catwalk1-shader'
scope = {'math': math, 're': re}
tree = ast.parse((ROOT / 'tools/materials/master1uv-test.py').read_text())
nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in ('Machine', 'sat', 'mix')]
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'original-dxbc-interpreter', 'exec'), scope)


def sample(register, uv, force_wrap=False):
    u, v = [max(0, min(1, x)) for x in uv] if register == 3 and not force_wrap else [x % 1 for x in uv]
    return [.5 + .49 * math.sin(register * .739 + channel * 1.913 + u * (channel + 1) * 6.373 + v * 4.197) for channel in range(4)]


scope['sample'] = sample
Machine = scope['Machine']
SHADER = (OUT / 'd260c7f82c.asm').read_text()
PREFIX = SHADER[SHADER.index('add r0.xyz, -v1'):SHADER.index('ld_indexable(buffer)')].strip().splitlines()


def unit(vector):
    length = math.sqrt(sum(x * x for x in vector))
    return [x / length for x in vector]


def equations(uv, position, scale, frame, mutation=None):
    cs = sample(2, uv)
    nw = sample(3, uv, force_wrap=mutation == 'wrapNW')
    detail = sample(4, [uv[i] * scale[i] for i in range(2)])
    grunge_uv = uv if mutation == 'uvGrunge' else [position[0] * .1, position[2] * .1]
    grunge = sample(5, grunge_uv)
    xy = [value * 2 - 1 for value in detail[:2]]
    zxy = [value * 2 - 1 for value in nw[:2]] if mutation == 'wrongNormalZ' else xy
    tangent = unit([xy[i] + 2 * nw[i] - 1 for i in range(2)] + [math.sqrt(max(0, 1 - sum(x * x for x in zxy)))])
    normal = unit([sum(frame[row][i] * tangent[i] for i in range(3)) for row in range(3)])
    smoothness = cs[3] if mutation == 'dropSmoothnessFactors' else cs[3] * grunge[3] * detail[2]
    return [*[cs[i] * grunge[i] for i in range(3)], smoothness, *normal, *tangent]


def original(uv, position, scale, frame):
    machine = Machine(uv, position, frame[0], [scale])
    for i in range(3):
        machine.reg[f'v{i + 2}'][:3] = frame[i]
    # Inspect the original normalized tangent immediately before its first TBN dot.
    split = PREFIX.index('dp3 r5.x, r2.xyzx, v2.xyzx')
    machine.run(PREFIX[:split])
    tangent = machine.reg['r2'][:3]
    machine.run(PREFIX[split:])
    machine.run(['mul o1.xyz, r3.xyzx, r4.xyzx'])
    return [*machine.reg['o1'][:3], machine.reg['r1'][3], *machine.reg['r2'][:3], *tangent]


def main():
    rng = random.Random(2105226253)
    maximum = 0
    mutations = {name: 0 for name in ['wrapNW', 'uvGrunge', 'wrongNormalZ', 'dropSmoothnessFactors']}
    scales = [row['constant']['value'] for row in json.loads((OUT / 'material-analysis.json').read_text())['materials']]
    for case in range(3000):
        uv = [rng.uniform(-4, 5) for _ in range(2)]
        position = [rng.uniform(-1200, 800) for _ in range(3)]
        scale = scales[case % len(scales)] if case < 1500 else [rng.uniform(-2, 8) for _ in range(4)]
        frame = [[rng.uniform(-2, 2) for _ in range(3)] for _ in range(3)]
        expected, actual = original(uv, position, scale, frame), equations(uv, position, scale, frame)
        error = max(abs(a - b) for a, b in zip(expected, actual))
        assert error < 1e-10, (case, error)
        maximum = max(maximum, error)
        for mutation in mutations:
            wrong = equations(uv, position, scale, frame, mutation)
            mutations[mutation] += max(abs(a - b) for a, b in zip(actual, wrong)) > .01
    assert all(count > 1000 for count in mutations.values()), mutations
    result = {'evidenceId': 'BF2-CATWALK1-EQUATIONS-001', 'runtimeObserved': False, 'cases': 3000,
        'maximumAbsoluteError': maximum, 'mutationDetections': mutations,
        'coverage': 'Source constants and adversarial constants; out-of-range UV0; separate native clamp/wrap fixtures; source world XZ grunge; nonunit nonorthogonal TBN; both normalizations.',
        'limitations': ['Independent CPU double-precision instruction replay with analytic textures, not original GPU float32/FMA/filtering execution.']}
    (OUT / 'equation-validation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
