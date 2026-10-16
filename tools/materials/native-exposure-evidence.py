"""Verify bounded native exposure witnesses; does not execute the game."""
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting'
EVIDENCE = 'BF2-NATIVE-EXPOSURE-001'


def recover():
    script = ROOT / 'tools/materials/native-dfg-pe.py'
    pe = {'__file__': str(script)}
    exec(script.read_text().split('names =')[0], pe)
    data, base, to = pe['data'], pe['image_base'], pe['to_offset']
    constants = []
    for address, name, expected in [
        (0x143047ac8, 'saturationExposureDenominator', 1.2000000476837158),
        (0x1431e12c8, 'log2e', 1.4426950216293335),
        (0x14301af38, 'meterSensitivity', 100.0),
        (0x14343df48, 'inverseMeterCalibration', 0.07999999821186066),
        (0x14301a308, 'adaptationTimeThreshold', 0.009999999776482582),
        (0x1430557b8, 'minimumSpotScale', 0.019999999552965164),
        (0x14304f2b4, 'unclampedMinimumEV', -10.0),
        (0x14303f568, 'unclampedMaximumEV', 25.0),
    ]:
        offset = to(address - base)
        value = struct.unpack_from('<f', data, offset)[0]
        assert value == expected, name
        constants.append({'address': hex(address), 'name': name, 'value': value,
                          'bytes': data[offset:offset + 4].hex()})
    imports = []
    for address, expected in [(0x141e72fc6, 'logf'), (0x141e73026, 'powf'), (0x141e7304a, 'expf')]:
        offset = to(address - base)
        assert data[offset:offset + 2] == b'\xff\x25'
        slot = address + 6 + struct.unpack_from('<i', data, offset + 2)[0]
        rva = struct.unpack_from('<Q', data, to(slot - base))[0]
        offset = to(rva) + 2
        name = data[offset:data.index(b'\0', offset)].decode()
        assert name == expected
        imports.append({'thunk': hex(address), 'name': name, 'iat': hex(slot)})
    functions = {
        '141561710': 'Target EV from reduced luminance; manual/automatic selection, readback validity, bounds, deadband and ForceEV.',
        '141561260': 'Directional capped linear EV/compensation adaptation, then 1/(float32(1.2)*powf(2,EV-compensation)).',
        '146c14fb0': 'CalculateExposure task executes 141561260.',
        '14155ac40': 'Registers CalculateExposure task with captured frame data.',
        '140d984b0': 'Tonemap state / frame exposure pointers and ViewLuminanceData readback copied into task source.',
        '140db2f60': 'Frame exposure +0x50 passed to render-context exposure slot 0.',
        '140d853b0': 'Builds common +0x90 exposure/reciprocal vector.',
        '1415d7550': 'Original RVM selector 8 copies common exposure vector +0x90.',
        '141560a70': 'MipAverage reduction graph and source spot rectangle.',
        '140ff28b0': 'MipAverage method branch obtains Tonemap spot scale/offset and ViewLuminanceData scale.',
        '141583ea0': 'Binds ShaderProgram_DownsampleHalfGrayscaleLog and its luminance/clamp vectors.',
        '146c151e0': 'Downsample task selects ordinary or log shader; luminance weights .30,.59,.11.',
        '14157dd30': 'Reads current destination dimensions and supplies inverse size to VS and fallback PS.',
        '141583c10': 'Ordinary fallback DownsampleHalf PS binds full0..1 UV; fast path uses Tex2d.',
        '140ffb7c0': 'Resolves method and inverse frame exposure; reads preceding reduction result.',
        '140ffa260': 'MipAverage readback uses expf(alpha) when log enabled; otherwise dotRGB(.30,.59,.11).',
        '140ffc890': 'Maps result; validity is native map success, zero output on failure.',
        '140ff8fd0': 'Format0x28 reads four half-floats; format0x1a decodes packed RGB.',
        '142deb960': 'GlobalPostProcessSettings constructor: method1, logAverage enabled, EV clamp/adaptation enabled.',
        '142df9fa0': 'Tonemap state constructor: method4 UseGlobalSetting, zero higher/lower thresholds.',
        '1415a41c0': 'Sampler conversion: first3 address enums2 become D3D_CLAMP3; next3 filter enums supplied to1415affc0.',
        '1415affc0': 'Sampler filter conversion: all1 becomes POINT0; all2 becomes LINEAR0x15.',
        '1415b9e80': 'Converts native sampler structure and binds its D3D sampler object.',
        '1415b17b0': 'Passes converted descriptor directly to ID3D11Device CreateSamplerState.',
        '14158a930': 'Fast Tex2dGrayscaleLog PS binds linear/clamp sampler and same crop/luminance/clamp inputs.',
        '14158a280': 'Generic Tex2d fast ordinary copy uses bilinear sampler when requested by DownsampleHalf.',
        '1414581e0': 'Assembly SHR EAX,1 / AND AL,1 tests renderer format capability bit1, controlling optional fast paths.',
        '1415ae210': 'DX11 CheckFormatSupport maps D3D11_SHADER_SAMPLE bit9 into native capability bit1; source format0x28 maps DXGI10 RGBA16F.',
        '14159b880': 'DX11 renderer constructor: caps object this+0xe38, vtable143444270 whose +0x80 getter returns that caps object.',
        '141522250': 'Renderer caps constructor clears per-format flags at+0x64.',
        '14158b6b0': 'Tonemap shader family binding and feature permutation inputs.',
    }
    chain = []
    for address, meaning in functions.items():
        path = OUT / 'dfg-native-functions' / (address + '.c')
        chain.append({'address': '0x' + address, 'meaning': meaning,
                      'path': path.relative_to(ROOT).as_posix(),
                      'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    report = {'schemaVersion': 1, 'evidenceId': EVIDENCE,
              'sourceExecutableSha256': hashlib.sha256(data).hexdigest(),
              'constants': constants, 'imports': imports, 'chain': chain,
              'tonemapFields': json.loads((OUT / 'native-exposure-tonemap-state-fields.json').read_text()),
              'equations': {
                  'meterEV': 'logf(reducedLuminance * 100 * float32(.08)) * float32(log2(e))',
                  'exposure': '1 / (float32(1.2) * powf(2, adaptedEV - adaptedCompensation))',
                  'adaptationWeight': 'min(deltaTime / (target <= current ? darkTime : lightTime), 1)',
                  'meterLogShader': 'ln(dot(clamp(sourceRGB,0,maxClamp), luminanceVector)+float32(1e-5)); sourceRGB is one bilinear sample on fast path, mean of four point samples on fallback.',
                  'luminanceVector': 'firstPassScalar * float3(.30,.59,.11)',
                  'firstPassScalar': '1/renderContext.exposureSlot1; use1 for browser rawHDR',
                  'fallbackOffset': 'float2(+/-0.5/destinationWidth, +/-0.5/destinationHeight), point/clamp',
                  'fastSampling': 'single bilinear/clamp sample at interpolated UV',
                  'logReadback': 'expf(lastHalfFloatPixel.a)',
              },
              'limitations': [
                  'Static native function/RTTI/shader recovery; no original executable launched or original frame capture.',
                  'Native defaults give method1/logAverage=true; user/quality/command-line overrides are not an original captured frame.',
                  'Selected interior/gamewide exports and native state constructor have zero deadband; local environment blending remains untraced.',
                  'Fast-format dispatch uses native capability bit1, produced from D3D11_SHADER_SAMPLE, plus initially enabled globals; no original user override capture.',
                  'Browser source-exposure-native.js uses double arithmetic around recovered float32 constants, not an instruction-accurate x64/libm emulator.',
                  'Linear presentation witness includes bloom/vignette inputs; live source permutation and grading resources are not yet selected.',
              ]}
    report['browserVerification'] = []
    for name in ['source-exposure-gpu-check.json', 'actual-map-native-meter-metallic-expanded-tangents.json']:
        path = ROOT / 'web/test-results' / name
        if path.exists():
            report['browserVerification'].append({'path': path.relative_to(ROOT).as_posix(),
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'nativeGameCapture': False})
    return report


if __name__ == '__main__':
    report = recover()
    (OUT / 'native-exposure.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'evidenceId': EVIDENCE, 'constants': len(report['constants']),
                      'nativeFunctions': len(report['chain']), 'imports': report['imports']}))
