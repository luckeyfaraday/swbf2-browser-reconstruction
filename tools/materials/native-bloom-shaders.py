"""Retain bounded original bloom shader witnesses (GaussianSimple chain).

Reads only the extracted shader program database and the installed executable;
never loads or executes the game.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('gbuffer', Path(__file__).with_name('native-dfg-gbuffer.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
OUT = ROOT / 'exports/lighting/native-bloom-shaders'
PYRAMID = 'Dx11/GaussianPyramidCs_srcArray=0,dstArray=0,robustEdge={robust},horizontallyAligned={h},verticallyAligned={v},convolveAlpha=0'
TONEMAP = 'Dx11/Tonemap_tonemap=0,grain=0,colorGrading=1,chromostereopsis=0,distort=0,ironsightsdof=0,filmicLensDistort=0,hdrGrading=1,lumaOutput=0,lensFlare=0,lensDirt=0,luminanceScaling=0,bloomSoftClipping={soft}'
PROGRAMS = {
    # Downsample kernel that builds each blur-pyramid mip from the previous one.
    'gaussian-pyramid-aligned': (PYRAMID.format(robust=0, h=1, v=1), 'cs'),
    'gaussian-pyramid-unaligned': (PYRAMID.format(robust=0, h=0, v=0), 'cs'),
    'gaussian-pyramid-robust': (PYRAMID.format(robust=1, h=0, v=0), 'cs'),
    # Separable fallback used on other device types.
    'gaussian-pyramid-twopass-h': ('Dx11/GaussianPyramidTwoPassCs_srcArray=0,dstArray=0,direction=0,robustEdge=0,aligned=1,convolveAlpha=0', 'cs'),
    'gaussian-pyramid-twopass-v': ('Dx11/GaussianPyramidTwoPassCs_srcArray=0,dstArray=0,direction=1,robustEdge=0,aligned=1,convolveAlpha=0', 'cs'),
    # drawTwoTexture2dBlend / drawTexture2dBlend upsample-accumulate.
    'tex2d-double': ('Dx11/Tex2dDouble_msaa=1,uint=0,splatRed=0', None),
    'tex2d': ('Dx11/Tex2d_msaa=1,uint=0,splatRed=0,discardAlpha=0', None),
    # Tonemap variants selected by BloomSoftClip (default 0) for the soft-clip comparison.
    'tonemap-bloom-hardclip': (TONEMAP.format(soft=0), 'ps'),
    'tonemap-bloom-softclip': (TONEMAP.format(soft=1), 'ps'),
}


def main():
    data = MODULE.SOURCE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert digest == '110d7169cb6f70559f8ecea0819e26b1df4fb66e0649f95bdeea033ef44ef898'
    index = json.loads((ROOT / 'exports/lighting/dfg-program-names.json').read_text(encoding='utf-8'))
    OUT.mkdir(exist_ok=True)
    records = []
    for short, (name, stage) in PROGRAMS.items():
        rows = [row for row in index if row[0] == name]
        assert rows, name
        for number, (_, name_offset, offset, length) in enumerate(rows):
            assert data[name_offset:name_offset + len(name) + 1] == name.encode() + b'\0'
            assert struct.unpack_from('<I', data, offset - 4)[0] == length
            bytecode = data[offset:offset + length]
            if bytecode[:4] != b'DXBC':
                continue
            assert struct.unpack_from('<I', bytecode, 24)[0] == length
            assembly = MODULE.assembly(bytecode)
            found = next(s for s in ('ps', 'cs', 'vs') if '\n' + s + '_5_0\n' in assembly)
            if stage and found != stage:
                continue
            file = short if number == 0 or not records or records[-1]['file'] != short else f'{short}-{number}'
            if any(r['file'] == file for r in records):
                file = f'{short}-{number}'
            (OUT / (file + '.dxbc')).write_bytes(bytecode)
            (OUT / (file + '.asm')).write_text(assembly, encoding='utf-8')
            records.append({'file': file, 'sourceName': name, 'nameOffset': name_offset,
                            'bytecodeOffset': offset, 'bytecodeBytes': length, 'stage': found,
                            'sha256': hashlib.sha256(bytecode).hexdigest()})
    report = {'evidenceId': 'BF2-NATIVE-BLOOM-SHADERS-001',
              'source': MODULE.SOURCE.relative_to(ROOT).as_posix(),
              'sourceSha256': digest, 'stages': records, 'runtimeObserved': False,
              'limitations': ['Exact original bytecode. Pass selection and parameters are bound separately by native producer evidence (native-bloom-evidence.py).']}
    (OUT / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps([{k: r[k] for k in ('file', 'stage', 'bytecodeBytes')} for r in records], indent=1))


if __name__ == '__main__':
    main()
