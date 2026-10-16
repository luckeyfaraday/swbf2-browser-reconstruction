"""Bounded Array2UV atlas RVM routing, using retained bytes only."""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/array2uv-static-atlas'
spec = importlib.util.spec_from_file_location('binding', Path(__file__).with_name('native-static-atlas-binding.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
GRAPH = json.loads((ROOT / 'exports/materials/array2uv-shader/graph.json').read_text())
BASE = json.loads((ROOT / 'exports/materials/array2uv-shader/material-analysis.json').read_text())
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
    queue, seen, instances = [('b398fb7ed2', [])], set(), {}
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
    assert len(instances) == 6
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
        assert sorted(x['register'] for x in textures) == sorted('t' + str(i) for i in range(2, 10))
        shader_text = (ROOT / 'exports/materials/array2uv-shader/b398fb7ed2.asm').read_text()
        texture_types = dict((register, kind) for kind, register in re.findall(r'dcl_resource_(texture2darray|texture2d) \(float,float,float,float\) (t\d+)', shader_text))
        for row in textures:
            row['textureKind'] = texture_types[row['register']]
        assert [row['register'] for row in textures if row['textureKind'] == 'texture2darray'] == ['t8']
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
        assert len(constants) == 2
        combined = next(child for _, child in b.refs(instance) if b.INDEX[child]['type'].endswith('CombinedSerializedParameterBlock'))
        defaults = b.reachable(combined)
        vertex = [key for key in defaults if b.INDEX[key]['type'].endswith('Dx11VsShader')]
        assert len(vertex) == 1
        vertex_bytecode = b.refs(vertex[0])[0][1]
        vertex_text = (ROOT / 'exports/materials/array2uv-shader' / (vertex_bytecode + '.asm')).read_text()
        uv_source = re.findall(r'mov o6\.xyzw, (v\d+)\.xyzw', vertex_text)
        radio_x = re.findall(r'mov o2\.w, (v\d+)\.x', vertex_text)
        radio_y = re.findall(r'mov o3\.w, (v\d+)\.y', vertex_text)
        assert len(uv_source) == len(radio_x) == len(radio_y) == 1 and radio_x == radio_y
        vertex_uv = {'materialPairs': uv_source[0] + '.xyzw -> PS v6.xyzw',
                     'radiosity': radio_x[0] + '.xy -> PS v2.w/v3.w',
                     'conditional': 'mov o6.xyzw, l(0,0,0,0)' in vertex_text,
                     'scope': 'Authored UV path; conditional vertex variants have a separate zero-output branch.'}
        results.append({'instance': instance, 'function': function, 'pixelSelectionChain': path,
                        'pairedVertexShader': vertex_bytecode, 'vertexShaderObject': vertex[0],
                        'vertexUvRouting': vertex_uv,
                        'directInput': direct, 'parameterKeys': keys, 'textureMapping': sorted(textures, key=lambda x: int(x['register'][1:])),
                        'constantMapping': constants, 'atlasSampler': b.sampler_binding(instance, function),
                        'materialSampler': material_sampler(instance, function)})
    shader = ROOT / 'exports/materials/array2uv-shader/b398fb7ed2.dxbc'
    array_guid = '15a8c654-a0e2-11e6-9bec-d439480edcea'
    array_identity = BASE['sourceTextures'][array_guid]
    assert all(row['bindings']['detailArray']['texture']['fileGuid'] == array_guid for row in BASE['materials'])
    assert hashlib.sha256((ROOT / array_identity['sourceEbxPath']).read_bytes()).hexdigest() == array_identity['sourceEbxSha256']
    array_manifest = json.loads((ROOT / 'exports/materials/array2uv-array-texture/texture.manifest.json').read_text())
    assert array_manifest['complete'] and not array_manifest['errors'] and len(array_manifest['results']) == 1
    array_record = array_manifest['results'][0]
    assert array_record['guid'] == array_guid
    array_path = ROOT / 'exports/materials/array2uv-array-texture' / array_record['file']
    array_dds = array_path.read_bytes()
    assert array_dds[:4] == b'DDS ' and array_dds[84:88] == b'DX10'
    height, width = struct.unpack_from('<II', array_dds, 12)
    mip_count = struct.unpack_from('<I', array_dds, 28)[0]
    dxgi, dimension, misc, layers = struct.unpack_from('<IIII', array_dds, 128)
    assert (width, height, mip_count, dxgi, dimension, misc, layers) == (1024, 1024, 11, 98, 3, 0, 10)
    array_evidence = {'identity': array_identity, 'retainedResource': array_record['metadata'],
                      'ddsPath': array_path.relative_to(ROOT).as_posix(), 'ddsSha256': hashlib.sha256(array_dds).hexdigest(),
                      'ddsHeader': {'width': width, 'height': height, 'mipCount': mip_count, 'dxgiFormat': dxgi, 'dimension': dimension, 'layers': layers},
                      'ordinaryRegister': 't3', 'atlasRegister': 't8', 'kind': 'texture2darray',
                      'coordinate': 'vec3(normalDetailUv * cb1[0].xy, normalArrayMetal(surfaceUv).b * 10)',
                      'layerInstruction': 'mul r2.z, r3.x, l(10.000000)',
                      'layerSelection': 'Shader submits the raw floating layer coordinate to the native array-sample instruction; no explicit shader rounding or layer clamp.',
                      'limitation': 'This static proof preserves coordinates and texture type; native API tie rounding and live texture-view construction are not executed here.'}
    result = {'evidenceId': 'BF2-ARRAY2UV-STATIC-ATLAS-BINDING-001', 'runtimeObserved': False,
              'shaderName': BASE['shaderName'], 'sourceRvmSha256': hashlib.sha256(b.DATA).hexdigest(),
              'pixelShader': 'b398fb7ed2', 'pixelShaderSha256': hashlib.sha256(shader.read_bytes()).hexdigest(),
              'ordinaryPixelShader': BASE['pixelShader'], 'ordinaryMaterialSampler': ordinary_sampler,
              'detailArray': array_evidence, 'functionInstances': results,
              'findings': ['All 6 retained instances bind t2..t6 to original selectors 18..22 (irradiance, RGB directions, sky visibility).',
                           'All three ordinary material texture parameter keys retain their order at t7..t9 (ordinary t2..t4 +5). Both cb1 parameter keys and byte offsets are unchanged.',
                           'Atlas s0 resolves to the same 9216198462 packed native sampler used by the floor variant. Material s1 resolves to original ordinary s0 sampler 5993a514cd.'],
              'limitations': ['Static RVM route; no original-game runtime pass selection capture.', 'Native RVM ABI is scoped to independently corroborated texture/constants/sampler records.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'binding-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'instances': len(results), 'atlasBindings': 5 * len(results), 'materialBindings': 3 * len(results),
                      'pairedVertexShaders': sorted({x['pairedVertexShader'] for x in results})}))


if __name__ == '__main__':
    main()
