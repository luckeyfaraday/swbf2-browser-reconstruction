"""Source material predicates and pass-separated PropsPreset routes.

The tree is native storage, authored conditions are EBX/compiled values, and
render-pass inputs are deliberately not guessed from a PS filename.
"""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/propspreset-routing'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


t = module('tree', 'propspreset-tree.py')
b = module('binding', 'native-static-atlas-binding.py')
b.EDGES = collections.defaultdict(list)
REVERSE = collections.defaultdict(list)
for edge in t.GRAPH['edges']:
    b.EDGES[edge['from']].append(edge)
    REVERSE[edge['to']].append(edge['from'])
BLOCKS = {x['source']['rid']: x for x in json.loads((ROOT / 'exports/materials/final-map-blocks.json').read_text())['blocks']}
PARAMETERS = {p['packedFlags']: p for block in BLOCKS.values() for p in block.get('parameters', [])}
PACKED_KEYS = {str(int(t.META[k]['values'][0]['hash']) & 0xffffffffffff): k for k in t.KEYS}
SHADERS = {row['hash']: row for row in t.GRAPH['shaders']}
PS = {key for key, row in SHADERS.items() if row['stage'] == 'ps_5_0'}
ENUMS = {x['value']: x['name'] for x in json.loads((ROOT / 'exports/lighting/dfg-native-enums.json').read_text()) if x['type'] == 'ShaderConstantFunction'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def name_hash(name):
    value = 5381
    for character in name.lower():
        value = ((value * 33) ^ ord(character)) & 0xffffffff
    return value


def params_under(key, seen=None):
    seen = set() if seen is None else seen
    if key in seen:
        return []
    seen.add(key)
    block = BLOCKS[key]
    return [(block, p) for p in block.get('parameters', [])] + [p for child in block.get('children', []) for p in params_under(child, seen)]


def conditions():
    result = {}
    for path in sorted((ROOT / 'exports/materials/propspreset-external-conditionals/ebx').glob('*.json')):
        data = json.loads(path.read_text())
        obj = data['asset']['objects'][0]
        if 'ConditionName' not in obj:
            continue
        hashed = name_hash(obj['ConditionName'])
        result[data['asset']['rootInstanceGuid']] = {'name': obj['ConditionName'], 'nameHash': hashed,
            'branches': obj.get('Branches', ['False', 'True']), 'default': obj.get('DefaultValue', 'False'),
            'isGlobal': obj['IsGlobal'], 'sourceAsset': data['entry']['name'],
            'sourceFile': path.relative_to(ROOT).as_posix(), 'sourceSha256': digest(path)}
    return result


def source_rows():
    tree = t.decode()
    defaults = t.source_defaults()
    condition_assets = conditions()
    # Six named authored conditions have exact matching compiled name hashes.
    # The two unnamed Uint8 defaults are NOT assumed and remain free.
    named = {}
    for packed, key in PACKED_KEYS.items():
        source_param = PARAMETERS.get(packed)
        if not source_param:
            continue
        matches = [row for row in condition_assets.values() if row['nameHash'] == source_param['nameHash']]
        if matches:
            assert len(matches) == 1
            named[key] = matches[0]
    assert len(named) == 6, named
    permutation_ps = {i: sorted(b.reachable(key) & PS) for i, key in enumerate(t.PERMUTATIONS)}
    scene = json.loads((ROOT / 'web/public/assets/map.scene.json').read_text())
    placed = collections.Counter(x['assetId'] for x in scene['instances'])
    result = []
    for row in json.loads((ROOT / 'exports/materials/propspreset-shader/sections.json').read_text()):
        first = row['bindings'][0]
        assert all(x['sourceEntry'] == first['sourceEntry'] and x['sourceSection'] == first['sourceSection'] and x['variationHash'] == 0 for x in row['bindings'])
        section = BLOCKS[first['sourceEntry']]['children'][first['sourceSection']]
        params = params_under(section)
        values = {key: {**defaults[key], 'basis': 'authored-shader-default', 'condition': named[key]} for key in named}
        for block, param in params:
            key = PACKED_KEYS.get(param['packedFlags'])
            if key is None:
                continue
            values[key] = {'rawHex': param['rawHex'], 'basis': 'exact-compiled-section', 'sourceBlock': block['source']['rid'],
                           'sourceBlockSha256': block['sha256'], 'sourceOffset': param['offset'], 'nameHash': param['nameHash'],
                           **({'condition': named[key]} if key in named else {})}
        corroborations = []
        for external in row['shader']['ConditionalParameters']:
            identity = external['ConditionalAsset']['classGuid']
            condition = condition_assets[identity]
            key = next(key for key, known in named.items() if known['nameHash'] == condition['nameHash'])
            ordinal = condition['branches'].index(external['Value'])
            assert values[key]['rawHex'] == bytes([ordinal]).hex(), (row['name'], external)
            corroborations.append({'keyBlock': key, 'condition': condition['name'], 'authoredValue': external['Value'], 'ordinal': ordinal})
        hashes = {key: t.hash_value(key, bytes.fromhex(value['rawHex'])) for key, value in values.items()}
        selected = sorted(t.candidates(tree, hashes))
        assert selected
        shaders = sorted({shader for index in selected for shader in permutation_ps[index]})
        ordinary = [shader for shader in shaders if 'dcl_resource_buffer' in shader_text(shader) and shader_text(shader).count('dcl_output ') == 4]
        assert len(ordinary) == 1, (row['name'], ordinary)
        # Prove the unnamed material-looking defaults cannot narrow these routes.
        extra = {key: t.hash_value(key, bytes.fromhex(value['rawHex'])) for key, value in defaults.items()
                 if key in t.KEYS and t.META[key]['values'][0]['type_hash'] == 220002843}
        assert t.candidates(tree, {**hashes, **{k: v for k, v in extra.items() if k not in hashes}}) == set(selected)
        result.append({'assetId': row['assetId'], 'meshName': row['name'], 'materialId': row['materialId'],
            'placementCount': placed[row['assetId']], 'sourceEntry': first['sourceEntry'], 'sourceSection': first['sourceSection'],
            'variationHash': 0, 'conditionValues': {key: {**value, 'hash': str(hashes[key])} for key, value in values.items()},
            'authoredCorroborations': corroborations, 'permutationIndices': selected,
            'permutationBlocks': [t.PERMUTATIONS[i] for i in selected], 'candidatePixelShaders': shaders,
            'ordinaryPixelShader': ordinary[0], 'bindings': row['bindings']})
    return tree, named, result


def shader_text(key):
    return (ROOT / 'exports/materials/propspreset-shader' / (key + '.asm')).read_text()


def slots(key):
    return [value[0] >> 16 for value in struct.iter_unpack('<I', b.raw(key))]


def instance_bindings(pixel):
    queue, seen, instances = [(pixel, [])], set(), {}
    while queue:
        key, path = queue.pop(0)
        if key in seen or len(path) > 8:
            continue
        seen.add(key)
        path = [key] + path
        if b.INDEX[key]['type'].endswith('RvmFunctionInstance'):
            instances[key] = path
        else:
            queue.extend((parent, path) for parent in REVERSE[key])
    result = []
    for instance, path in sorted(instances.items()):
        function = next(child for _, child in b.refs(instance) if b.INDEX[child]['type'].endswith('RvmFunction'))
        reachable = b.reachable(function)
        direct = next(key for key in reachable if b.INDEX[key]['type'].endswith('DirectInputInstructionData'))
        keys = b.refs(b.refs(direct)[0][1])[0][1]
        inputs = [child for _, child in b.refs(keys)]
        combined = next(child for _, child in b.refs(instance) if b.INDEX[child]['type'].endswith('CombinedSerializedParameterBlock'))
        default_values = {}
        for _, block in b.refs(b.refs(combined)[0][1]):
            source_keys, values = [child for _, child in b.refs(block)[:2]]
            assert len(b.refs(source_keys)) * 8 == len(b.raw(source_keys))
            assert len(b.refs(values)) * 8 == len(b.raw(values))
            for (_, parameter), (_, value) in zip(b.refs(source_keys), b.refs(values)):
                payloads = b.refs(value)
                if not payloads:
                    continue
                payload = payloads[0][1]
                default_values.setdefault(parameter, []).append({'parameterBlock': block, 'valueRef': value, 'payloadBlock': payload, 'rawHex': b.raw(payload).hex()})
        converted, producers = {}, {}
        for key in sorted(reachable):
            if b.INDEX[key]['type'].endswith('Dx11TextureConversionInstructionData'):
                source, destination = [child for _, child in b.refs(key)]
                converted.update({dst: {'sourceSlot': src, 'conversionInstruction': key} for src, dst in zip(slots(source), slots(destination))})
            if b.INDEX[key]['type'].endswith('LegacyInstructionData'):
                for at in range(0, len(b.raw(key)), 20):
                    raw = b.raw(key)[at:at + 20]
                    slot = struct.unpack_from('<I', raw, 12)[0] >> 16
                    selector = struct.unpack_from('<H', raw, 16)[0]
                    producers[slot] = {'block': key, 'record': at // 20, 'rawHex': raw.hex(), 'selector': selector, 'name': ENUMS.get(selector)}
        textures, samplers = [], []
        for key in sorted(reachable):
            if not b.INDEX[key]['type'].endswith('Dx11ApplyParametersBlock'):
                continue
            raw = b.raw(key)
            for at in range(0, len(raw), 16):
                stage, kind, first = raw[at:at + 3]
                count = struct.unpack_from('<I', raw, at + 4)[0]
                if stage != 1 or kind not in [1, 2]:
                    continue
                register_slots = b.ref(struct.unpack_from('<Q', raw, at + 8)[0])
                for register, slot in enumerate(slots(register_slots), first):
                    row = {'register': ('t' if kind == 1 else 's') + str(register), 'applyBlock': key,
                           'applyRecord': at // 16, 'registerSlots': register_slots, 'slot': slot}
                    if kind == 1:
                        if slot not in converted:
                            # Native buffer bindings can bypass texture conversion.
                            row['producer'] = producers.get(slot)
                            textures.append(row)
                            continue
                        row.update(converted[slot])
                        source = row['sourceSlot']
                        if source in producers:
                            row['producer'] = producers[source]
                        else:
                            parameter = inputs[source]
                            packed = str(int(b.META[parameter]['values'][0]['hash']) & 0xffffffffffff)
                            row.update({'parameterKey': parameter, 'packedLow48': packed,
                                        'parameterHash': PARAMETERS.get(packed, {}).get('nameHash')})
                        textures.append(row)
                    else:
                        parameter = inputs[slot]
                        values = default_values[parameter]
                        assert len(values) == 1
                        row.update({'parameterKey': parameter, **values[0]})
                        samplers.append(row)
        constants = []
        for key in sorted(reachable):
            if not b.INDEX[key]['type'].endswith('WriteOp'):
                continue
            for encoded, offset, count in struct.iter_unpack('<IHH', b.raw(key)):
                slot = encoded >> 16
                if slot >= len(inputs):
                    continue
                parameter = inputs[slot]
                if t.META[parameter]['values'][0]['type_hash'] != 193460885:
                    continue
                values = default_values.get(parameter, [])
                if not values:
                    continue
                assert len(values) == 1
                packed = str(int(b.META[parameter]['values'][0]['hash']) & 0xffffffffffff)
                constants.append({'writeOp': key, 'offset': offset, 'count': count, 'slot': slot, 'parameterKey': parameter,
                                  'packedLow48': packed, 'parameterHash': PARAMETERS.get(packed, {}).get('nameHash'), **values[0]})
        vertex = [key for key in b.reachable(combined) if b.INDEX[key]['type'].endswith('Dx11VsShader')]
        assert len(vertex) == 1
        result.append({'instance': instance, 'function': function, 'pixelSelectionChain': path,
            'pairedVertexShader': b.refs(vertex[0])[0][1], 'directInput': direct, 'inputKeyTable': keys,
            'textureMapping': sorted(textures, key=lambda x: int(x['register'][1:])),
            'samplerMapping': sorted(samplers, key=lambda x: int(x['register'][1:])), 'constantMapping': constants})
    return result


def main():
    tree, named, rows = source_rows()
    # Deferred SH shaders are unique after authored predicates, independently of
    # forward/deferred pass choice. Atlas shaders are classified by native roles.
    ordinary = sorted({row['ordinaryPixelShader'] for row in rows})
    candidates = sorted({ps for row in rows for ps in row['candidatePixelShaders'] if shader_text(ps).count('dcl_output ') == 4})
    shaders = {}
    for ps in candidates:
        instances = instance_bindings(ps)
        assert instances
        selectors = [{x['producer']['selector'] for x in row['textureMapping'] if x.get('producer')} for row in instances]
        atlas = all(set(range(18, 23)) == values for values in selectors)
        shaders[ps] = {'pixelShader': ps, 'sha256': SHADERS[ps]['sha256'],
            'classification': 'deferred-SH' if ps in ordinary else 'deferred-native-five-atlas' if atlas else 'other-deferred-lighting-route',
            'instances': instances}
    for row in rows:
        row['atlasPixelShaders'] = [ps for ps in row['candidatePixelShaders'] if shaders.get(ps, {}).get('classification') == 'deferred-native-five-atlas']
        assert len(row['atlasPixelShaders']) <= 1
        instance = shaders[row['ordinaryPixelShader']]['instances'][0]
        # This key feeds the vertex cb0 instance table descriptor, not pixel cb1.
        pixel_constants = [x for x in instance['constantMapping'] if x['packedLow48'] != '3022048275306']
        expected_count = int(re.search(r'dcl_constantbuffer CB1\[(\d+)\]', shader_text(row['ordinaryPixelShader'])).group(1))
        assert len(pixel_constants) == expected_count
        assert sorted(x['offset'] for x in pixel_constants) == list(range(0, expected_count * 16, 16))
        section = BLOCKS[row['sourceEntry']]['children'][row['sourceSection']]
        section_params = params_under(section)
        row['pixelConstants'] = []
        for constant in sorted(pixel_constants, key=lambda x: x['offset']):
            matches = [(block, param) for block, param in section_params if param['packedFlags'] == constant['packedLow48']]
            assert len({param['rawHex'] for _, param in matches}) <= 1
            if matches:
                block, param = matches[0]
                raw_hex = param['rawHex']
                source = {'kind': 'exact-section-override', 'sourceBlock': block['source']['rid'], 'sourceBlockSha256': block['sha256'], 'sourceOffset': param['offset']}
            else:
                raw_hex = constant['rawHex']
                source = {'kind': 'rvm-default', 'parameterBlock': constant['parameterBlock'], 'payloadBlock': constant['payloadBlock']}
            row['pixelConstants'].append({'register': f'cb1[{constant["offset"] // 16}]', 'parameterKey': constant['parameterKey'],
                'packedLow48': constant['packedLow48'], 'rawHex': raw_hex, 'value': list(struct.unpack('<4f', bytes.fromhex(raw_hex))), 'source': source})
    groups = []
    for ps in ordinary:
        members = [row for row in rows if row['ordinaryPixelShader'] == ps]
        groups.append({'ordinaryPixelShader': ps, 'atlasPixelShaders': sorted({p for row in members for p in row['atlasPixelShaders']}),
                       'sectionCount': len(members), 'placedSectionCount': sum(row['placementCount'] for row in members)})
    result = {'evidenceId': 'BF2-PROPSPRESET-PERMUTATION-ROUTING-001', 'runtimeObserved': False,
        'sourceShader': 'Shaders/Presets/Walrus/SS_PropsPreset', 'sourceRvmSha256': hashlib.sha256(t.DATA).hexdigest(),
        'nativeDeserializer': {'address': '0x1414ff520', 'treeBuilder': '0x1415045b0',
            'targetSha256': json.loads((ROOT / 'exports/materials/propspreset-native/seeds.json').read_text())['targetSha256'],
            'evidenceDirectory': 'exports/materials/propspreset-native/functions',
            'retainedDecompilations': {name: digest(ROOT / 'exports/materials/propspreset-native/functions' / name) for name in ['1414ff520.c', '1415045b0.c']}},
        'tree': {'rootBlock': '5aac7893cf', 'wordBlock': '1e5b378a94', 'words': tree['wordCount'],
                 'decodedNodes': len(tree['nodes']), 'backreferences': len(tree['backreferences']),
                 'reachablePermutationLeaves': len(t.candidates(tree, {})), 'byteCoverageComplete': True},
        'valueHash': {'equation': 'CityHash64WithSeed(rawParameterValue, fullSerializedParamDbKeyHash)',
                      'validation': 'Exact source branch hash agreement plus authored branch ordinals; not a native hash-function execution capture.'},
        'conditions': named, 'materialGroups': groups, 'sections': rows, 'shaders': shaders,
        'limitations': ['Retained 27-section subset, default variation 0; remaining PropsPreset sections are outside this artifact.',
                       'Native live pass selection is not captured. Other deferred/forward lighting routes remain enumerated, not reclassified by texture count.',
                       'Unnamed tree inputs remain free; assigning the two unnamed Uint8 defaults does not narrow these section routes.',
                       'Runtime material overrides beyond the selected compiled map sections are not observed.',
                       'This artifact resolves material predicates and bindings; material/atlas arithmetic parity and browser implementation are separate.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'routing-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    (OUT / 'decoded-tree.json').write_text(json.dumps(tree, indent=2) + '\n')
    print(json.dumps({'sections': len(rows), 'placements': sum(row['placementCount'] for row in rows), 'groups': groups}))


if __name__ == '__main__':
    main()
