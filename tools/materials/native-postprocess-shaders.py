"""Retain bounded original color-cube and HDR presentation shader witnesses."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('gbuffer', Path(__file__).with_name('native-dfg-gbuffer.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
OUT = ROOT / 'exports/lighting/native-postprocess-shaders'
TONEMAP = 'Dx11/Tonemap_tonemap=0,grain=0,colorGrading={grade},chromostereopsis=0,distort=0,ironsightsdof=0,filmicLensDistort=0,hdrGrading=1,lumaOutput=0,lensFlare=0,lensDirt=0,luminanceScaling=0,bloomSoftClipping=0'
PROGRAMS = {
    'linear-hdr-grading': (TONEMAP.format(grade=0), 17456212, 'ps'),
    'linear-hdr-grading-lut': (TONEMAP.format(grade=1), 22322260, 'ps'),
    'cube-hdr-one-none': ('Dx11/ColorCubeInterpolateCS_sourceTexture=1,hdrGrading=1,outputConversion=0', 92602547, 'cs'),
    'cube-hdr-one-convert1': ('Dx11/ColorCubeInterpolateCS_sourceTexture=1,hdrGrading=1,outputConversion=1', 92605411, 'cs'),
    'cube-hdr-one-convert2': ('Dx11/ColorCubeInterpolateCS_sourceTexture=1,hdrGrading=1,outputConversion=2', 92610943, 'cs'),
    'cube-hdr-one-convert3': ('Dx11/ColorCubeInterpolateCS_sourceTexture=1,hdrGrading=1,outputConversion=3', 92613799, 'cs'),
    'merge-hdr-sdr': ('Dx11/MergeRenderPlanes_resample=0,mainPlaneOnly=1,hdrGrading=1,hdrOutputType=0,debugTexture=0', 13853513, 'ps'),
}


def main():
    data = MODULE.SOURCE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert digest == '110d7169cb6f70559f8ecea0819e26b1df4fb66e0649f95bdeea033ef44ef898'
    index = json.loads((ROOT / 'exports/lighting/dfg-program-names.json').read_text(encoding='utf-8'))
    OUT.mkdir(exist_ok=True)
    records = []
    for short, (name, offset, stage) in PROGRAMS.items():
        _, name_offset, offset, length = next(row for row in index if row[0] == name and row[2] == offset)
        assert data[name_offset:name_offset + len(name) + 1] == name.encode() + b'\0'
        assert struct.unpack_from('<I', data, offset - 4)[0] == length
        bytecode = data[offset:offset + length]
        assert bytecode[:4] == b'DXBC' and struct.unpack_from('<I', bytecode, 24)[0] == length
        assembly = MODULE.assembly(bytecode)
        assert '\n' + stage + '_5_0\n' in assembly
        (OUT / (short + '.dxbc')).write_bytes(bytecode)
        (OUT / (short + '.asm')).write_text(assembly, encoding='utf-8')
        records.append({'file': short, 'sourceName': name, 'nameOffset': name_offset,
                        'bytecodeOffset': offset, 'bytecodeBytes': length,
                        'stage': stage, 'sha256': hashlib.sha256(bytecode).hexdigest()})
    report = {'evidenceId': 'BF2-NATIVE-POSTPROCESS-001',
              'source': MODULE.SOURCE.relative_to(ROOT).as_posix(),
              'sourceSha256': digest, 'stages': records, 'runtimeObserved': False,
              'limitations': ['Exact original bytecode; selected parameters and pass ordering require separate native producer evidence.',
                              'Authored HDR grading cube and final display-mapping cube are distinct resources.']}
    (OUT / 'manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(records, indent=2))


if __name__ == '__main__':
    main()
