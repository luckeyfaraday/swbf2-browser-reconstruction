"""Source-bound recovery of the exact default SS_DSI_Master_1UV_MetalOnly_01 shader family."""
import collections, hashlib, json, pathlib, struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/metalonly-shader'
NAME = 'Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_1UV_MetalOnly_01'
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

assert hash_name(NAME) == graph['sourceNameHash'] == 1443790615
assert hash_name('Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Floor_01') == 1716682052
selection_chain = ['7aef323547','359fc0c12b','88ef901432','7ddbb57017','c58522a619',
                   '84924a2f40','a1d50dd3b1','41e6803068','dcb5cd9fb7','1630787c07','8b2faf13f5','85476b5805']
for parent, child in zip(selection_chain, selection_chain[1:]):
    assert any(e['from'] == parent and e['to'] == child for e in graph['edges']), (parent,child)
# Paired VS is a value in the same function instance's default parameter block.
assert ref(meta['dcb5cd9fb7']['values'][22]['hash']) == 'ec22b366f4'
assert ref(meta['ec22b366f4']['values'][0]['hash']) == 'fb0aa25ab6'
assert ref(struct.unpack_from('<Q',raw('fb0aa25ab6'),32)[0]) == '282854795b'
read_keys = meta['4cecccdddb']['values']
default_keys = meta['b49c958d4a']['values']
default_values = meta['dcb5cd9fb7']['values']
assert slots('a11a85b8e5') == [1,11,12,37,32,2,33]
assert slots('11a4e3bdf6') == [42,43,44,45,46,47,48]
assert slots('f44b2a5edb') == [47,46,48,44,45,42,43]
assert raw('bf19fc5fc7')[32:40] == bytes.fromhex('0101020007000000')
conversion = dict(zip(slots('11a4e3bdf6'), slots('a11a85b8e5')))
mapping = []
for register, (role, converted) in enumerate(zip(['globalWear','wear','normalAO','grunge','metalCS','metalNormal','aluminium'], slots('f44b2a5edb')), 2):
    slot = conversion[converted]
    key = ref(read_keys[slot]['hash'])
    packed = str(int(meta[key]['values'][0]['hash']) & 0xffffffffffff)
    mapping.append({'register': f't{register}', 'role': role, 'convertedSlot': converted, 'inputSlot': slot,
                    'parameterKeyBlock': key, 'packedLow48': packed, 'parameterHash': parameters[packed]['nameHash']})
writes = list(struct.iter_unpack('<IHH', raw('67fd408071')))
assert [(v >> 16, offset, count) for v, offset, count in writes] == [(30,0,1),(19,0,1),(23,16,1),(13,32,1),(0,48,1),(28,64,1)]
constants = []
for cb, ((encoded, offset, _), role) in enumerate(zip(writes[1:], ['depositedColor','uvScale','restoreDivisor','scratchColor','metalColor'])):
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
                # Decimal JSON text can be rounded by the extractor. Recover the
                # exact stored float32 values from the retained parameter bytes.
                value = list(struct.unpack('<4f',bytes.fromhex(p['rawHex'])))
                provenance = {'kind': 'exact-section-override', 'sourceBlock': b['source']['rid'],
                              'sourceBlockSha256': b['sha256'], 'offset': p['offset'], 'rawHex': p['rawHex']}
            else:
                value = c['default']
                provenance = {'kind': 'rvm-shader-default', 'sourceBlock': c['defaultVectorBlock'], 'sourceOffset': c['defaultSourceOffset']}
            row['constants'].append(value)
            row['constantEvidence'].append(provenance)
        materials.append(row)
assert len(materials) == 17 and len(textures) == 10
scene = json.loads((ROOT/'web/public/assets/map.scene.json').read_text())
placed = collections.Counter(row['assetId'] for row in scene['instances'])
for material in materials: material['placementCount'] = placed[material['assetId']]
assert sum(m['placementCount'] for m in materials) == 950
family_counts = collections.defaultdict(lambda: {'sections':0,'placedSections':0})
for mesh in plan['meshes']:
    for material in mesh['materials']:
        family = (material.get('shader') or {}).get('name','UNKNOWN')
        family_counts[family]['sections'] += 1
        family_counts[family]['placedSections'] += placed[mesh['guid']]
forward = (OUT/'a5440e5203.asm').read_text()
forward_ops = ['mad_sat r1.w, r4.x, r1.w, r3.z',
               'add r5.xy, -r1.wwww, l(1.000000, 0.937500, 0.000000, 0.000000)',
               'mul r1.y, r5.x, r5.x',
               'sample_l_indexable(texture2d)(float,float,float,float) r1.x, r1.xyxx, t2.zxyw, s1, l(0.000000)']
assert all(op in forward for op in forward_ops)
profile_path = ROOT/'web/test-results/actual-map-native-lods.json'
profile = json.loads(profile_path.read_text())
selected_ids = {m['assetId'] for m in materials}
visible_assets = [a for a in profile['spawnGeometry']['assets'] if a['id'] in selected_ids]
pixel_text = (OUT/'85476b5805.asm').read_text()
gbuffer_outputs = ['mov o0.w, l(0)','mov o2.xz, l(0,0,0.500000,0)']
assert all(op in pixel_text for op in gbuffer_outputs)
consumer_folder = ROOT/'exports/lighting/dfg-gbuffer'
consumer_manifest = json.loads((consumer_folder/'manifest.json').read_text())
consumers = [c for c in consumer_manifest if c['file'] in ('point-specular','combine-ibl')]
assert len(consumers) == 2
consumer_operations = {
    'point-specular': ['movc r1.w, r0.w, l(0), r4.y','add r0.w, -r1.w, l(1.000000)',
                       'mul r1.xyz, r0.wwww, r3.xyzx','mul r3.w, r3.w, r4.z',
                       'mul r3.w, r3.w, r3.w','mul r4.x, r3.w, l(0.160000)',
                       'mad r3.xyz, r1.wwww, r3.xyzx, r4.xxxx'],
    'combine-ibl': ['movc r2.y, r1.w, l(0), r4.y','mul r2.z, r2.z, r4.z',
                    'mul r2.z, r2.z, r2.z','mul r2.w, r2.z, l(0.160000)',
                    'mad r4.xyz, r2.yyyy, r4.xyzx, r2.wwww']}
for consumer in consumers:
    assert hashlib.sha256((consumer_folder/(consumer['file']+'.dxbc')).read_bytes()).hexdigest() == consumer['sha256']
    assembly = (consumer_folder/(consumer['file']+'.asm')).read_text()
    assert all(op in assembly for op in consumer_operations[consumer['file']])
    consumer['operations'] = consumer_operations[consumer['file']]
bytecode = (OUT / '85476b5805.dxbc').read_bytes()
literals = {}
for value in [.323143,.171441,.042311,.007499]:
    found = [(off, struct.unpack_from('<f', bytecode, off)[0]) for off in range(0, len(bytecode)-3, 4)]
    found = [(off, v) for off, v in found if abs(v-value)<.00000051]
    assert found and len(set(v for _,v in found)) == 1
    literals[str(value)] = {'value': found[0][1], 'bytecodeOffsets': [off for off,_ in found]}
report = {'evidenceId': 'LOCAL-METALONLY-SHADER-001', 'analysisKind': 'retained-source static decoding; no native execution',
          'shaderName': NAME, 'shaderNameHash': hash_name(NAME), 'shaderGuid': graph['sourceGuid'],
          'sourceRvmSha256': hashlib.sha256(data).hexdigest(), 'pixelShader': '85476b5805',
          'pixelShaderSha256': hashlib.sha256(bytecode).hexdigest(), 'pairedVertexShader': '282854795b',
          'pairedVertexShaderSha256': hashlib.sha256((OUT/'282854795b.dxbc').read_bytes()).hexdigest(),
          'selectionChain': [{'block':k, **index[k]} for k in selection_chain],
          'functionInstance': 'c58522a619', 'function': '2b5e19a674', 'inputKeyTable': '4cecccdddb',
          'textureConversionSourceSlots': 'a11a85b8e5', 'textureConversionTargetSlots': '11a4e3bdf6',
          'applyBlock': 'bf19fc5fc7', 'applyTextureSlots': 'f44b2a5edb',
          'constantTableWriteOps': '67fd408071', 'constantTableAssembly': 'f09bd63671',
          'defaultKeyTable': 'b49c958d4a', 'defaultValueTable': 'dcb5cd9fb7',
          'textureMapping': mapping, 'constantMapping': constants, 'sourceLiterals': literals,
          'materials': materials, 'sourceTextures': textures, 'placedSectionCount': sum(m['placementCount'] for m in materials),
          'familyCoverage': sorted([{'shader':name,**counts} for name,counts in family_counts.items()],key=lambda r:-r['placedSections']),
          'forwardRoughnessEvidence': {'shader':'a5440e5203','sha256':hashlib.sha256((OUT/'a5440e5203.dxbc').read_bytes()).hexdigest(),
                                      'operations':forward_ops,'interpretation':'Clamp final source smoothness, complement it, square the complement before native DFG lookup.'},
          'retainedVisibility': {'profilePath':profile_path.relative_to(ROOT).as_posix(),
                                 'profileSha256':hashlib.sha256(profile_path.read_bytes()).hexdigest(),
                                 'visibleAssets':visible_assets,'triangles':sum(a['triangles'] for a in visible_assets),
                                 'scope':'Full visible mesh assets containing selected MetalOnly sections, not section-specific triangle counts.'},
          'nativeMaterialModel': {'evidenceId':'BF2-NATIVE-GBUFFER-001','sourceManifest':'exports/lighting/dfg-gbuffer/manifest.json',
                                  'materialId':0,'reflectance':.5,'dielectricF0':.04,'producerOperations':gbuffer_outputs,
                                  'metalness':'Recovered source o2.y materialScalar',
                                  'consumerEquations':'diffuse=(1-metalness)*baseColor; F0=mix(0.16*reflectance^2,baseColor,metalness)',
                                  'consumers':consumers,'scope':'Ordinary material ID0 in two gbLayout=0 native deferred consumers; native runtime pass selection remains unobserved.'},
          'limitations': [
              'One recovered deferred pixel shader and paired vertex shader; native runtime pass selection remains unobserved.',
              'Only exact default variation=0 material bindings. Other variations and per-instance overrides remain separate.',
              'Native material ID0 metalness/reflectance interpretation is established by two gbLayout=0 deferred consumers. Three reproduces their diffuse/F0 parameter conversion but not every native BRDF or reflection operation.',
              'Source packed tangent decoding is unavailable; browser uses derivative UV tangents, whose native tangent parity is unproven.',
              'Exact native sampler states, stream selection, lower-mip filtering and full renderer output are outside this material recovery.'
          ]}
(OUT / 'material-analysis.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'materials':len(materials),'textures':len(textures),'placements':report['placedSectionCount'],'constants':constants,'textureMapping':mapping,'literals':literals},indent=2))
