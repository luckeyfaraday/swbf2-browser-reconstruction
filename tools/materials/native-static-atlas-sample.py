"""Copy exact source BC blocks covering the first natively bound wall chart."""
import hashlib
import json
import pathlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting/static-atlas-sample'
OUT.mkdir(exist_ok=True)
evidence = json.loads((ROOT / 'exports/lighting/static-atlas-evidence.json').read_text())
match = json.loads((ROOT / 'exports/lighting/static-atlas-instance-matches.json').read_text())['matched'][0]
values = match['values']
uv = np.fromfile(ROOT / 'exports/lighting/static-atlas-uv/5dde6982-a8e4-899a-0b11-55c5ef8bcf5e-lod0-primitive0-RadiosityTexCoord.bin', dtype='<f4').reshape(-1, 2)
pixels = (uv * np.array([values[0], values[3]]) + values[4:6]) * [5232, 4908]
origin = np.floor((pixels.min(axis=0) - 1) / 4).astype(int) * 4
end = np.ceil((pixels.max(axis=0) + 1) / 4).astype(int) * 4
size = end - origin
records = []
for texture in evidence['textures']:
    source = ROOT / 'exports/lighting/static-atlas-chunks' / f"{texture['chunkGuid']}.chunk"
    data = source.read_bytes()
    assert len(data) == texture['payloadBytes']
    rows = []
    for y in range(origin[1] // 4, end[1] // 4):
        offset = (y * (5232 // 4) + origin[0] // 4) * 16
        rows.append(data[offset:offset + (size[0] // 4) * 16])
    crop = b''.join(rows)
    name = texture['sourceField'] + '.bc.bin'
    (OUT / name).write_bytes(crop)
    records.append({**texture, 'sourceChunkSha256': hashlib.sha256(data).hexdigest(),
                    'cropFile': name, 'cropSha256': hashlib.sha256(crop).hexdigest(),
                    'cropOrigin': origin.tolist(), 'cropSize': size.tolist(),
                    'cropBytes': len(crop), 'dxgiFormat': 95 if texture['formatId'] == 64 else 98})
report = {'evidenceId': 'BF2-NATIVE-STATIC-ATLAS-SAMPLE-001', 'instance': match,
          'nativeUvBounds': [uv.min(axis=0).tolist(), uv.max(axis=0).tolist()],
          'atlasPixelBounds': [pixels.min(axis=0).tolist(), pixels.max(axis=0).tolist()],
          'textures': records,
          'decode': 'Original compressed blocks copied unchanged. CPU D3D11 WARP texture.Load to RGBA32F; no gamma or tone mapping.'}
(OUT / 'manifest.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'cropOrigin': origin.tolist(), 'cropSize': size.tolist(), 'atlasPixelBounds': report['atlasPixelBounds']}))
