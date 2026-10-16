"""Publish the rejected float32 candidate for evidence; never activate at runtime."""
import hashlib
import json
import pathlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'exports/lighting/static-atlas-floor'
PUBLIC = ROOT / 'web/public/assets/lighting'
sha = lambda value: hashlib.sha256(value).hexdigest()
FIELDS = ['StaticIrradianceTexture', 'StaticDirectionTexture', 'StaticDirectionTextureG',
          'StaticDirectionTextureB', 'StaticSkyVisibilityTexture']


def verified_decoded(document, manifest_bytes, execution, read_file):
    """Reject stale/same-sized decodes before publishing any candidate payload."""
    assert execution['schemaVersion'] == 2 and execution['evidenceId'] == 'BF2-NATIVE-STATIC-ATLAS-DECODE-001'
    assert execution['manifestFile'] == 'manifest.json'
    assert execution['manifestByteLength'] == len(manifest_bytes)
    assert execution['manifestSha256'] == sha(manifest_bytes), 'Decode belongs to a different packed manifest'
    assert execution['diagnosticShaderSha256'] == sha(read_file('decode.hlsl'))
    expected = {row['sourceField']: row for row in document['textures']}
    decoded = {row['sourceField']: row for row in execution['textures']}
    assert len(expected) == len(document['textures']) == len(FIELDS)
    assert len(decoded) == len(execution['textures']) == len(FIELDS)
    assert set(expected) == set(decoded) == set(FIELDS)
    width, height = document['packedDimensions']
    originals = []
    for field in FIELDS:
        texture, record = expected[field], decoded[field]
        assert texture['cropSize'] == [width, height] == [record['width'], record['height']]
        assert texture['dxgiFormat'] == record['dxgiFormat']
        assert record['inputFile'] == texture['cropFile']
        assert record['outputFile'] == field + '.rgba32f.bin'
        compressed = read_file(record['inputFile'])
        pixels = read_file(record['outputFile'])
        assert len(compressed) == record['inputByteLength'] == width * height
        assert sha(compressed) == texture['sha256'] == record['inputSha256'], 'Compressed input changed after decoding'
        assert len(pixels) == record['outputByteLength'] == width * height * 16
        assert sha(pixels) == record['outputSha256'], 'Decoded float payload changed after decoding'
        array = np.frombuffer(pixels, dtype='<f4').reshape(height, width, 4)
        assert np.isfinite(array).all()
        originals.append(array)
    return originals


def main():
    manifest_bytes = (SOURCE / 'manifest.json').read_bytes()
    document = json.loads(manifest_bytes)
    execution = json.loads((SOURCE / 'decode-execution.json').read_text(encoding='utf-8'))
    width, height = document['packedDimensions']
    originals = verified_decoded(document, manifest_bytes, execution, lambda name: (SOURCE / name).read_bytes())
    layers = np.zeros((4, height, width, 4), dtype='<f4')
    layers[0, :, :, :3] = originals[0][:, :, :3]
    layers[0, :, :, 3] = originals[4][:, :, 0]
    for layer in range(1, 4):
        layers[layer, :, :, :3] = originals[layer][:, :, :3]
    # Bit equality includes the HDR values, BC7 decode rounding and zero signs.
    for channel in range(3):
        assert np.array_equal(layers[0, :, :, channel].view('u4'), originals[0][:, :, channel].view('u4'))
    assert np.array_equal(layers[0, :, :, 3].view('u4'), originals[4][:, :, 0].view('u4'))
    for layer in range(1, 4):
        assert np.array_equal(layers[layer, :, :, :3].view('u4'), originals[layer][:, :, :3].view('u4'))
    raw = layers.tobytes()
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / 'static-atlas-floor.rgba32f.bin').write_bytes(raw)
    # A floor-only UV payload avoids adding the other families to this initial scope.
    uv_bytes = bytearray()
    uv_records = []
    for row in document['uvRecords']:
        values = (ROOT / row['sourceFile']).read_bytes()
        assert sha(values) == row['sourceSha256']
        uv_records.append({**row, 'byteOffset': len(uv_bytes)})
        uv_bytes.extend(values)
    (PUBLIC / 'static-atlas-floor-uv.bin').write_bytes(uv_bytes)
    document.update({'url': '/assets/lighting/static-atlas-floor.rgba32f.bin', 'sha256': sha(raw), 'byteLength': len(raw),
                     'format': 'RGBA32F', 'layers': 4,
                     'layerChannels': ['irradiance.rgb,skyVisibility.r', 'directionR.rgb,zero', 'directionG.rgb,zero', 'directionB.rgb,zero'],
                     'uv': {'url': '/assets/lighting/static-atlas-floor-uv.bin', 'sha256': sha(uv_bytes),
                            'byteLength': len(uv_bytes), 'records': uv_records},
                     'decode': execution,
                     'runtimeEligible': False,
                     'status': 'rejected-filtered-candidate',
                     'rejection': {'evidence': 'web/test-results/source-static-atlas-packing-gpu-check.json',
                                   'reason': 'Exact decoded texels do not preserve native BC texture filtering after cropping and float32 repacking.',
                                   'observedMaximumHdrAbsoluteResidual': 43.625,
                                   'replacement': 'Original-size BC6H irradiance plus original-size four-layer BC7 array; no UV rebasing.'},
                     'channelPacking': 'All 13 source float32 scalar lanes are copied bit-for-bit; filtered sampling differs, so this candidate is rejected for runtime.'})
    document.pop('uvRecords')
    decoded_by_field = dict(zip(FIELDS, originals))
    for texture in document['textures']:
        texture['decodedSha256'] = sha(decoded_by_field[texture['sourceField']].tobytes())
    (PUBLIC / 'static-atlas-floor.json').write_text(json.dumps(document, indent=2), encoding='utf-8')
    print(json.dumps({'textureBytes': len(raw), 'uvBytes': len(uv_bytes), 'charts': len(document['charts']),
                      'copiedSourceScalars': width * height * 13, 'dimensions': [width, height, 4]}))


if __name__ == '__main__':
    main()
