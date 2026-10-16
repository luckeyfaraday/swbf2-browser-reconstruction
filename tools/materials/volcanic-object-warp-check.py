"""Create bounded original-PS fixture inputs, then compare retained WARP MRTs."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/volcanic-object-shader'
SPEC = importlib.util.spec_from_file_location('equations', Path(__file__).with_name('volcanic-object-equations.py'))
E = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(E)
SHA = lambda data: hashlib.sha256(data).hexdigest()


def fixture():
    rng = random.Random(0x750135)
    cases = []
    for index in range(96):
        frame = [[rng.uniform(.5, 1.5) if i == j else rng.uniform(-.35, .35) for j in range(3)] for i in range(3)]
        frame[0] = [value * (-1 if index % 3 == 0 else 1) for value in frame[0]]
        position = [rng.uniform(-12, 12) for _ in range(3)]
        uv = [.25, .75]
        cb = [[2, 8, 0, 0], [4, 16, 0, 0], [rng.uniform(.2, 2), 0, 0, 0], [[0, 1, -1, 2][index % 4], 0, 0, 0]]
        textures = [[rng.uniform(.05, .95) for _ in range(4)] for _ in range(4)]
        coefficients = [[rng.uniform(20, 200) if band == 0 else rng.uniform(-15, 15) for _ in range(3)] + [rng.uniform(-.2, .4)] for band in range(9)]
        if index == 0:
            coefficients = [[5, 8, 12, 1]] + [[0, 0, 0, 0] for _ in range(8)]
        values = sum(frame, []) + position + uv + sum(cb, []) + sum(textures, []) + sum(coefficients, [])
        assert len(values) == 82
        cases.append(struct.pack('<82f', *values))
    raw = struct.pack('<III', 0x314f5650, len(cases), 82) + b''.join(cases)
    (OUT / 'warp-input.bin').write_bytes(raw)
    print(json.dumps({'cases': len(cases), 'inputSha256': SHA(raw), 'inputBytes': len(raw)}))


def expected(values):
    frame, position, uv = [values[i:i + 3] for i in [0, 3, 6]], values[9:12], values[12:14]
    cb = [values[i:i + 4] for i in range(14, 30, 4)]
    textures = [values[i:i + 4] for i in range(30, 46, 4)]
    coefficients = [values[i:i + 4] for i in range(46, 82, 4)]
    E.sample = E.scope['sample'] = lambda register, uv: textures[register - 2]
    original, compact = E.original(uv, position, cb, frame, coefficients), E.equations(uv, position, cb, frame, coefficients)
    assert max(abs(a - b) for a, b in zip(original, compact)) < 1e-8
    x, y, z = compact[8:11]
    if abs(z) >= abs(x) and abs(z) >= abs(y):
        face, u, v = (5 if z < 0 else 4), (-x if z < 0 else x), -y
    elif abs(y) >= abs(x):
        face, u, v = (3 if y < 0 else 2), x, (-z if y < 0 else z)
    else:
        face, u, v = (1 if x < 0 else 0), (z if x < 0 else -z), -y
    return [u * .5 + .5, v * .5 + .5, compact[3], 0, *compact[:3], face * E.constant('0.166667'),
            0, compact[4], .5, compact[14], *compact[11:14], 0]


def check():
    inputs, outputs = (OUT / 'warp-input.bin').read_bytes(), (OUT / 'warp-output.bin').read_bytes()
    report = json.loads((OUT / 'warp-execution.json').read_text())
    assert report['inputSha256'] == SHA(inputs) and report['outputSha256'] == SHA(outputs)
    assert report['pixelShaderSha256'] == SHA((OUT / '750135c350.dxbc').read_bytes())
    count = struct.unpack_from('<I', inputs, 4)[0]
    assert count == report['cases'] and len(outputs) == count * 16 * 4
    maximum, relative, gate_cases = 0, 0, {str(value): 0 for value in [0, 1, -1, 2]}
    field_maximum = [0] * 16
    for index in range(count):
        values = list(struct.unpack_from('<82f', inputs, 12 + index * 82 * 4))
        native = struct.unpack_from('<16f', outputs, index * 16 * 4)
        target = expected(values)
        gate_cases[str(int(values[26]))] += 1
        for lane, (a, b) in enumerate(zip(native, target)):
            error = abs(a - b)
            assert error < 5e-4 + 5e-5 * abs(b), (index, lane, a, b, error)
            field_maximum[lane] = max(field_maximum[lane], error)
            maximum, relative = max(maximum, error), max(relative, error / max(1, abs(b)))
    result = {'evidenceId': 'BF2-VOLCANIC-OBJECT-PS-WARP-CHECK-001', 'nativePixelShaderExecuted': True, 'backend': 'D3D11 CPU WARP',
        'inputSha256': SHA(inputs), 'outputSha256': SHA(outputs), 'pixelShaderSha256': report['pixelShaderSha256'], 'cases': count,
        'comparedScalars': count * 16, 'gateCases': gate_cases, 'maximumAbsoluteError': maximum, 'maximumRelativeWithUnitFloor': relative,
        'maximumAbsolutePerMrtLane': field_maximum, 'composition': 'All four original MRTs, including normal face/XY packing, smoothness, color, metalness, reflectance, sky visibility and exposed prelighting.',
        'limits': report['limitations'] + ['Native arithmetic may fuse/reorder; compact comparison is CPU double precision with exact original float32 literals.']}
    (OUT / 'warp-validation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare', action='store_true')
    if parser.parse_args().prepare:
        fixture()
    else:
        check()
