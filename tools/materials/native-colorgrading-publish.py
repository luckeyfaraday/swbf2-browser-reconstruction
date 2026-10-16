"""Publish the source-generated SDR cube and reconstructed original CPU lookup."""
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'web/public/assets/lighting'
read = lambda p: json.loads((ROOT / p).read_text(encoding='utf-8'))
sha = lambda b: hashlib.sha256(b).hexdigest()


def main():
    native = read('exports/lighting/native-colorgrading/evidence.json')
    compute = read('exports/lighting/native-colorcube-warp-sdr/execution.json')
    warp = read('exports/lighting/native-colorgrading-warp/execution.json')
    gpu = read('web/test-results/source-colorgrading-gpu-check.json')
    plane = read('exports/lighting/native-colorgrading-warp-rgb10-plane/execution.json')
    plane_gpu = read('web/test-results/source-colorgrading-plane-gpu-check.json')
    assert gpu['pass'] and not gpu['errors']
    assert plane_gpu['pass'] and not plane_gpu['errors']
    assert native['nativeRenderPlane']['nativeFormat'] == 27
    assert native['nativeRenderPlane']['format'] == plane['intermediateFormat'] == 'R10G10B10A2_UNORM'
    for key in ['tonemapShaderSha256', 'mergeShaderSha256', 'cubePackedSha256',
                'cubeFloatSha256', 'pqLookupSha256', 'inputSha256']:
        assert plane[key] == warp[key], key
    assert plane['results'][0]['gradedSha256'] == plane['results'][1]['gradedSha256']
    assert plane['results'][0]['finalSha256'] == plane['results'][1]['finalSha256']
    assert plane_gpu['result']['isolatedCodeDifferences'] == 0
    assert plane_gpu['result']['maxCodeDifference'] <= 1
    assert plane_gpu['result']['envelopeViolations'] == 0
    assert compute['outputConversion'] == 1 and len(compute['results']) == 1
    assert compute['shaderSha256'] == '286967855442cb65da0732eb0b8df995f54f041e41258090e39c04a70e36f918'
    assert native['baseline']['postGradeExposure'] == [.5, 1]
    cb = (ROOT / 'exports/lighting/native-colorcube-warp-sdr/half.cb.bin').read_bytes()
    words = struct.unpack('<100f', cb)
    assert sha(cb) == compute['results'][0]['constantSha256']
    assert words[:16] == (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
    assert words[20:26] == (1, 1, 1, 0, 1, 1) and words[27:30] == (1, .5, 1)
    packed = (ROOT / 'exports/lighting/native-colorcube-warp-sdr/half.rgb10a2.bin').read_bytes()
    assert sha(packed) == compute['results'][0]['sha256'] == warp['cubePackedSha256']
    expanded = bytearray()
    for (v,) in struct.iter_unpack('<I', packed):
        expanded.extend(struct.pack('<4f', (v & 1023) / 1023, ((v >> 10) & 1023) / 1023,
                                     ((v >> 20) & 1023) / 1023, (v >> 30) / 3))
    assert sha(expanded) == warp['cubeFloatSha256']
    pq = (ROOT / 'exports/lighting/native-colorgrading/pq-to-linear.r16f.bin').read_bytes()
    assert sha(pq) == native['pqLookup']['sha256'] == warp['pqLookupSha256']
    rows = {}
    for key, name, payload in [('cube', 'indoor-sdr-colorgrade.rgba32f.bin', expanded),
                               ('pq', 'pq-to-linear.r16f.bin', pq)]:
        path = PUBLIC / name
        if not path.exists() or path.read_bytes() != payload:
            path.write_bytes(payload)
        rows[key] = dict(url='/assets/lighting/' + name, byteLength=len(payload), sha256=sha(payload))
    document = dict(version=1, evidenceId='BF2-NATIVE-COLORGRADING-BASELINE-001', **rows,
        baseline=native['baseline'], renderPlane=native['nativeRenderPlane'],
        authoredCube=dict(name='Levels/Lighting/DeathStar_02/T_CC_DeathStar_02_Indoor_01',
            guid='5080cf22-8f30-11e7-b378-a1eadebcd540', sourceSha256=compute['sourceCubeSha256'],
            size=33, format='R10G10B10A2_UNORM'),
        computation=dict(shaderSha256=compute['shaderSha256'], constantsSha256=sha(cb), packedResultSha256=sha(packed),
            backend='Unchanged original ColorCubeInterpolateCS on D3D11 WARP'),
        nativeEvidenceSha256=sha((ROOT / 'exports/lighting/native-colorgrading/evidence.json').read_bytes()),
        validation=dict(pixels=4096, packedVsFloatWarp='bit-identical', browser=gpu['result'],
            floatIntermediateNumericPolicy=gpu['numericPolicy'], numericPolicy=plane_gpu['policy'],
            renderPlane=dict(warp=plane['results'], browser=plane_gpu['result'],
                warpEvidenceSha256=sha((ROOT / 'exports/lighting/native-colorgrading-warp-rgb10-plane/execution.json').read_bytes()),
                browserEvidenceSha256=sha((ROOT / 'web/test-results/source-colorgrading-plane-gpu-check.json').read_bytes()))),
        limitations=native['limitations'] + [
            'Browser combines original tonemap and SDR merge equations with the recovered RGB10A2 intermediate quantization in one shader.',
            'Original exposure and independently recovered global vignette precede HDR grading; bloom remains unreconstructed.',
            'Native WARP versus AMD transcendental residuals are measured explicitly; no bit-identical final frame claim.'])
    (PUBLIC / 'indoor-colorgrading.json').write_text(json.dumps(document, indent=2), encoding='utf-8')
    print(json.dumps(dict(payloads=rows, baseline=document['baseline'])))


if __name__ == '__main__':
    main()
