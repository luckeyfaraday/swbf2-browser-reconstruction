"""Collect BF2-NATIVE-LOCAL-SHADOW-ACTIVATION-001 into evidence/native-shadow-activation.json.

Reads the published caster catalog and the browser check reports written by:
  web/test/source-shadow-atlas-gpu-check.mjs   (synthetic activation fixture)
  web/test/source-shadow-sampling-gpu-check.mjs (unchanged native WARP filter output)
  web/test/actual-map-check.mjs                 (actual map, shadow stage)
Run those first (wrapped in tools/gpu-lock.sh), then this script.
"""
from pathlib import Path
import hashlib, json, struct

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'web'
load = lambda path: json.loads((WEB / path).read_text(encoding='utf-8'))

catalog = load('public/assets/lighting/native-shadow-casters.json')
lights = load('public/assets/source-lights.json')
eligible = [l for l in lights['lights'] if l['properties']['$type'].endswith('PbrSpotLightEntityData')
            and l['properties'].get('DiscRadius') == 0 and l['properties']['CastShadowsEnable']
            and l['properties']['CastShadows']['value'] != 5 and l['properties']['CastShadows']['value'] <= 0]

# Exported shadow-category positions share the visible GLB local space: compare every
# exported visible section byte for byte with its GLB primitive and check node transforms.
manifest = load('public/assets/map.scene.json'); urls = {a['id']: a['url'] for a in manifest['assets']}
metadata = json.loads((ROOT / 'exports/lighting/native-shadow-caster-geometry/metadata.json').read_text(encoding='utf-8'))
def glb(path):
    b = path.read_bytes(); length = struct.unpack('<I', b[12:16])[0]; doc = json.loads(b[20:20 + length]); start = 20 + length + 8; out = []
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            accessor = doc['accessors'][primitive['attributes']['POSITION']]; view = doc['bufferViews'][accessor['bufferView']]
            offset = start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0); stride = view.get('byteStride', 12)
            out.append(b''.join(b[offset + i * stride:offset + i * stride + 12] for i in range(accessor['count'])))
    transforms = sum(any(k in n for k in ('matrix', 'translation', 'rotation', 'scale')) for n in doc.get('nodes', []))
    return out, transforms
compared = identical = nodeTransforms = 0; cache = {}
for record in metadata['records']:
    lod0 = next((l for l in record['lods'] if l['sourceLod'] == 0), None)
    for section in (lod0['sections'] if lod0 else []):
        if not (section['categoryMask'] & 1 and section.get('geometry') and section['browserPrimitiveIndex'] is not None): continue
        if record['assetId'] not in cache:
            cache[record['assetId']] = glb(WEB / 'public/assets' / urls[record['assetId']]); nodeTransforms += cache[record['assetId']][1]
        primitives = cache[record['assetId']][0]; compared += 1
        source = (ROOT / 'exports/lighting/native-shadow-caster-geometry' / section['geometry']['positionsFile']).read_bytes()
        identical += section['browserPrimitiveIndex'] < len(primitives) and primitives[section['browserPrimitiveIndex']] == source

def report(path, keys):
    try: data = load(path)
    except FileNotFoundError: return {'missing': path}
    return {key: data.get(key) for key in keys} | {'file': f'web/{path}'}

evidence = {
    'evidenceId': 'BF2-NATIVE-LOCAL-SHADOW-ACTIVATION-001',
    'dependsOn': ['BF2-NATIVE-LOCAL-SHADOW-PRODUCER-001', 'BF2-NATIVE-SHADOW-SAMPLER-001', 'BF2-NATIVE-SHADOW-CONSUMER-VALIDATION-001',
                  'BF2-NATIVE-SHADOW-DX11-BIAS-001', 'BF2-NATIVE-SHADOW-CASTER-METADATA-001', 'BF2-NATIVE-SHADOW-CASTERS-PUBLISH-001'],
    'eligibility': {'rule': 'punctual PbrSpotLightEntityData, CastShadowsEnable, CastShadows != Disabled(5) and <= PunctualLightShadowLevel 0',
                    'eligibleSourceLights': len(eligible), 'shadowCacheEnabledBySource': sum(bool(l['properties'].get('ShadowCacheEnable')) for l in eligible)},
    'casters': {'catalogSha256': catalog['sha256'], **catalog['summary'],
                'localSpaceCheck': {'visibleSectionsCompared': compared, 'byteIdenticalToGlb': identical, 'glbNodeTransforms': nodeTransforms}},
    'depth': {'format': 'DEPTH_COMPONENT16 (native D16 preference)', 'reverseDepth': 'A/d+B from nativeShadowDepthFactors(near,far,true)',
              'bias': 'ShaderDepthBiasGroup_Shadow16Bit: polygonOffset(factor -4, units -10)',
              'crossApi': 'inferred: ANGLE D3D11 maps polygonOffset factor/units to SlopeScaledDepthBias/DepthBias'},
    'atlas': {'cacheSlots': 32, 'cacheSide': 3120, 'liveSlots': 6, 'liveSide': 1560, 'tileInterior': 512, 'border': 4,
              'casterFov': 'nativeShadowBorderFov; receiver rows keep the unexpanded FOV'},
    'fixture': report('test-results/source-shadow-atlas-gpu-check.json', ['pass', 'gpu', 'ratios', 'changedFraction']),
    'nativeFilterRevalidation': report('test-results/source-shadow-sampling-gpu-check.json', ['pass', 'hardware', 'quality1']),
    'actualMap': (lambda d: {'pass': d.get('pass'), 'checks': len(d.get('checks', [])), 'errors': d.get('errors'), 'consoleErrors': d.get('consoleErrors'),
                             'shadowStage': next((c for c in d.get('checks', []) if 'shadow' in c['name'].lower()), None)})(load('test-results/actual-map-check.json')),
    'inferences': ['Caster pass culling (double-sided)', 'Tile allocation order (row-major)', 'Light basis roll', 'Facing-ramp operand',
                   'Soldiers/composites cast with visible browser geometry', 'Static caster caching and live-tile composition (native cache disabled)'],
}
out = ROOT / 'evidence/native-shadow-activation.json'
out.write_text(json.dumps(evidence, indent=1) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({k: evidence[k] for k in ('eligibility', 'casters')}, indent=1))
