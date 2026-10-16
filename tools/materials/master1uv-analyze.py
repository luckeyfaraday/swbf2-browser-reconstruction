"""Recover only exact default SS_DSI_Master_1UV material inputs from retained source."""
import collections, hashlib, json, pathlib, struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/master1uv-shader'
NAME = 'Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_1UV'
data = (ROOT / 'exports/materials/rvm/0.res').read_bytes()
index = json.loads((ROOT / 'exports/materials/rvm/block-index.json').read_text())['blocks']
metadata = json.loads((ROOT / 'exports/materials/rvm/material-blocks.json').read_text())
split = json.loads((ROOT / 'exports/materials/final-map-blocks.json').read_text())['blocks']
by_rid = {b['source']['rid']: b for b in split}
plan = json.loads((ROOT / 'exports/materials/final-map-material-plan.json').read_text())
graph = json.loads((OUT / 'graph.json').read_text())

def raw(key):
    b = index[key]
    return data[b['offset']:b['offset'] + b['size']]

def ref(value):
    return f'{int(value) & 0xffffffffff:010x}'

def slots(key):
    return [v[0] >> 16 for v in struct.iter_unpack('<I', raw(key))]

def name_hash(name):
    value = 5381
    for ch in name.lower():
        value = ((value * 33) ^ ord(ch)) & 0xffffffff
    return value

def children_parameters(rid):
    result, seen = [], set()
    def walk(key):
        if key in seen:
            return
        seen.add(key)
        block = by_rid[key]
        result.extend((block, p) for p in block.get('parameters', []))
        for child in block.get('children', []):
            walk(child)
    walk(rid)
    return result

assert name_hash(NAME) == 2187307923 == graph['sourceNameHash']
assert name_hash(NAME.replace('Master_1UV', 'Floor_01')) == 1716682052
read_keys = metadata['f2fe391cdd']['values']
default_keys = metadata['4b28a49641']['values']
default_values = metadata['541889478c']['values']
source_slots = slots('2a2f606571')
converted_slots = slots('ecc9f1548b')
register_slots = slots('2e727fe77c')
assert source_slots == [1, 12, 36, 13, 42, 15, 5, 35, 2, 37]
assert converted_slots == list(range(49, 59))
assert register_slots == [57, 56, 54, 58, 52, 51, 55, 53, 49, 50]
conversion = dict(zip(converted_slots, source_slots))
assert raw('2b424e23f3')[32:40] == bytes.fromhex('010102000a000000')
source_params = {p['packedFlags']: p for b in split for p in b.get('parameters', [])}
roles = ['globalWear', 'wear', 'id', 'normalAO', 'grunge', 'anodized', 'rubber', 'metalCS', 'metalNormal', 'aluminium']
mapping = []
for register, (role, converted) in enumerate(zip(roles, register_slots), 2):
    slot = conversion[converted]
    key = ref(read_keys[slot]['hash'])
    parameter = metadata[key]['values'][0]
    packed = str(int(parameter['hash']) & 0xffffffffffff)
    mapping.append({'register': f't{register}', 'role': role, 'convertedSlot': converted,
                    'inputSlot': slot, 'parameterKeyBlock': key, 'packedLow48': packed,
                    'parameterHash': source_params[packed]['nameHash']})
write_ops = list(struct.iter_unpack('<IHH', raw('97ecbf962a')))
assert [(v >> 16, offset, count) for v, offset, count in write_ops] == [
    (33, 0, 1), (21, 0, 1), (26, 16, 1), (14, 32, 1), (48, 48, 1),
    (24, 64, 1), (40, 80, 1), (45, 96, 1), (0, 112, 1), (31, 128, 1)]
constant_roles = ['depositedColor', 'uvScale', 'restoreDivisor', 'scratchColor',
                  'anodizedColor', 'anodizedSmoothnessScale', 'rubberColor',
                  'rubberSmoothnessScale', 'metalColor']
constants = []
for cb, ((encoded, offset, _), role) in enumerate(zip(write_ops[1:], constant_roles)):
    slot = encoded >> 16
    key = ref(read_keys[slot]['hash'])
    packed = str(int(metadata[key]['values'][0]['hash']) & 0xffffffffffff)
    default_index = [ref(k['hash']) for k in default_keys].index(key)
    value_ref = ref(default_values[default_index]['hash'])
    vector = ref(metadata[value_ref]['values'][0]['hash'])
    value = list(struct.unpack('<4f', raw(vector)))
    constants.append({'register': f'cb1[{cb}]', 'role': role, 'inputSlot': slot,
                      'parameterKeyBlock': key, 'packedLow48': packed,
                      'parameterHash': source_params[packed]['nameHash'],
                      'defaultIndex': default_index, 'defaultVectorBlock': vector,
                      'defaultSourceOffset': index[vector]['offset'], 'default': value})

materials, textures = [], {}
for mesh in plan['meshes']:
    for material in mesh['materials']:
        if (material.get('shader') or {}).get('name', '').lower() != NAME.lower():
            continue
        bindings = {b['parameterHash']: b for b in material['fallbackTextureBindings']}
        assert set(x['parameterHash'] for x in mapping) == set(bindings)
        source = next(iter(bindings.values()))
        assert all(b['variationHash'] == 0 and b['sourceEntry'] == source['sourceEntry'] and
                   b['sourceSection'] == source['sourceSection'] for b in bindings.values())
        section = by_rid[by_rid[source['sourceEntry']]['children'][source['sourceSection']]]
        params = children_parameters(section['children'][1])
        row = {'assetId': mesh['guid'], 'meshName': mesh['name'], 'materialId': material['index'],
               'sourceShader': material['shader'], 'sourceEntry': source['sourceEntry'],
               'sourceSection': source['sourceSection'], 'variationHash': 0,
               'bindings': {}, 'constants': [], 'constantEvidence': []}
        for binding in mapping:
            selected = bindings[binding['parameterHash']]
            row['bindings'][binding['role']] = selected
            textures[selected['texture']['fileGuid']] = selected['texture']
        for c in constants:
            matches = [(b, p) for b, p in params if p['packedFlags'] == c['packedLow48']]
            unique = {tuple(p['value']) for _, p in matches}
            assert len(unique) <= 1, (mesh['name'], material['index'], c['role'], matches)
            if matches:
                block, p = matches[0]
                value = p['value']
                evidence = {'kind': 'exact-section-override', 'sourceBlock': block['source']['rid'],
                            'sourceBlockSha256': block['sha256'], 'offset': p['offset'], 'rawHex': p['rawHex']}
            else:
                value = c['default']
                evidence = {'kind': 'rvm-shader-default', 'sourceBlock': c['defaultVectorBlock'],
                            'sourceOffset': c['defaultSourceOffset']}
            row['constants'].append(value)
            row['constantEvidence'].append(evidence)
        materials.append(row)
assert len(materials) == 114 and len(textures) == 52
assert materials[0]['constants'][1] == [4, 4, 0, 0]
bytecode = (OUT / '6d0dd89b35.dxbc').read_bytes()
literal_offsets = {}
for value in [0.323143, 0.171441, 0.042311, 0.007499]:
    candidates = [(off, struct.unpack_from('<f', bytecode, off)[0]) for off in range(0, len(bytecode) - 3, 4)]
    candidates = [(off, v) for off, v in candidates if abs(v - value) < 0.00000051]
    assert candidates and len(set(v for _, v in candidates)) == 1
    literal_offsets[str(value)] = {'value': candidates[0][1], 'bytecodeOffsets': [off for off, _ in candidates]}
report = {'evidenceId': 'LOCAL-MASTER1UV-SHADER-001', 'analysisKind': 'retained-source static decoding; no native execution',
          'shaderName': NAME, 'shaderNameHash': name_hash(NAME), 'shaderGuid': graph['sourceGuid'],
          'sourceRvmSha256': hashlib.sha256(data).hexdigest(), 'pixelShader': '6d0dd89b35',
          'pixelShaderSha256': hashlib.sha256(bytecode).hexdigest(), 'pairedVertexShader': '3eba974d4e',
          'functionInstance': 'abdc8ff04f', 'function': 'e36b651825', 'inputKeyTable': 'f2fe391cdd',
          'textureConversionSourceSlots': '2a2f606571', 'textureConversionTargetSlots': 'ecc9f1548b',
          'applyBlock': '2b424e23f3', 'applyTextureSlots': '2e727fe77c',
          'constantTableWriteOps': '97ecbf962a', 'constantTableAssembly': 'b2c7ee8ddd',
          'defaultKeyTable': '4b28a49641', 'defaultValueTable': '541889478c',
          'textureMapping': mapping, 'constantMapping': constants, 'sourceLiterals': literal_offsets,
          'materials': materials, 'sourceTextures': textures,
          'limitations': [
              'This is one recovered deferred pixel shader and its paired vertex shader, not proof of native pass selection at runtime.',
              'All 114 materials use exact default variation=0, source LOD/section bindings. Other variations and instance parameter overrides are outside this mapping.',
              'Apply-block and constant table interpretations are corroborated by declared registers, offsets and matching parameter-key hashes; complete RVM instruction ABI is not claimed.',
              'Tangent frame must match the native vertex shader; derivative tangents are an approximation. Source vertex shader negates tangent and cross-product bitangent.',
              'BF2-NATIVE-GBUFFER-001 independently establishes ordinary materialID0: o2.y is metalness and o2.z is reflectance; this shader writes reflectance=0.5, yielding dielectric F0=0.04. Native GBuffer view quantization remains unresolved.',
              'Textures remain packed data; do not infer sRGB from their asset names. Exact source pixel-format color space is retained in texture metadata.',
              'Native lighting, filtering, mip selection, exposure, tone mapping and framebuffer packing are outside material equation equivalence.'
          ]}
(OUT / 'material-analysis.json').write_text(json.dumps(report, indent=2))
(ROOT / 'exports/materials/master1uv-texture-names.txt').write_text('\n'.join(sorted(t['name'] for t in textures.values())) + '\n')
print(json.dumps({'evidenceId': report['evidenceId'], 'materials': len(materials), 'textures': len(textures),
                  'overrideCounts': dict(collections.Counter(c['role'] for m in materials for c, e in zip(constants, m['constantEvidence']) if e['kind'] == 'exact-section-override')),
                  'sourceLiterals': literal_offsets}, indent=2))
