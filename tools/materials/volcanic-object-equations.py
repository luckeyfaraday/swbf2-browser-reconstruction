"""Independent full material/SH-slice replay of the original Volcanic PS."""
import ast
import importlib.util
import json
import math
from pathlib import Path
import random
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/volcanic-object-shader'
scope = {'math': math, 're': re}
tree = ast.parse((ROOT / 'tools/materials/master1uv-test.py').read_text())
nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in ('Machine', 'sat', 'mix')]
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'source-dxbc-arithmetic', 'exec'), scope)
spec = importlib.util.spec_from_file_location('literal', ROOT / 'tools/materials/master1uv-static-atlas-parity.py')
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
LITERALS = P.Machine(OUT / '750135c350.dxbc')
SHADER = LITERALS.asm


def constant(text):
    LITERALS.literal(text)
    return struct.unpack('<f', struct.pack('<I', LITERALS.literals[text]))[0]


def sample(register, uv):
    u, v = [x % 1 for x in uv]
    return [.5 + .49 * math.sin(register * .739 + channel * 1.913 + u * (channel + 1) * 6.373 + v * 4.197) for channel in range(4)]


scope['sample'] = sample


class Machine(scope['Machine']):
    def read(self, operand):
        if operand.strip().startswith('l('):
            values = [constant(x.strip()) for x in operand.strip()[2:-1].split(',')]
            return values * 4 if len(values) == 1 else values
        return super().read(operand)

    def run(self, lines):
        active = [True]
        for raw in lines:
            line = raw.strip()
            if line.startswith('if_nz '):
                active.append(active[-1] and self.read(line[6:])[0] != 0)
                continue
            if line == 'endif':
                active.pop()
                continue
            if not active[-1]:
                continue
            op, args = line.split(' ', 1)
            args = [x.strip() for x in re.split(r',\s*(?![^()]*\))', args)]
            dst, operands = args[0], args[1:]
            if op.startswith('ld_indexable(buffer)'):
                result = self.coefficients[int(self.read(operands[0])[0])]
            elif op == 'iadd':
                a = self.read(operands[0])
                b = [int(value.strip()) for value in operands[1][2:-1].split(',')]
                assert all(struct.pack('<i', value) in LITERALS.raw for value in b)
                result = [x + y for x, y in zip(a, b)]
            elif op in ['min', 'lt', 'dp4']:
                a, b = [self.read(value) for value in operands]
                result = ([min(x, y) for x, y in zip(a, b)] if op == 'min' else
                          [float(x < y) for x, y in zip(a, b)] if op == 'lt' else [sum(x * y for x, y in zip(a, b))] * 4)
            else:
                super().run([line])
                continue
            name, mask = dst.split('.')
            for channel in mask:
                self.reg[name]['xyzw'.index(channel)] = result['xyzw'.index(channel)]
        assert len(active) == 1


def unit(vector):
    length = math.sqrt(sum(x * x for x in vector))
    return [x / length for x in vector]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def sat(value):
    return max(0, min(1, value))


def prelighting(coefficients, normal, view, smoothness, specular_scale):
    x, y, z = normal
    basis = [1, x, y, z, 3 * y * y - 1, x * y, y * z, x * z, x * x - z * z]
    diffuse = [sum(coefficients[band][channel] * basis[band] for band in range(9)) for channel in range(3)]
    if specular_scale > 0:
        epsilon = constant('0.000010')
        denominator = max(sum(coefficients[0][:3]) * constant('0.333333'), epsilon)
        dominant = [sum(coefficients[band][:3]) * constant('0.233333') / denominator for band in [1, 2, 3]]
        strength = math.sqrt(dot(dominant, dominant))
        light = unit(dominant)
        half = unit([view[i] + light[i] for i in range(3)])
        nv = abs(dot(normal, view)) + epsilon
        nl, nh, lh = sat(dot(normal, light)), sat(dot(normal, half)), sat(dot(light, half))
        smoothness = sat(smoothness)
        alpha2 = max((1 - math.sqrt(smoothness) * strength) ** 2, constant('0.002000')) ** 2
        visibility = .5 / (nl * math.sqrt(nv * nv * (1 - alpha2) + alpha2) + nv * math.sqrt(nl * nl * (1 - alpha2) + alpha2))
        distribution = alpha2 / (1 + nh * nh * (alpha2 - 1)) ** 2
        fresnel = .25 + .75 * (1 - lh) ** 5
        fade = max((.9375 - smoothness) * constant('1.066667'), 0)
        factor = distribution * visibility * fresnel * fade * fade * (3 - 2 * fade) * min(4 * nl, 1)
        diffuse = [diffuse[i] + specular_scale * constant('2.200000') * coefficients[0][i] * factor for i in range(3)]
    return [max(0, value) for value in diffuse]


def equations(uv, position, cb, frame, coefficients, mutation=None):
    base, normal = sample(2, uv), sample(3, uv)
    metal, fabric = sample(4, [uv[i] * cb[0][i] for i in range(2)]), sample(5, [uv[i] * cb[1][i] for i in range(2)])
    alpha = fabric[3] + base[3] * (metal[3] - fabric[3])
    def mapped(texture):
        return unit([sum(frame[row][i] * (texture[i] * 2 - 1) for i in range(3)) for row in range(3)])
    a, b, c = mapped(normal), mapped(metal), mapped(fabric)
    raw = [a[i] + c[i] + base[3] * (b[i] - c[i]) for i in range(3)]
    if mutation == 'earlyNormalize':
        raw = unit(raw)
    color = [2 * base[i] * cb[2][0] * alpha for i in range(3)]
    smoothness, metalness = 2 * normal[3] * alpha, 2 * base[3] * alpha
    view = unit([camera - value for camera, value in zip([7, 3, 2], position)])
    lighting = prelighting(coefficients, raw, view, smoothness, 1 if mutation == 'ignoreSpecularGate' else cb[3][0])
    sky = max(0, coefficients[0][3] + sum(raw[i] * coefficients[i + 1][3] for i in range(3)))
    return [*color, smoothness, metalness, *raw, *unit(raw), *lighting, sky]


def original(uv, position, cb, frame, coefficients):
    machine = Machine(uv, position, frame[0], cb)
    machine.coefficients = coefficients
    machine.reg['v5'] = [0, 0, 0, 0]
    machine.reg['cb2[40]'] = [1, 0, 0, 0]
    for i in range(3):
        machine.reg[f'v{i + 2}'][:3] = frame[i]
    first, split = SHADER.index('mov r0.x, v1.w'), SHADER.index('ld_indexable(buffer)')
    machine.run(SHADER[first:split].strip().splitlines())
    raw, smoothness = machine.reg['r2'][:3], machine.reg['r0'][3]
    end = SHADER.index('ge r1.xy, |r0.zzzz|')
    machine.run(SHADER[split:end].strip().splitlines())
    return [*machine.reg['o1'][:3], smoothness, machine.reg['o2'][1], *raw, *machine.reg['r0'][:3], *machine.reg['o3'][:3], machine.reg['o2'][3]]


def main():
    rng = random.Random(761997209)
    report = json.loads((OUT / 'material-analysis.json').read_text())
    constants = [[c['value'] for c in row['constants']] for row in report['materials']]
    maximum, early, gate = 0, 0, 0
    for case in range(2000):
        uv = [rng.uniform(-4, 5) for _ in range(2)]
        position = [rng.uniform(-1000, 1000) for _ in range(3)]
        cb = constants[case % len(constants)] if case < 1000 else [[rng.uniform(.1, 4) for _ in range(4)] for _ in range(4)]
        frame = [[rng.uniform(-2, 2) for _ in range(3)] for _ in range(3)]
        coefficients = [[rng.uniform(30, 250) if band == 0 else rng.uniform(-15, 15) for _ in range(3)] + [rng.uniform(-.2, .4)] for band in range(9)]
        expected, actual = original(uv, position, cb, frame, coefficients), equations(uv, position, cb, frame, coefficients)
        error = max(abs(a - b) for a, b in zip(expected, actual))
        assert error < 1e-8, (case, error, expected, actual)
        maximum = max(maximum, error)
        wrong = equations(uv, position, cb, frame, coefficients, 'earlyNormalize')
        early += max(abs(a - b) for a, b in zip(actual[-4:-1], wrong[-4:-1])) > .01
        if cb[3][0] == 0:
            wrong = equations(uv, position, cb, frame, coefficients, 'ignoreSpecularGate')
            gate += max(abs(a - b) for a, b in zip(actual[-4:-1], wrong[-4:-1])) > .01
    assert early > 1900 and gate > 150, (early, gate)
    zero_direction = [[5, 8, 12, 0]] + [[0, 0, 0, 0] for _ in range(8)]
    assert prelighting(zero_direction, [0, 2, 0], [1, 0, 0], .2, 0) == [5, 8, 12]
    result = {'evidenceId': 'BF2-VOLCANIC-OBJECT-EQUATIONS-001', 'runtimeObserved': False, 'cases': 2000,
        'maximumAbsoluteError': maximum, 'earlyNormalMutationDetections': early, 'ignoredSpecularGateMutationDetections': gate,
        'literalBits': LITERALS.literals, 'coverage': 'Complete material, actual raw-normal SH polynomial, gated broadened SH term, and GBuffer final normal. Source constants plus adversarial scales and nonunit nonorthogonal tangent frames.',
        'limits': ['CPU double-precision instruction replay using original float32 literal words; not native GPU/FMA/filtering execution.',
            'Source positive-specular path has undefined zero dominant-direction or opposing half-vector normalization; no added epsilon. Zero/negative scale bypasses that path as original.',
            'Source shader arithmetic does not establish live dispatch or browser native tangent correspondence.']}
    (OUT / 'equation-validation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
