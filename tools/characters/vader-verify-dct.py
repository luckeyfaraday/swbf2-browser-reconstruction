"""Cross-check third-person DCT clips against the retained, unmodified upstream C# decoder.

The compiled test host (tools/characters/firstperson-dct-reference, built from the
unmodified AssetBankPlugin DctDecompressor.cs/BitReader.cs/DofTable.cs) decodes every
channel including packed float vectors natively (DofCount = NumQuats + NumVec3 +
NumFloatVec). The Python path relabels float-vec channels as extra Vec4 channels and
calls firstperson-decode-dct.decompress unmodified. Both float32 streams must be
byte-identical. Writes exports/characters/vader-animation/dct-crosscheck/report.json.
"""
import hashlib
import json
import subprocess
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path

import numpy as np

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
vd = SourceFileLoader('vader_decode', str(BASE / 'vader-decode.py')).load_module()
REFERENCE = BASE / 'firstperson-dct-reference/bin/Release/net8.0/firstperson-dct-reference.dll'
FOLDER = ROOT / 'exports/characters/vader-animation/dct-crosscheck'
FIELDS = ['NumKeys', 'NumQuats', 'NumVec3', 'NumFloat', 'NumFloatVec', 'QuantizeMultBlock', 'QuantizeMultSubblock',
          'CatchAllBitCount', 'DofTableDescBytes', 'DeltaBaseX', 'DeltaBaseY', 'DeltaBaseZ', 'DeltaBaseW',
          'BitsPerSubblock', 'Data', 'DataSize', 'KeyTimes']


def main(limit=None):
    if not REFERENCE.exists():
        raise SystemExit('Build the reference first: dotnet build tools/characters/firstperson-dct-reference/firstperson-dct-reference.csproj -c Release')
    FOLDER.mkdir(parents=True, exist_ok=True)
    clips = json.loads((ROOT / 'exports/characters/vader-animation/clips.json').read_text())
    selected = [(c['sourceName'], c['sourceAnimationKey']) for c in clips['clips'] + clips['victimClips'] if c['codec'] == 'DctAnimationAsset']
    if limit:
        selected = selected[:limit]
    rows = []
    for name, key in selected:
        animation = vd.bank.objects[key]
        values = vd.arrays(animation['values'])
        source = FOLDER / f'{name}.source.json'
        source.write_text(json.dumps({'sourceAnimationKey': key, 'arrayValues': {k: values[k] for k in FIELDS}}))
        relabeled = dict(values, NumVec3=values['NumVec3'] + values['NumFloatVec'], NumFloatVec=0, NumFloat=0)
        samples, details = vd.fpdct.decompress(relabeled)
        python_bytes = samples.astype('<f4').tobytes()
        result = FOLDER / f'{name}.reference.f32'
        subprocess.run(['dotnet', str(REFERENCE), str(source), str(result)], check=True, capture_output=True)
        reference_bytes = result.read_bytes()
        a, b = np.frombuffer(python_bytes, '<f4'), np.frombuffer(reference_bytes, '<f4')
        same = python_bytes == reference_bytes
        rows.append({'clip': name, 'animationKey': key, 'numQuats': values['NumQuats'], 'numVec3': values['NumVec3'],
                     'numFloat': values['NumFloat'], 'numFloatVec': values['NumFloatVec'], 'keys': values['NumKeys'],
                     'floatCount': int(a.size), 'exactBytes': same,
                     'maxAbsoluteError': float(np.max(np.abs(a - b))) if a.shape == b.shape else None,
                     'pythonSha256': hashlib.sha256(python_bytes).hexdigest(), 'referenceSha256': hashlib.sha256(reference_bytes).hexdigest(),
                     'trailingBits': details['trailingBits'], 'trailingSetBits': details['trailingSetBits']})
        result.unlink()  # keep the folder small; hashes are retained
        print(name, 'exact' if same else 'MISMATCH', a.size)
    report = {'evidenceId': 'BF2-VADER-DCT-CROSSCHECK-001',
              'reference': 'Unmodified retained AssetBankPlugin DctDecompressor.cs + BitReader.cs + DofTable.cs (firstperson-dct-reference host)',
              'referenceAssemblySha256': hashlib.sha256(REFERENCE.read_bytes()).hexdigest(),
              'clips': rows, 'allExact': all(r['exactBytes'] for r in rows),
              'totalFloats': sum(r['floatCount'] for r in rows),
              'limitations': ['Agreement of two implementations of the same algorithm corroborates the bitstream reading, '
                              'including packed float vectors; it does not observe native game execution.']}
    (FOLDER / 'report.json').write_text(json.dumps(report, indent=1))
    print(json.dumps({k: report[k] for k in ('allExact', 'totalFloats')} | {'clips': len(rows)}, indent=1))
    if not report['allExact']:
        sys.exit(1)


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
