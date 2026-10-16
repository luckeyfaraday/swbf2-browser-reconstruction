"""Source-bound recovery of the exact default SS_DSI_Ceiling_01 shader family."""
import collections, hashlib, json, pathlib, struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/ceiling-shader'
NAME = 'Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Ceiling_01'
data = (ROOT / 'exports/materials/rvm/0.res').read_bytes()
index = json.loads((ROOT / 'exports/materials/rvm/block-index.json').read_text())['blocks']
meta = json.loads((ROOT / 'exports/materials/rvm/material-blocks.json').read_text())
split = json.loads((ROOT / 'exports/materials/final-map-blocks.json').read_text())['blocks']
by_rid = {b['source']['rid']: b for b in split}
parameters = {p['packedFlags']: p for b in split for p in b.get('parameters', [])}
plan = json.loads((ROOT / 'exports/materials/final-map-material-plan.json').read_text())
graph = json.loads((OUT / 'graph.json').read_text())

def raw(k):
    b = index[k]
    return data[b['offset']:b['offset'] + b['size']]

def ref(value): return f'{int(value) & 0xffffffffff:010x}'
def slots(k): return [v[0] >> 16 for v in struct.iter_unpack('<I', raw(k))]
def hash_name(name):
    value = 5381
    for ch in name.lower(): value = ((value * 33) ^ ord(ch)) & 0xffffffff
    return value

def params_under(key, seen):
    if key in seen: return []
    seen.add(key)
    b = by_rid[key]
    return [(b, p) for p in b.get('parameters', [])] + [p for c in b.get('children', []) for p in params_under(c, seen)]

assert hash_name(NAME) == graph['sourceNameHash'] == 1075960127
assert hash_name(NAME.replace('Ceiling', 'Floor')) == 1716682052
read_keys = meta['a414789c08']['values']
default_keys = meta['9cc8a346b3']['values']
default_values = meta['4b80db2d64']['values']
assert slots('8a7393b750') == [1, 34, 33]
assert slots('457b8d01cd') == [38, 39, 40]
assert slots('ba7c4b23cd') == [39, 40, 38]
assert raw('4906a15158')[32:40] == bytes.fromhex('0101020003000000')
conversion = dict(zip(slots('457b8d01cd'), slots('8a7393b750')))
mapping = []
for register, (role, converted) in enumerate(zip(['mask', 'metalCS', 'metalNormal'], slots('ba7c4b23cd')), 2):
    slot = conversion[converted]
    key = ref(read_keys[slot]['hash'])
    packed = str(int(meta[key]['values'][0]['hash']) & 0xffffffffffff)
    mapping.append({'register': f't{register}', 'role': role, 'convertedSlot': converted, 'inputSlot': slot,
                    'parameterKeyBlock': key, 'packedLow48': packed, 'parameterHash': parameters[packed]['nameHash']})
writes = list(struct.iter_unpack('<IHH', raw('ae0e8b9d67')))
assert [(v >> 16, offset, count) for v, offset, count in writes] == [(28,0,1),(5,0,1),(6,16,1),(17,32,1),(15,48,1),(26,64,1)]
constants = []
for cb, ((encoded, offset, _), role) in enumerate(zip(writes[1:], ['uvScale', 'emissiveColor', 'emissiveStrength', 'emissiveMultiplier', 'baseColor'])):
    slot = encoded >> 16
    key = ref(read_keys[slot]['hash'])
    packed = str(int(meta[key]['values'][0]['hash']) & 0xffffffffffff)
    default_index = [ref(k['hash']) for k in default_keys].index(key)
    value_ref = ref(default_values[default_index]['hash'])
    vector = ref(meta[value_ref]['values'][0]['hash'])
    value = list(struct.unpack('<4f', raw(vector)))
    constants.append({'register': f'cb1[{cb}]', 'role': role, 'inputSlot': slot, 'parameterKeyBlock': key,
                      'packedLow48': packed, 'parameterHash': parameters.get(packed, {}).get('nameHash'),
                      'defaultIndex': default_index, 'defaultVectorBlock': vector,
                      'defaultSourceOffset': index[vector]['offset'], 'default': value})
materials, textures = [], {}
for mesh in plan['meshes']:
    for material in mesh['materials']:
        if (material.get('shader') or {}).get('name', '').lower() != NAME.lower(): continue
        bindings = {b['parameterHash']: b for b in material['fallbackTextureBindings']}
        assert set(bindings) == set(x['parameterHash'] for x in mapping)
        source = next(iter(bindings.values()))
        assert all(b['variationHash'] == 0 and b['sourceEntry'] == source['sourceEntry'] and b['sourceSection'] == source['sourceSection'] for b in bindings.values())
        section = by_rid[by_rid[source['sourceEntry']]['children'][source['sourceSection']]]
        params = params_under(section['children'][1], set())
        row = {'assetId': mesh['guid'], 'meshName': mesh['name'], 'materialId': material['index'],
               'sourceShader': material['shader'], 'sourceEntry': source['sourceEntry'],
               'sourceSection': source['sourceSection'], 'variationHash': 0, 'bindings': {}, 'constants': [], 'constantEvidence': []}
        for binding in mapping:
            selected = bindings[binding['parameterHash']]
            row['bindings'][binding['role']] = selected
            textures[selected['texture']['fileGuid']] = selected['texture']
        for c in constants:
            matches = [(b, p) for b, p in params if p['packedFlags'] == c['packedLow48']]
            assert len({tuple(p['value']) for _, p in matches}) <= 1
            if matches:
                b, p = matches[0]
                value = p['value']
                provenance = {'kind': 'exact-section-override', 'sourceBlock': b['source']['rid'],
                              'sourceBlockSha256': b['sha256'], 'offset': p['offset'], 'rawHex': p['rawHex']}
            else:
                value = c['default']
                provenance = {'kind': 'rvm-shader-default', 'sourceBlock': c['defaultVectorBlock'], 'sourceOffset': c['defaultSourceOffset']}
            row['constants'].append(value)
            row['constantEvidence'].append(provenance)
        materials.append(row)
assert len(materials) == 20 and len(textures) == 3
assert all(m['constants'][0] == [.5,0,0,0] for m in materials)
strengths = collections.Counter(m['constants'][2][0] for m in materials)
assert strengths == {5000:9, 0:4, 15000:6, 3000:1}, strengths
bytecode = (OUT / '1fb4d25b38.dxbc').read_bytes()
literals = {}
for value in [1.111111, -.111111]:
    found = [(off, struct.unpack_from('<f', bytecode, off)[0]) for off in range(0, len(bytecode)-3, 4)]
    found = [(off, v) for off, v in found if abs(v-value)<.00000051]
    assert found and len(set(v for _,v in found)) == 1
    literals[str(value)] = {'value': found[0][1], 'bytecodeOffsets': [off for off,_ in found]}
report = {'evidenceId': 'LOCAL-CEILING-SHADER-001', 'analysisKind': 'retained-source static decoding; no native execution',
          'shaderName': NAME, 'shaderNameHash': hash_name(NAME), 'shaderGuid': graph['sourceGuid'],
          'sourceRvmSha256': hashlib.sha256(data).hexdigest(), 'pixelShader': '1fb4d25b38',
          'pixelShaderSha256': hashlib.sha256(bytecode).hexdigest(), 'pairedVertexShader': 'dfb8f760fb',
          'functionInstance': 'e99bd8a057', 'function': '1a9345ce96', 'inputKeyTable': 'a414789c08',
          'textureConversionSourceSlots': '8a7393b750', 'textureConversionTargetSlots': '457b8d01cd',
          'applyBlock': '4906a15158', 'applyTextureSlots': 'ba7c4b23cd',
          'constantTableWriteOps': 'ae0e8b9d67', 'constantTableAssembly': '0d382c8953',
          'defaultKeyTable': '9cc8a346b3', 'defaultValueTable': '4b80db2d64',
          'textureMapping': mapping, 'constantMapping': constants, 'sourceLiterals': literals,
          'materials': materials, 'sourceTextures': textures, 'emissiveStrengthCounts': dict(strengths),
          'limitations': [
              'One recovered deferred pixel shader and paired vertex shader; native runtime pass selection remains unobserved.',
              'Only exact default variation=0 material bindings. Other variations and per-instance overrides remain separate.',
              'Native o2.y equals 0.5*metalCS.r; its deferred lighting interpretation is unresolved. Browser leaves metalness at its existing neutral baseline rather than assigning that scalar guessed semantics.',
              'Source packed tangent decoding is unavailable; browser uses derivative UV tangents, whose native tangent parity is unproven.',
              'Source emissive is added to native prelighting before the same cb2[40].x output scale. Browser uses the established linear-radiance scale 1 and shared native map exposure; native global buffer values are not captured.',
              'Exact native sampler states, stream selection, lower-mip filtering and full renderer output are outside this material recovery.'
          ]}
(OUT / 'material-analysis.json').write_text(json.dumps(report, indent=2))
(ROOT / 'exports/materials/ceiling-texture-names.txt').write_text('Objects/Architecture/_GalacticEmpire/_Textures/T_DSI_Ceiling_01_M\n')
print(json.dumps({'materials': len(materials), 'textures': len(textures), 'strengths': dict(strengths), 'constants': constants, 'literals': literals}, indent=2))
