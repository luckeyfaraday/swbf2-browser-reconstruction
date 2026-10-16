"""Bounded Master2UV atlas RVM routing, using retained bytes only."""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/master2uv-static-atlas'
spec = importlib.util.spec_from_file_location('binding', Path(__file__).with_name('native-static-atlas-binding.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
GRAPH = json.loads((ROOT / 'exports/materials/master2uv-shader/graph.json').read_text())
BASE = json.loads((ROOT / 'exports/materials/master2uv-shader/material-analysis.json').read_text())
b.EDGES = collections.defaultdict(list)
reverse = collections.defaultdict(list)
for edge in GRAPH['edges']:
    b.EDGES[edge['from']].append(edge)
    reverse[edge['to']].append(edge['from'])


def slots(key):
    return [value[0] >> 16 for value in struct.iter_unpack('<I', b.raw(key))]


def material_sampler(instance, function):
    reachable = b.reachable(function)
    candidates = []
    for key in reachable:
        if not b.INDEX[key]['type'].endswith('Dx11ApplyParametersBlock'):
            continue
        raw = b.raw(key)
        for at in range(0, len(raw), 16):
            stage, kind, first = raw[at:at + 3]
            count = struct.unpack_from('<I', raw, at + 4)[0]
            if stage == 1 and kind == 2 and first <= 1 < first + count:
                table = b.ref(struct.unpack_from('<Q', raw, at + 8)[0])
                candidates.append((key, at // 16, table, slots(table)[1 - first]))
    assert len(candidates) == 1
    apply, record, table, slot = candidates[0]
    direct = next(key for key in reachable if b.INDEX[key]['type'].endswith('DirectInputInstructionData'))
    keys = b.refs(b.refs(direct)[0][1])[0][1]
    parameter = b.refs(keys)[slot][1]
    combined = next(child for _, child in b.refs(instance) if b.INDEX[child]['type'].endswith('CombinedSerializedParameterBlock'))
    matches = []
    for _, block in b.refs(b.refs(combined)[0][1]):
        source_keys, values = [child for _, child in b.refs(block)[:2]]
        for index, (_, candidate) in enumerate(b.refs(source_keys)):
            if candidate != parameter:
                continue
            value = b.refs(values)[index][1]
            sampler = b.refs(value)[0][1]
            matches.append({'parameterBlock': block, 'parameterIndex': index, 'valueRef': value,
                            'sampler': sampler, 'samplerBytes': b.raw(sampler).hex()})
    assert len(matches) == 1
    assert matches[0]['sampler'] == BASE['samplerMapping']['samplerBlock'] == '5993a514cd'
    return {'register': 's1', 'ordinaryRegister': 's0', 'applyBlock': apply, 'applyRecord': record,
            'registerSlots': table, 'inputSlot': slot, 'parameter': parameter, **matches[0],
            'packedSamplerBytes16to19': list(b.raw(matches[0]['sampler'])[16:20])}


def main():
    queue, seen, instances = [('cae11f0532', [])], set(), {}
    while queue:
        key, path = queue.pop(0)
        if key in seen or len(path) > 8:
            continue
        seen.add(key)
        path = path + [key]
        if b.INDEX[key]['type'].endswith('RvmFunctionInstance'):
            instances[key] = list(reversed(path))
        else:
            queue.extend((parent, path) for parent in reverse[key])
    assert len(instances) == 1
    enums = {x['value']: x['name'] for x in json.loads((ROOT / 'exports/lighting/dfg-native-enums.json').read_text()) if x['type'] == 'ShaderConstantFunction'}
    results = []
    for instance, path in sorted(instances.items()):
        function = next(child for _, child in b.refs(instance) if b.INDEX[child]['type'].endswith('RvmFunction'))
        reachable = b.reachable(function)
        direct = next(key for key in reachable if b.INDEX[key]['type'].endswith('DirectInputInstructionData'))
        view = b.refs(direct)[0][1]
        keys = b.refs(view)[0][1]
        inputs = [child for _, child in b.refs(keys)]
        converted, producers = {}, {}
        for key in reachable:
            if b.INDEX[key]['type'].endswith('Dx11TextureConversionInstructionData'):
                source, destination = [child for _, child in b.refs(key)]
                converted.update({dst: {'sourceSlot': src, 'instruction': key, 'sourceSlots': source, 'destinationSlots': destination}
                                  for src, dst in zip(slots(source), slots(destination))})
            if b.INDEX[key]['type'].endswith('LegacyInstructionData'):
                for at in range(0, len(b.raw(key)), 20):
                    raw = b.raw(key)[at:at + 20]
                    slot = struct.unpack_from('<I', raw, 12)[0] >> 16
                    selector = struct.unpack_from('<H', raw, 16)[0]
                    producers[slot] = {'block': key, 'record': at // 20, 'rawHex': raw.hex(), 'selector': selector, 'name': enums.get(selector)}
        textures = []
        for key in reachable:
            if not b.INDEX[key]['type'].endswith('Dx11ApplyParametersBlock'):
                continue
            raw = b.raw(key)
            for at in range(0, len(raw), 16):
                stage, kind, first = raw[at:at + 3]
                count = struct.unpack_from('<I', raw, at + 4)[0]
                if stage != 1 or kind != 1:
                    continue
                register_slots = b.ref(struct.unpack_from('<Q', raw, at + 8)[0])
                for register, converted_slot in enumerate(slots(register_slots), first):
                    conversion = converted[converted_slot]
                    source_slot = conversion['sourceSlot']
                    row = {'register': 't' + str(register), 'applyBlock': key, 'applyRecord': at // 16,
                           'registerSlots': register_slots, 'convertedSlot': converted_slot, **conversion}
                    if register < 7:
                        row['producer'] = producers[source_slot]
                        assert row['producer']['selector'] == register + 16
                    else:
                        parameter = inputs[source_slot]
                        packed = str(int(b.META[parameter]['values'][0]['hash']) & 0xffffffffffff)
                        original = next(x for x in BASE['textureMapping'] if x['packedLow48'] == packed)
                        assert int(original['register'][1:]) + 5 == register
                        row.update({'parameterKeyBlock': parameter, 'packedLow48': packed, 'role': original['role'], 'ordinaryRegister': original['register']})
                    textures.append(row)
        assert sorted(x['register'] for x in textures) == sorted('t' + str(i) for i in range(2, 18))
        writes = next(key for key in reachable if b.INDEX[key]['type'].endswith('WriteOp'))
        constants = []
        for encoded, offset, count in struct.iter_unpack('<IHH', b.raw(writes)):
            parameter = inputs[encoded >> 16]
            packed = str(int(b.META[parameter]['values'][0]['hash']) & 0xffffffffffff)
            original = next((x for x in BASE['constantMapping'] if x['packedLow48'] == packed), None)
            if original:
                assert count == 1 and original['register'] == f'cb1[{offset // 16}]'
                constants.append({'register': original['register'], 'role': original['role'], 'parameterKeyBlock': parameter,
                                  'packedLow48': packed, 'writeOpBlock': writes, 'sourceSlot': encoded >> 16, 'byteOffset': offset})
        assert len(constants) == 9
        combined = next(child for _, child in b.refs(instance) if b.INDEX[child]['type'].endswith('CombinedSerializedParameterBlock'))
        defaults = b.reachable(combined)
        vertex = [key for key in defaults if b.INDEX[key]['type'].endswith('Dx11VsShader')]
        assert len(vertex) == 1
        vertex_bytecode = b.refs(vertex[0])[0][1]
        results.append({'instance': instance, 'function': function, 'pixelSelectionChain': path,
                        'pairedVertexShader': vertex_bytecode, 'vertexShaderObject': vertex[0],
                        'directInput': direct, 'parameterKeys': keys, 'textureMapping': sorted(textures, key=lambda x: int(x['register'][1:])),
                        'constantMapping': constants, 'atlasSampler': b.sampler_binding(instance, function),
                        'materialSampler': material_sampler(instance, function)})
    shader = ROOT / 'exports/materials/master2uv-shader/cae11f0532.dxbc'
    result = {'evidenceId': 'BF2-MASTER2UV-STATIC-ATLAS-BINDING-001', 'runtimeObserved': False,
              'shaderName': BASE['shaderName'], 'sourceRvmSha256': hashlib.sha256(b.DATA).hexdigest(),
              'pixelShader': 'cae11f0532', 'pixelShaderSha256': hashlib.sha256(shader.read_bytes()).hexdigest(),
              'ordinaryPixelShader': BASE['pixelShader'], 'functionInstances': results,
              'findings': ['The retained instance bind t2..t6 to original selectors 18..22 (irradiance, RGB directions, sky visibility).',
                           'All eleven ordinary material texture parameter keys retain their order at t7..t17 (ordinary t2..t12 +5). All nine cb1 parameter keys and byte offsets are unchanged.',
                           'Atlas s0 resolves to the same 9216198462 packed native sampler used by the floor variant. Material s1 resolves to original ordinary s0 sampler 5993a514cd.'],
              'limitations': ['Static RVM route; no original-game runtime pass selection capture.', 'Native RVM ABI is scoped to independently corroborated texture/constants/sampler records.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'binding-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'instances': len(results), 'atlasBindings': 5 * len(results), 'materialBindings': 11 * len(results),
                      'pairedVertexShaders': sorted({x['pairedVertexShader'] for x in results})}))


if __name__ == '__main__':
    main()
