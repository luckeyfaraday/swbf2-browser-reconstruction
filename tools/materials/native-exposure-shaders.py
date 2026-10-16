"""Extract only the retained native metering/presentation shader witnesses."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('gbuffer', Path(__file__).with_name('native-dfg-gbuffer.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
OUT = ROOT / 'exports/lighting/native-exposure-shaders'
NAMES = {
    'grayscale-log-fast': ('Dx11/Tex2dGrayscaleLog', 13594886, 'ps'),
    'grayscale-log-fast-vs': ('Dx11/Tex2dGrayscaleLog', 146203, 'vs'),
    'average-fast': ('Dx11/Tex2d_msaa=1,uint=0,splatRed=0,discardAlpha=0', 16356616, 'ps'),
    'grayscale-log': ('Dx11/DownsampleHalfGrayscaleLog', 13597650, 'ps'),
    'grayscale-log-vs': ('Dx11/DownsampleHalfGrayscaleLog', 149011, 'vs'),
    'average': ('Dx11/DownsampleHalf', 16201314, 'ps'),
    'average-vs': ('Dx11/DownsampleHalf', 176376, 'vs'),
    'linear-baseline': ('Dx11/Tonemap_tonemap=0,grain=0,colorGrading=0,chromostereopsis=0,distort=0,ironsightsdof=0,filmicLensDistort=0,hdrGrading=0,lumaOutput=0,lensFlare=0,lensDirt=0,luminanceScaling=0,bloomSoftClipping=0', 17327796, 'ps'),
    'color-grade': ('Dx11/ColorGrade', 69910781, 'ps'),
}


def recover():
    data = MODULE.SOURCE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert digest == '110d7169cb6f70559f8ecea0819e26b1df4fb66e0649f95bdeea033ef44ef898'
    index = json.loads((ROOT / 'exports/lighting/dfg-program-names.json').read_text())
    OUT.mkdir(exist_ok=True)
    records = []
    for short, (name, offset, stage) in NAMES.items():
        row = next(row for row in index if row[0] == name and row[2] == offset)
        _, name_offset, offset, length = row
        assert data[name_offset:name_offset + len(name) + 1] == name.encode() + b'\0'
        assert struct.unpack_from('<I', data, offset - 4)[0] == length
        bytecode = data[offset:offset + length]
        assert bytecode[:4] == b'DXBC' and struct.unpack_from('<I', bytecode, 24)[0] == length
        assembly = MODULE.assembly(bytecode)
        assert '\n' + stage + '_5_0\n' in assembly
        (OUT / (short + '.dxbc')).write_bytes(bytecode)
        (OUT / (short + '.asm')).write_text(assembly)
        records.append({'file': short, 'sourceName': name, 'nameOffset': name_offset,
                        'bytecodeOffset': offset, 'bytecodeBytes': length,
                        'stage': stage, 'sha256': hashlib.sha256(bytecode).hexdigest()})
    report = {'evidenceId': 'BF2-NATIVE-EXPOSURE-001', 'source': MODULE.SOURCE.relative_to(ROOT).as_posix(),
              'sourceSha256': digest, 'stages': records,
              'limitations': ['Exact named source programs; active pass/permutation and native CPU parameters require separate binding evidence.',
                              'Linear baseline disables optional source grading/lens permutations but still samples bloom; its scale/vignette inputs need separate producer evidence.']}
    (OUT / 'manifest.json').write_text(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    result = recover()
    print(json.dumps(result['stages'], indent=2))
