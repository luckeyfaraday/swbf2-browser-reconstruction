"""Run the independently compiled upstream decoder and compare every sample."""
import hashlib
import json
from pathlib import Path
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / 'exports/characters/firstperson-dct'
reference = ROOT / 'tools/characters/firstperson-dct-reference/bin/Release/net8.0/firstperson-dct-reference.dll'
comparisons = []
for source in sorted(FOLDER.glob('*.source.json')):
    name = source.name.replace('.source.json', '')
    result = FOLDER / f'{name}.reference.f32'
    subprocess.run(['dotnet', str(reference), str(source), str(result)], check=True)
    python_bytes = (FOLDER / f'{name}.python.f32').read_bytes()
    reference_bytes = result.read_bytes()
    a, b = np.frombuffer(python_bytes, '<f4'), np.frombuffer(reference_bytes, '<f4')
    assert a.shape == b.shape
    maximum = float(np.max(np.abs(a - b)))
    assert python_bytes == reference_bytes, (name, maximum)
    comparisons.append({'clip': name, 'floatCount': len(a), 'maxAbsoluteError': maximum,
                        'pythonSha256': hashlib.sha256(python_bytes).hexdigest(),
                        'referenceSha256': hashlib.sha256(reference_bytes).hexdigest(), 'exactBytes': True})
report = {
    'evidenceId': 'BF2-FIRSTPERSON-DCT-CROSSCHECK-001',
    'reference': 'Unmodified retained AssetBankPlugin DctDecompressor.cs + BitReader.cs + DofTable.cs compiled under minimal reader/field test host',
    'comparisons': comparisons,
    'referenceAssemblySha256': hashlib.sha256(reference.read_bytes()).hexdigest(),
    'limitations': ['Agreement with an independent upstream implementation corroborates codec semantics; it does not observe native game execution or playback/blending.'],
}
(FOLDER / 'reference-comparison.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
