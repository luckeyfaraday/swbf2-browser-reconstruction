"""Native 0x140933db0 lightmap key: source GUID + quantized absolute transform.

Static arithmetic translation; it does not execute the installed game. The
binary helper0x14024a620 normalizes each basis and flips its first column when
the original determinant is negative. Float32 operation ordering is retained.
"""
import hashlib
import json
import pathlib
import struct
import uuid

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
F = np.float32
OFFSET = F(0.4999000132083893)


def norm3(v):
    return F(np.sqrt(F(F(F(v[1] * v[1]) + F(v[0] * v[0])) + F(v[2] * v[2]))))


def determinant(m):
    a = F(F(m[4] * m[2]) - F(m[6] * m[0]))
    b = F(F(m[6] * m[1]) - F(m[5] * m[2]))
    c = F(F(m[5] * m[0]) - F(m[4] * m[1]))
    return F(F(F(a * m[9]) + F(b * m[8])) + F(c * m[10]))


def key_payload(guid, matrix):
    m = np.asarray(matrix, dtype='<f4')
    assert m.shape == (16,) and np.isfinite(m).all()
    lengths = [norm3(m[i:i + 3]) for i in (0, 4, 8)]
    assert all(x > 0 for x in lengths)
    negative = determinant(m) < F(0)
    n = m.copy()
    for col, length in enumerate(lengths):
        inverse = F(F(1) / length)
        n[col * 4:col * 4 + 4] = F(m[col * 4:col * 4 + 4] * inverse)
    if negative:
        n[:4] = -n[:4]
    trace = F(F(n[0] + n[5]) + n[10])
    q = np.zeros(4, dtype='<f4')
    if trace > 0:
        q[3] = F(F(np.sqrt(F(trace + F(1)))) * F(.5))
        inverse = F(F(1) / F(q[3] * F(4)))
        q[0] = F(F(n[6] - n[9]) * inverse)
        q[1] = F(F(n[8] - n[2]) * inverse)
        q[2] = F(F(n[1] - n[4]) * inverse)
    else:
        i = int(n[0] < n[5])
        if n[i * 5] < n[10]:
            i = 2
        j = (1, 2, 0)[i]
        k = (1, 2, 0)[j]
        q[i] = F(F(np.sqrt(F(F(n[i * 5] - F(n[k * 5] + n[j * 5])) + F(1)))) * F(.5))
        inverse = F(F(1) / F(q[i] * F(4)))
        q[3] = F(F(n[k + j * 4] - n[j + k * 4]) * inverse)
        q[j] = F(F(n[j + i * 4] + n[j * 4 + i]) * inverse)
        q[k] = F(F(n[k + i * 4] + n[k * 4 + i]) * inverse)
    quantize = lambda value, scale: int(F(F(value * F(scale)) + OFFSET))
    integers = [quantize(x, 100) for x in m[12:15]]
    integers += [quantize(x, 10000) for x in q]
    integers += [quantize(x, 100) for x in lengths]
    integers += [-int(negative)]
    payload = uuid.UUID(guid).bytes_le + struct.pack('<11i', *integers)
    assert len(payload) == 60
    return payload


def lightmap_hash(guid, matrix):
    result = 0x811c9dc5
    for byte in key_payload(guid, matrix):
        result = ((result * 0x1000193) & 0xffffffff) ^ byte
    return result


def main():
    scene_path = ROOT / 'web/public/assets/map.scene.json'
    scene = json.loads(scene_path.read_text())
    bindings_path = ROOT / 'exports/lighting/static-atlas-bindings.json'
    bindings = {r['key']: r for r in json.loads(bindings_path.read_text())['records']}
    matches = []
    missing = []
    for index, instance in enumerate(scene['instances']):
        guid = instance['source']['classGuid']
        key = lightmap_hash(guid, instance['matrix'])
        row = {'instanceIndex': index, 'assetId': instance['assetId'], 'source': instance['source'], 'key': key}
        if key in bindings:
            matches.append({**row, 'atlasRecordOffset': bindings[key]['atlasRecordOffset'], 'values': bindings[key]['values']})
        else:
            missing.append(row)
    report = {
        'evidenceId': 'BF2-NATIVE-LIGHTMAP-HASH-002',
        'sceneSha256': hashlib.sha256(scene_path.read_bytes()).hexdigest(),
        'nativeHashFunction': '0x140933db0:0x1409341c1',
        'normalizationFunction': '0x14024a620:0x14024a795',
        'byteHashFunction': '0x1406c6650:0x1406c668d',
        'explicitWriter': '0x14092b8a0 (ModelStaticState+0x30; change flag0x200)',
        'fallbackConsumer': '0x140fc2110 (recomputes only when passed key is0xffffffff)',
        'guidPolicy': 'Exported source MeshAsset primary class GUID in native little-endian GUID byte layout.',
        'instanceCount': len(scene['instances']), 'matchedCount': len(matches),
        'unmatchedCount': len(missing), 'matched': matches, 'unmatched': missing,
        'limitations': ['No native execution. Native IEEE float rounding reproduced explicitly.',
                        'A matching key binds the source transform record; source lightmap UV stream and texture callback still require their own evidence.'],
    }
    (ROOT / 'exports/lighting/static-atlas-instance-matches.json').write_text(json.dumps(report, separators=(',', ':')))
    print(json.dumps({k: report[k] for k in ['evidenceId', 'instanceCount', 'matchedCount', 'unmatchedCount']}, indent=2))
    print(json.dumps(matches[:2], indent=2))


if __name__ == '__main__':
    main()
