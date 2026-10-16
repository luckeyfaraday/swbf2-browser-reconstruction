"""Bounded CorvetteDamage atlas RVM routing, using retained bytes only."""
import collections
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/corvette-damage-static-atlas'
spec = importlib.util.spec_from_file_location('binding', Path(__file__).with_name('native-static-atlas-binding.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
GRAPH = json.loads((ROOT / 'exports/materials/corvette-damage-shader/graph.json').read_text())
BASE = json.loads((ROOT / 'exports/materials/corvette-damage-shader/material-analysis.json').read_text())
b.EDGES = collections.defaultdict(list)
reverse = collections.defaultdict(list)
for edge in GRAPH['edges']:
    b.EDGES[edge['from']].append(edge)
    reverse[edge['to']].append(edge['from'])


def slots(key):
    return [value[0] >> 16 for value in struct.iter_unpack('<I', b.raw(key))]


def material_sampler(instance, function, register=1):
    reachable = b.reachable(function)
    candidates = []
    for key in reachable:
        if not b.INDEX[key]['type'].endswith('Dx11ApplyParametersBlock'):
            continue
        raw = b.raw(key)
        for at in range(0, len(raw), 16):
            stage, kind, first = raw[at:at + 3]
            count = struct.unpack_from('<I', raw, at + 4)[0]
            if stage == 1 and kind == 2 and first <= register < first + count:
                table = b.ref(struct.unpack_from('<Q', raw, at + 8)[0])
                candidates.append((key, at // 16, table, slots(table)[register - first]))
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
    assert matches[0]['sampler'] == '5993a514cd'
    return {'register': 's' + str(register), 'ordinaryRegister': 's0', 'applyBlock': apply, 'applyRecord': record,
            'registerSlots': table, 'inputSlot': slot, 'parameter': parameter, **matches[0],
            'packedSamplerBytes16to19': list(b.raw(matches[0]['sampler'])[16:20])}


def main():
    queue, seen, instances = [('cf1ffd68fd', [])], set(), {}
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
    ordinary_sampler = material_sampler(BASE['functionInstance'], BASE['function'], 0)
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
        assert sorted(x['register'] for x in textures) == sorted('t' + str(i) for i in range(2, 12))
        writes = next(key for key in reachable if b.INDEX[key]['type'].endswith('WriteOp'))
        constants = []
        original = BASE['constantMapping']
        for encoded, offset, count in struct.iter_unpack('<IHH', b.raw(writes)):
            parameter = inputs[encoded >> 16]
            packed = str(int(b.META[parameter]['values'][0]['hash']) & 0xffffffffffff)
            if packed == original['packedLow48']:
                assert parameter == original['parameterKeyBlock'] and count == 8 and offset == 0
                constants.append({'register': original['register'], 'role': original['role'], 'parameterKeyBlock': parameter,
                                  'packedLow48': packed, 'writeOpBlock': writes, 'sourceSlot': encoded >> 16,
                                  'byteOffset': offset, 'vectorCount': count})
        assert len(constants) == 1
        table = next(key for key in reachable if b.INDEX[key]['type'].endswith('TableAssemblyData'))
        table_bytes = b.raw(table)
        assert table == 'c3635b4e36' and len(table_bytes) == 40
        vertex_slot = struct.unpack_from('<I', table_bytes, 0)[0] >> 16
        pixel_slot = struct.unpack_from('<I', table_bytes, 20)[0] >> 16
        assert (vertex_slot, pixel_slot) == (57, 58)
        constant_applies = []
        for apply in reachable:
            if not b.INDEX[apply]['type'].endswith('Dx11ApplyParametersBlock'):
                continue
            block = b.raw(apply)
            for at in range(0, len(block), 16):
                stage, kind, first = block[at:at + 3]
                if kind != 0:
                    continue
                count = struct.unpack_from('<I', block, at + 4)[0]
                register_slots = b.ref(struct.unpack_from('<Q', block, at + 8)[0])
                selected_slots = slots(register_slots)
                assert count == 1 and len(selected_slots) == 1
                assert (stage, first, selected_slots[0]) in [(1, 1, pixel_slot), (0, 0, vertex_slot)]
                constant_applies.append({'stage': 'pixel' if stage == 1 else 'vertex', 'register': first,
                                         'slot': selected_slots[0], 'applyBlock': apply, 'registerSlots': register_slots})
        assert len(constant_applies) == 2
        table_routing = {'assembly': table, 'rawHex': table_bytes.hex(), 'pixelOutputSlot': pixel_slot,
                         'vertexOutputSlot': vertex_slot, 'apply': constant_applies}
        combined = next(child for _, child in b.refs(instance) if b.INDEX[child]['type'].endswith('CombinedSerializedParameterBlock'))
        defaults = b.reachable(combined)
        vertex = [key for key in defaults if b.INDEX[key]['type'].endswith('Dx11VsShader')]
        assert len(vertex) == 1
        vertex_bytecode = b.refs(vertex[0])[0][1]
        vertex_text = (ROOT / 'exports/materials/corvette-damage-shader' / (vertex_bytecode + '.asm')).read_text()
        vertex_lines = ['mov o1.xyzw, v2.xyzw', 'mov o3.w, v7.x', 'mov o4.w, v7.y',
            'mov o5.w, r4.x', 'mov o6.w, r4.y', 'mov o7.xyzw, v5.xyzw', 'mov o8.xyzw, v6.xyzw']
        assert all(line in vertex_text for line in vertex_lines)
        assert 'dcl_input v7.xy' in vertex_text and 'dcl_input v6.xyzw' in vertex_text
        vertex_uv = {'baseUv': 'VS v5.xy -> PS v7.xy', 'tiledUv': 'VS v5.zw -> PS v7.zw',
            'radiosity': 'VS v7.xy -> PS v3.w/v4.w', 'instanceAtlasOffset': 'buffer instance+1 xy -> PS v5.w/v6.w',
            'instanceAtlasScale': 'buffer instance xyzw -> PS v2.x/v2.w',
            'damage': 'VS v2.x -> PS v1.x', 'subMaterialIndex': 'VS uint v6.x -> PS flat uint v8.x',
            'conditional': True, 'scope': 'Authored output branch; source structured-buffer condition also has a zero-output branch.'}
        defaults_found = []
        for _, block in b.refs(b.refs(combined)[0][1]):
            source_keys, values = [child for _, child in b.refs(block)[:2]]
            for index, (_, key) in enumerate(b.refs(source_keys)):
                if key == original['parameterKeyBlock']:
                    value = b.refs(values)[index][1]
                    for _, payload in b.refs(value):
                        if b.raw(payload).hex() == original['rawHex']:
                            defaults_found.append({'parameterBlock': block, 'parameterIndex': index,
                                'valueRef': value, 'vectorPayload': payload, 'rawHex': b.raw(payload).hex()})
        assert len(defaults_found) == 1
        assert defaults_found[0]['vectorPayload'] == original['defaultVectorBlock']
        assert len(b.raw(original['defaultVectorBlock'])) == 8 * 16
        assert all(row[0] == 0 for row in struct.iter_unpack('<4f', b.raw(original['defaultVectorBlock'])))
        results.append({'instance': instance, 'function': function, 'pixelSelectionChain': path,
                        'pairedVertexShader': vertex_bytecode, 'vertexShaderObject': vertex[0], 'vertexUvRouting': vertex_uv,
                        'pairedVertexShaderSha256': hashlib.sha256((ROOT / 'exports/materials/corvette-damage-shader' / (vertex_bytecode + '.dxbc')).read_bytes()).hexdigest(),
                        'directInput': direct, 'parameterKeys': keys, 'textureMapping': sorted(textures, key=lambda x: int(x['register'][1:])),
                        'constantMapping': constants, 'constantTableRouting': table_routing, 'selectedLayerTable': defaults_found[0],
                        'atlasSampler': b.sampler_binding(instance, function),
                        'materialSampler': material_sampler(instance, function)})
    shader = ROOT / 'exports/materials/corvette-damage-shader/cf1ffd68fd.dxbc'
    provenance = json.loads((ROOT / 'exports/materials/corvette-damage-bounded-textures/provenance.json').read_text())
    array = provenance['6945af84-700e-4b81-ae19-924f6266c322']
    dds = (ROOT / array['sourceDdsPath']).read_bytes()
    ebx = (ROOT / array['source']['sourceEbxPath']).read_bytes()
    assert hashlib.sha256(dds).hexdigest() == array['sourceDdsSha256']
    assert hashlib.sha256(ebx).hexdigest() == array['source']['sourceEbxSha256']
    assert dds[:4] == b'DDS ' and struct.unpack_from('<4I', dds, 128) == (98, 3, 0, 2)
    array_evidence = {'source': array['source'], 'sourceDdsPath': array['sourceDdsPath'],
                     'sourceDdsSha256': array['sourceDdsSha256'], 'dxgiFormat': 98, 'nativeLayers': 2,
                     'browserSourceMip': array['sourceMip'], 'browserDimensions': [array['width'], array['height'], array['layers']],
                     'domain': 'Flat uint submaterial index 0..7 selects table X; table X is the typed texture-array layer coordinate. Retained defaults all choose layer zero; no remapping is inferred.'}
    result = {'evidenceId': 'BF2-CORVETTE-DAMAGE-STATIC-ATLAS-BINDING-001', 'runtimeObserved': False,
              'shaderName': BASE['shaderName'], 'sourceRvmSha256': hashlib.sha256(b.DATA).hexdigest(),
              'pixelShader': 'cf1ffd68fd', 'pixelShaderSha256': hashlib.sha256(shader.read_bytes()).hexdigest(),
              'ordinaryPixelShader': BASE['pixelShader'], 'ordinaryMaterialSampler': ordinary_sampler, 'functionInstances': results,
              'sourceArray': array_evidence,
              'findings': ['The retained instance binds t2..t6 to original selectors 18..22 (irradiance, RGB directions, sky visibility).',
                           'All five ordinary material texture keys retain order at t7..t11, including a typed texture2darray at t10. The same eight-vector submaterial layer table fills cb1[0..7].',
                           'Atlas s0 resolves to floor sampler 9216198462; material s1 resolves to ordinary s0 sampler 5993a514cd.',
                           'All eight retained table X defaults are zero. Shader still dynamically indexes this table by the original flat uint SubMaterialIndex; runtime overrides are unobserved.'],
              'limitations': ['Static RVM route; no original-game runtime pass selection capture.', 'Native RVM ABI is scoped to independently corroborated texture/constants/sampler records.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'binding-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'instances': len(results), 'atlasBindings': 5 * len(results), 'materialBindings': 5 * len(results),
                      'pairedVertexShaders': sorted({x['pairedVertexShader'] for x in results})}))


if __name__ == '__main__':
    main()
