"""Publish original-generator WARP output with explicit derivation provenance."""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
source = ROOT/'exports/lighting/dfg-generator'
raw = (source/'native-fg-128.rgba16f.bin').read_bytes()
run = json.loads((source/'warp-execution.json').read_text())
validation = json.loads((source/'validation.json').read_text())
assert hashlib.sha256(raw).hexdigest() == run['sha256'] == validation['sha256']
assert validation['maximumError'] < .001
assert len(raw) == 128*128*8
document = {
    'version': 1, 'evidenceId': 'BF2-NATIVE-FG-WARP-001',
    'url': '/assets/source-dfg.rgba16f.bin', 'sha256': run['sha256'],
    'byteLength': len(raw), 'width': 128, 'height': 128,
    'format': 'R16G16B16A16_FLOAT',
    'layout': 'Row-major little-endian RGBA binary16; source top row is LUT v near zero.',
    'derivation': 'Original installed DXBC executed unchanged on D3D11 WARP software rasterizer; not native-game framebuffer capture.',
    'generator': {'resource': 'systems/shaderprogramdb',
                  'program': 'ShaderProgram_PBRComputePreIntegratedFG',
                  'programNameHash': '0xc416e8c3', 'drawFunction': '0x141567e60',
                  'vertexSha256': run['vertexSha256'], 'pixelSha256': run['pixelSha256'],
                  'samplesPerPixel': 4096, 'backend': run['backend'], 'adapter': run['adapter']},
    'coordinates': {'u': 'saturate(dot(normalize(N), V))',
                    'v': 'perceptualRoughness * perceptualRoughness',
                    'perceptualRoughness': '1 - saturate(sourceSmoothness)',
                    'pixelCenters': '(x+0.5)/128, (y+0.5)/128',
                    'browserUpload': 'flipY false, no transpose, no gamma conversion'},
    'channels': {'r': 'mean((1-Fc)*GVis)', 'g': 'mean(Fc*GVis)',
                 'b': 'integrated native diffuse BRDF including source energy factor', 'a': 'zero',
                 'Fc': '(1-saturate(V dot H))^5'},
    'consumer': {'forwardShader': 'd825be064c', 'textureRegister': 't2', 'samplerRegister': 's1',
                 'diffuse': 'max(SH + broadSpecular, 0) * albedo * sampleDFG(u,v).b',
                 'normalization': 'No extra 1/pi or Three (1-singleScattering-multiScattering) on this source indirect branch.',
                 'specular': 'Producer RG encode Schlick scale and bias; exact native deferred specular consumer and multiscattering policy remain unresolved.'},
    'sampler': {'sourceHash': 'e639db23cb', 'sourceBytes16to19': [20,3,3,1],
                'browserFilter': 'linear min/mag, clamp U/V, one mip',
                'evidence': 'All nine source forward variants resolve s1 to this sampler. Packed enum bytes match D3D linear/clamp; native unpack routine unobserved.'},
    'validation': {'independentIntegralChecks': len(validation['independentChecks']),
                   'maximumAbsoluteError': validation['maximumError'],
                   'channelMinimum': validation['channelMinimum'],
                   'channelMaximum': validation['channelMaximum'],
                   'dx11Dx12InstructionStreamsIdentical': validation['dx11Dx12InstructionStreamsIdentical']},
    'limitations': ['WARP floating-point output can differ slightly from original hardware drivers.',
                    'Generator selection follows exact native draw hash and named source DXBC; full program-database table semantics are not independently decoded.',
                    'Native active forward/deferred pass selection remains unobserved.',
                    'Do not substitute this for Three dfgLUT: axes and roughness domain differ, and native diffuse already includes its own energy term.'],
}
public = ROOT/'web/public/assets'
(public/'source-dfg.rgba16f.bin').write_bytes(raw)
(public/'source-dfg.json').write_text(json.dumps(document, indent=2)+'\n')
print(json.dumps({'bytes': len(raw), 'sha256': run['sha256'], 'independentChecks': len(validation['independentChecks'])}))
