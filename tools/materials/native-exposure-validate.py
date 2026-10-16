"""Independent math comparison with retained unchanged metering VS/PS outputs."""
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / 'exports/lighting/native-exposure-warp'


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def sample(data, width, height, u, v, linear=False):
    if linear:
        px, py = u * width - .5, v * height - .5
        x, y = math.floor(px), math.floor(py)
        fx, fy = px - x, py - y
        taps = [sample(data, width, height, (x + sx + .5) / width, (y + sy + .5) / height)
                for sx, sy in [(0,0), (1,0), (0,1), (1,1)]]
        return [(taps[0][c]*(1-fx)+taps[1][c]*fx)*(1-fy)+(taps[2][c]*(1-fx)+taps[3][c]*fx)*fy for c in range(4)]
    x = min(width - 1, max(0, math.floor(u * width)))
    y = min(height - 1, max(0, math.floor(v * height)))
    offset = (y * width + x) * 4
    return data[offset:offset + 4]


def evaluate(case, data, x, y):
    lo_x, lo_y, hi_x, hi_y = case['rectangle']
    u = lo_x + (x + .5) / case['width'] * (hi_x - lo_x)
    v = lo_y + (y + .5) / case['height'] * (hi_y - lo_y)
    taps = [sample(data, case['sourceWidth'], case['sourceHeight'],
                   u + sx * .5 / case['width'], v + sy * .5 / case['height'])
            for sx, sy in [(-1, -1), (-1, 1), (1, 1), (1, -1)]]
    rgba = [sum(t[c] for t in taps) * .25 for c in range(4)]
    if case.get('fast'):
        rgba = sample(data, case['sourceWidth'], case['sourceHeight'], u, v, True)
    if case['program'].startswith('average'):
        return [v * case['scale'] for v in rgba]
    rgb = [max(0, min(case['maxClamp'], v)) for v in rgba[:3]]
    luminance = sum(c * f32(f32(w) * case['scale']) for c, w in zip(rgb, [.3, .59, .11]))
    return rgb + [math.log(luminance + f32(.00001))]


def validate():
    manifest = json.loads((FOLDER / 'manifest.json').read_text())
    cases = []
    for case in manifest['cases']:
        raw = (FOLDER / f"case{case['index']}-input.rgba32f.bin").read_bytes()
        data = struct.unpack('<' + 'f' * (len(raw) // 4), raw)
        raw = (FOLDER / f"case{case['index']}-native.rgba32f.bin").read_bytes()
        native = struct.unpack('<' + 'f' * (len(raw) // 4), raw)
        expected = [c for y in range(case['height']) for x in range(case['width'])
                    for c in evaluate(case, data, x, y)]
        residual = max(abs(a - b) / max(1, abs(a), abs(b)) for a, b in zip(native, expected))
        absolute = max(abs(a - b) for a, b in zip(native, expected))
        assert residual < 1e-6, (case['index'], residual, absolute)
        cases.append({'index': case['index'], 'program': case['program'], 'pixels': len(expected) // 4,
                      'maxNormalizedResidual': residual, 'maxAbsoluteResidual': absolute})
    report = {'evidenceId': 'BF2-NATIVE-EXPOSURE-WARP-001', 'passed': True, 'cases': cases,
              'pixels': sum(c['pixels'] for c in cases),
              'maxNormalizedResidual': max(c['maxNormalizedResidual'] for c in cases),
              'limitations': manifest['limitations']}
    (FOLDER / 'validation.json').write_text(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    print(json.dumps(validate(), indent=2))
