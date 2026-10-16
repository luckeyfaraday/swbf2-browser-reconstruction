"""Bounded ExteriorNoScale atlas RVM routing, using retained bytes only."""
import collections
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/exterior-noscale-static-atlas'
spec = importlib.util.spec_from_file_location('binding', Path(__file__).with_name('native-static-atlas-binding.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
GRAPH = json.loads((ROOT / 'exports/materials/exterior-noscale-shader/graph.json').read_text())
BASE = json.loads((ROOT / 'exports/materials/exterior-noscale-shader/material-analysis.json').read_text())
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
    queue, seen, instances = [('b584a44bc0', [])], set(), {}
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
    assert len(instances) == 2
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
        assert sorted(x['register'] for x in textures) == sorted('t' + str(i) for i in range(2, 9))
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
        assert len(constants) == 5
        table = next(key for key in reachable if b.INDEX[key]['type'].endswith('TableAssemblyData'))
        table_bytes = b.raw(table)
        assert table in ['44b3ebef8b', '7eb74a053e'] and len(table_bytes) == 40
        # This variant assembles the five material vectors first, followed by
        # the vertex vector. Inspect the actual stage/register apply records.
        pixel_slot = struct.unpack_from('<I', table_bytes, 0)[0] >> 16
        vertex_slot = struct.unpack_from('<I', table_bytes, 20)[0] >> 16
        assert (pixel_slot, vertex_slot) == ({'44b3ebef8b': (47,48), '7eb74a053e': (40,41)}[table])
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
        vertex_text = (ROOT / 'exports/materials/exterior-noscale-shader' / (vertex_bytecode + '.asm')).read_text()
        uv_source = re.findall(r'mov o6\.xy, (v\d+)\.xyxx', vertex_text)
        radio_x = re.findall(r'mov o2\.w, (v\d+)\.([xz])', vertex_text)
        radio_y = re.findall(r'mov o3\.w, (v\d+)\.([yw])', vertex_text)
        assert len(uv_source) == len(radio_x) == len(radio_y) == 1
        assert radio_x[0][0] == radio_y[0][0]
        vertex_uv = {'materialUv': uv_source[0] + '.xy -> PS v6.xy',
                     'radiosity': radio_x[0][0] + '.' + radio_x[0][1] + radio_y[0][1] + ' -> PS v2.w/v3.w',
                     'conditional': bool(re.search(r'mov o6\.xyzw, l\(0,0,0,0\)', vertex_text)),
                     'scope': 'Authored output branch; any separate zero-output branch is not assumed active.'}
        results.append({'instance': instance, 'function': function, 'pixelSelectionChain': path,
                        'pairedVertexShader': vertex_bytecode, 'vertexShaderObject': vertex[0], 'vertexUvRouting': vertex_uv,
                        'directInput': direct, 'parameterKeys': keys, 'textureMapping': sorted(textures, key=lambda x: int(x['register'][1:])),
                        'constantMapping': constants, 'constantTableRouting': table_routing,
                        'atlasSampler': b.sampler_binding(instance, function),
                        'materialSampler': material_sampler(instance, function)})
    shader = ROOT / 'exports/materials/exterior-noscale-shader/b584a44bc0.dxbc'
    result = {'evidenceId': 'BF2-EXTERIOR-NOSCALE-STATIC-ATLAS-BINDING-001', 'runtimeObserved': False,
              'shaderName': BASE['shaderName'], 'sourceRvmSha256': hashlib.sha256(b.DATA).hexdigest(),
              'pixelShader': 'b584a44bc0', 'pixelShaderSha256': hashlib.sha256(shader.read_bytes()).hexdigest(),
              'ordinaryPixelShader': BASE['pixelShader'], 'ordinaryMaterialSampler': ordinary_sampler, 'functionInstances': results,
              'findings': ['All 2 retained instances bind t2..t6 to original selectors 18..22 (irradiance, RGB directions, sky visibility).',
                           'Both ordinary material texture keys retain their order at t7..t8 (ordinary t2..t3 +5). All five cb1 parameter keys and byte offsets are unchanged.',
                           'Atlas s0 resolves to the same 9216198462 packed native sampler used by the floor variant. Material s1 resolves to original ordinary s0 sampler 5993a514cd.'],
              'limitations': ['Static RVM route; no original-game runtime pass selection capture.', 'Native RVM ABI is scoped to independently corroborated texture/constants/sampler records.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'binding-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'instances': len(results), 'atlasBindings': 5 * len(results), 'materialBindings': 2 * len(results),
                      'pairedVertexShaders': sorted({x['pairedVertexShader'] for x in results})}))


if __name__ == '__main__':
    main()
