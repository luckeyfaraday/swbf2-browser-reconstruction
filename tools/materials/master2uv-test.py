"""Independent numeric comparison: DXBC text instructions versus compact equations.

This is NOT native execution. Texture reads use deterministic analytic fixtures,
including UV-dependent values, so sampling frequency/channel errors are visible.
"""
import json, math, pathlib, random, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/master2uv-shader'
shader = (OUT / '2304f89b0d.asm').read_text()
report = json.loads((OUT / 'material-analysis.json').read_text())

def sat(x): return max(0, min(1, x))
def mix(a, b, t): return a + t * (b - a)
def sample(register, uv):
    # Smooth, nonconstant, channel-distinct packed data. Linear UV domain.
    return [0.5 + 0.45 * math.sin(register * .739 + channel * 1.913 + uv[0] * (channel + 1) * .373 + uv[1] * .197)
            for channel in range(4)]

class Machine:
    def __init__(self, base_uv, uv, pos, normal, cb):
        self.reg = {f'r{i}': [0.] * 4 for i in range(16)}
        self.reg.update({f'o{i}': [0.] * 4 for i in range(4)})
        self.reg.update({'v1': [*pos, base_uv[0]], 'v2': [*normal, base_uv[1]],
                         'v3': [1, 0, 0, uv[0]], 'v4': [0, 1, 0, uv[1]], 'v5': [0, 0, 1, 0],
                         'cb2[37]': [7, 3, 2, 0]})
        self.reg.update({f'cb1[{i}]': value[:] for i, value in enumerate(cb)})

    def read(self, operand):
        operand = operand.strip()
        if operand.startswith('l('):
            a = [float(x) for x in operand[2:-1].split(',')]
            return a * 4 if len(a) == 1 else a
        sign = -1 if operand.startswith('-') else 1
        if sign < 0: operand = operand[1:]
        absolute = operand.startswith('|')
        if absolute: operand = operand[1:-1]
        name, swizzle = operand.split('.') if '.' in operand else (operand, 'xyzw')
        if len(swizzle) == 1: swizzle *= 4
        assert len(swizzle) == 4, operand
        return [sign * (abs(self.reg[name]['xyzw'.index(c)]) if absolute else self.reg[name]['xyzw'.index(c)]) for c in swizzle]

    def run(self, lines):
        for line in lines:
            op, args = line.split(' ', 1)
            args = [x.strip() for x in re.split(r',\s*(?![^()]*\))', args)]
            dst = args[0]
            name, mask = dst.split('.')
            if op.startswith('sample_'):
                coord = self.read(args[1])
                tex, swizzle = args[2].split('.')
                values = sample(int(tex[1:]), coord[:2])
                result = [values['xyzw'.index(c)] for c in swizzle]
            else:
                saturate = op.endswith('_sat')
                if saturate: op = op[:-4]
                a = [self.read(x) for x in args[1:]]
                if op == 'mov': result = a[0]
                elif op == 'add': result = [x + y for x, y in zip(*a)]
                elif op == 'mul': result = [x * y for x, y in zip(*a)]
                elif op == 'mad': result = [x * y + z for x, y, z in zip(*a)]
                elif op == 'div': result = [x / y for x, y in zip(*a)]
                elif op in ('dp2', 'dp3'): result = [sum(a[0][j] * a[1][j] for j in range(int(op[-1])))] * 4
                elif op == 'log': result = [math.log2(x) for x in a[0]]
                elif op == 'exp': result = [2 ** x for x in a[0]]
                elif op == 'sqrt': result = [math.sqrt(x) for x in a[0]]
                elif op == 'rsq': result = [1 / math.sqrt(x) for x in a[0]]
                elif op == 'max': result = [max(x, y) for x, y in zip(*a)]
                else: raise AssertionError(op)
                if saturate: result = [sat(x) for x in result]
            for c in mask:
                self.reg[name]['xyzw'.index(c)] = result['xyzw'.index(c)]

def formula(base_uv, uv, pos, normal, cb):
    q = [uv[i] * cb[1][i] for i in range(2)]
    a, d, rh, r, m, mn = [sample(reg, [v * scale for v in q]) for reg, scale in [(12, 1), (8, 1), (9, .5), (9, 1), (10, 1), (11, 2)]]
    ids, w, g, base = sample(5, uv), sample(4, uv), sample(3, [v * 3 for v in q]), sample(6, uv)
    scratch, dirt, restore = w[0] * (.48 + 1.04 * g[2]), 2 * w[1] * g[3], sat(2 * g[1] * w[3] / cb[2][0])
    s0 = mix(.8 * a[3], d[3] * cb[5][0], ids[2])
    s0 = mix(s0, rh[3] * cb[7][0], ids[1])
    s0 = mix(s0, 2 * m[1] ** 1.5, ids[0])
    s = mix(s0, .042311, scratch)
    s = mix(s, s0 + 1, dirt)
    s = mix(s, .007499, w[2])
    s = mix(s, .8 * a[3], restore)
    grunge = mix(sample(7, [pos[0] * .1, pos[1] * .1])[1], sample(7, [pos[2] * .1, pos[1] * .1])[1], sat(2 * abs(normal[0]) - 1))
    s = mix(s + .2, s, (1 - grunge) * (1 - abs(normal[1])))
    c = [mix(.323143, cb[4][j], ids[2]) for j in range(3)]
    for target, weight in [(cb[6], ids[1]), (cb[8], ids[0]), (cb[3], scratch), ([.171441] * 3, dirt), (cb[0], w[2]), ([.323143] * 3, restore)]:
        c = [mix(v, target[j], weight) for j, v in enumerate(c)]
    detail = [2 * v - 1 for v in a[:2]]
    for target, weight in [(d[:2], ids[2]), (r[:2], ids[1]), ([mn[0] * mn[3], mn[1]], ids[0]), (a[:2], w[0] + w[1])]:
        detail = [mix(v, 2 * target[j] - 1, weight) for j, v in enumerate(detail)]
    xy = [2 * v - 1 for v in sample(2, base_uv)[:2]]
    n = [xy[0] + 2*base[0]-1 + detail[0], xy[1] + 2*base[1]-1 + detail[1], math.sqrt(max(1 - sum(v * v for v in xy), 0))]
    length = math.sqrt(sum(v * v for v in n))
    n = [v / length for v in n]
    scalar = mix(.9 * (1 - ids[1]), .5 * m[0], ids[0])
    enhanced = sat(scalar + .7)
    scalar = mix(scalar, .15, scratch)
    scalar = mix(scalar, enhanced, dirt)
    scalar = mix(scalar, .9, restore)
    return [*c, s, *n, scalar, base[3]]

prefix = shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines()
color = shader[shader.index('add r1.xyz, cb1[4]'):shader.index('mul r0.xyz, r9.zzzz')].strip().splitlines()
rng = random.Random(0x2187307923)
max_error = 0
cases = 2400
for case in range(cases):
    uv = [rng.uniform(-20, 20) for _ in range(2)]
    base_uv = [rng.uniform(-20, 20) for _ in range(2)]
    pos = [rng.uniform(-500, 500) for _ in range(3)]
    normal = [rng.uniform(-1, 1) for _ in range(3)]
    # A perspective interpolation of unit vertex normals generally has length
    # below one. The PS consumes this directly for grunge without renormalizing.
    vertices = [[rng.uniform(-1, 1) for _ in range(3)] for _ in range(3)]
    vertices = [[v / math.sqrt(sum(x*x for x in row)) for v in row] for row in vertices]
    weights = [rng.random() for _ in range(3)]
    total = sum(weights)
    normal = [sum(weights[i] * vertices[i][j] for i in range(3)) / total for j in range(3)]
    cb = report['materials'][case % 8]['constants']
    assert cb[2][0] > 0
    machine = Machine(base_uv, uv, pos, normal, cb)
    machine.run(prefix)
    smoothness, world_normal, ao = machine.reg['r1'][3], machine.reg['r2'][:3], machine.reg['r9'][2]
    machine.run(color)
    observed = [*machine.reg['o1'][:3], smoothness, *world_normal, machine.reg['o2'][1], ao]
    expected = formula(base_uv, uv, pos, normal, cb)
    error = max(abs(a - b) for a, b in zip(observed, expected))
    assert error < 1e-10, (case, error, observed, expected)
    max_error = max(max_error, error)
result = {'evidenceId': 'LOCAL-MASTER2UV-EQUATIONS-001', 'parentEvidenceId': report['evidenceId'],
          'shader': '2304f89b0d', 'cases': cases, 'maxAbsoluteError': max_error,
          'coverage': 'color RGB, smoothness, normalized tangent-normal under identity TBN, native o2.y scalar, AO; UV-dependent samples; all eight per-section constants; independent original UV0/UV1; nonunit interpolated geometric normals retained for grunge',
          'limitations': ['Text-disassembly arithmetic interpreter, not native execution or bit-exact IEEE32/FMA emulation.',
                          'Checks compact algebra and UV/channel routing against source assembly, not live GPU sampler/filter/color-space behavior.',
                          'GLSL uses exact recovered float literals; interpreter equivalence uses the six-decimal disassembler literals on both sides.']}
(OUT / 'equation-validation.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
