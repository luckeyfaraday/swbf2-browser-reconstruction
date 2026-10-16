"""Exact selected Volcanic ObjectPreset RVM route and source parameters."""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/volcanic-object-shader'
NAME = 'Objects/Nature/Volcanic/_VolcanicQuarry/_CommonTextures/SS_ObjectPreset_01'
SPEC = importlib.util.spec_from_file_location('routing', Path(__file__).with_name('propspreset-routing.py'))
R = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R)
T, B = R.t, R.b
GRAPH = json.loads((OUT / 'graph.json').read_text())
B.EDGES, R.REVERSE = collections.defaultdict(list), collections.defaultdict(list)
for edge in GRAPH['edges']:
    B.EDGES[edge['from']].append(edge)
    R.REVERSE[edge['to']].append(edge['from'])


def main():
    assert GRAPH['sourceNameHash'] == R.name_hash(NAME) == 761997209
    assert GRAPH['rootBlocks'] == ['b1a15c6f2b']
    root = T.raw('b1a15c6f2b')
    refs = {offset: B.ref(struct.unpack_from('<Q', root, offset)[0]) for offset in [16, 24, 32, 40]}
    assert refs == {16: 'e0a54dc79e', 24: '21e9fe8f54', 32: '1d7a298132', 40: '2dae72263b'}
    T.KEYS, T.PERMUTATIONS = T.refs(refs[40]), T.refs(refs[24])
    T.VALUES = [value[0] for value in struct.iter_unpack('<Q', T.raw(refs[32]))]
    words = [value[0] for value in struct.iter_unpack('<H', T.raw(refs[16]))]
    assert struct.unpack_from('<HH', root, 48) == (len(words), len(T.PERMUTATIONS)) == (54, 4)
    tree = T.decode(words)
    keys = {str(int(T.META[key]['values'][0]['hash']) & 0xffffffffffff): key for key in T.KEYS}
    shaders = {row['hash']: row for row in GRAPH['shaders'] if row['stage'] == 'ps_5_0'}
    permutation_ps = {i: B.reachable(key) & shaders.keys() for i, key in enumerate(T.PERMUTATIONS)}
    assert set(shaders) == {'78ebc34571', '096229c40c', '750135c350', 'c190a27b27'}
    ordinary = R.instance_bindings('750135c350')
    assert len(ordinary) == 1
    instance = ordinary[0]
    assert instance['pairedVertexShader'] == 'c36ce7f6e3'
    assert [row['parameterHash'] for row in instance['textureMapping']] == [882957197, 2852436613, 2644336517, 2644336518]
    assert [row['register'] for row in instance['textureMapping']] == ['t2', 't3', 't4', 't5']
    assert [row['payloadBlock'] for row in instance['samplerMapping']] == ['5993a514cd']
    constants = sorted([row for row in instance['constantMapping'] if row['packedLow48'] != '3022048275306'], key=lambda row: row['offset'])
    assert [row['offset'] for row in constants] == [0, 16, 32, 48]
    plan = json.loads((ROOT / 'exports/materials/final-map-material-plan.json').read_text())
    scene = json.loads((ROOT / 'web/public/assets/map.scene.json').read_text())
    placed = collections.Counter(row['assetId'] for row in scene['instances'])
    rows = []
    for mesh in plan['meshes']:
        for material in mesh['materials']:
            if (material.get('shader') or {}).get('name') != NAME:
                continue
            bindings = material['fallbackTextureBindings']
            first = bindings[0]
            assert all(row['sourceEntry'] == first['sourceEntry'] and row['sourceSection'] == first['sourceSection'] and row['variationHash'] == 0 for row in bindings)
            section = R.BLOCKS[first['sourceEntry']]['children'][first['sourceSection']]
            parameters = R.params_under(section)
            supplied = {}
            for block, param in parameters:
                if param['packedFlags'] in keys:
                    key = keys[param['packedFlags']]
                    supplied[key] = {'rawHex': param['rawHex'], 'valueHash': str(T.hash_value(key, bytes.fromhex(param['rawHex']))),
                        'sourceBlock': block['source']['rid'], 'sourceOffset': param['offset'], 'sourceBlockSha256': block['sha256']}
            selected = sorted(T.candidates(tree, {key: int(value['valueHash']) for key, value in supplied.items()}))
            candidates = sorted(set().union(*(permutation_ps[index] for index in selected)))
            assert candidates == ['750135c350', 'c190a27b27']
            resolved = []
            for constant in constants:
                matches = [(block, param) for block, param in parameters if param['packedFlags'] == constant['packedLow48']]
                assert len({param['rawHex'] for _, param in matches}) <= 1
                block, param = matches[0] if matches else (None, None)
                raw = param['rawHex'] if param else constant['rawHex']
                resolved.append({'register': f'cb1[{constant["offset"] // 16}]', 'value': list(struct.unpack('<4f', bytes.fromhex(raw))), 'rawHex': raw,
                    'sourceBlock': block['source']['rid'] if block else None, 'sourceOffset': param['offset'] if param else None, 'default': constant})
            rows.append({'assetId': mesh['guid'], 'meshName': mesh['name'], 'materialId': material['index'], 'placementCount': placed[mesh['guid']],
                'shaderIdentity': material['shader'], 'sourceEntry': first['sourceEntry'], 'sourceSection': first['sourceSection'], 'variationHash': 0,
                'treeInputs': supplied, 'permutationIndices': selected, 'candidatePixelShaders': candidates, 'ordinaryPixelShader': '750135c350',
                'atlasPixelShader': None, 'bindings': bindings, 'constants': resolved})
    assert len(rows) == 10 and sum(row['placementCount'] for row in rows) == 164
    from cityhash import CityHash64
    alternates = []
    for asset in json.loads((ROOT / 'web/public/assets/source-lods.json').read_text())['assets']:
        selected_rows = [row for row in rows if row['assetId'] == asset['assetId']]
        for original in selected_rows:
            original_section = R.BLOCKS[original['sourceEntry']]['children'][original['sourceSection']]
            def material_parameters(key):
                return [(block['source']['rid'], param['packedFlags'], param['rawHex']) for block, param in R.params_under(key) if block.get('kind') != 3]
            for lod in asset['lods']:
                expected = CityHash64(struct.pack('<IIi', asset['sourceMeshSetNameHash'], 0, lod['level']))
                entry = next(block for block in R.BLOCKS.values() if block.get('hash') == str(expected))
                section = next(row for row in lod['sections'] if row['lod0MaterialId'] == original['materialId'])
                alternate_section = entry['children'][section['sourceSectionIndex']]
                assert material_parameters(original_section) == material_parameters(alternate_section)
                values = {}
                for _, param in R.params_under(alternate_section):
                    if param['packedFlags'] in keys:
                        key = keys[param['packedFlags']]
                        values[key] = T.hash_value(key, bytes.fromhex(param['rawHex']))
                candidates = sorted(set().union(*(permutation_ps[index] for index in T.candidates(tree, values))))
                assert candidates == ['750135c350', 'c190a27b27']
                alternates.append({'assetId': asset['assetId'], 'sourceLod': lod['level'], 'materialId': original['materialId'],
                    'sourceEntry': entry['source']['rid'], 'sourceEntryHash': str(expected), 'sourceSection': section['sourceSectionIndex'],
                    'materialParameterBlocksEqual': True, 'candidatePixelShaders': candidates, 'ordinaryPixelShader': '750135c350', 'atlasPixelShader': None})
    assert len(alternates) == 2
    result = {'evidenceId': 'BF2-VOLCANIC-OBJECT-MATERIAL-ROUTING-001', 'runtimeObserved': False, 'shaderName': NAME,
        'sourceRvmSha256': hashlib.sha256(T.DATA).hexdigest(), 'tree': {'root': 'b1a15c6f2b', 'words': len(words), 'nodes': len(tree['nodes']),
            'backreferences': len(tree['backreferences']), 'permutations': len(T.PERMUTATIONS), 'completeByteCoverage': True,
            'decoderEvidence': 'exports/materials/propspreset-native/functions/1414ff520.c', 'unknownInputs': 'Remain free; exact compiled section values alone are applied.'},
        'pixelShaders': shaders, 'ordinaryFunction': instance, 'materials': rows, 'activeAlternativeLods': alternates,
        'atlasClassification': {'selectedFiveAtlasRoute': False, 'basis': 'Complete retained source tree has only depth/ordinary SH/forward SH shaders; all ten compiled sections reach precisely the two SH shaders.'},
        'materialContract': {'sampler': '5993a514cd wrap U/V', 'textures': ['baseColor', 'normal', 'detailMetalNA', 'detailFabricNA'],
            'mix': 'baseColor.a', 'detailAlpha': 'mix(detailFabric.a, detailMetal.a, baseColor.a)',
            'albedo': '2 * baseColor.rgb * cb1[2].x * detailAlpha', 'rawSmoothness': '2 * normal.a * detailAlpha', 'rawMetalness': '2 * baseColor.a * detailAlpha',
            'normal': 'Each sampled RGB decodes2*x-1 then individually normalizes after TBN. Unnormalized prelighting N = baseWorld + mix(fabricWorld,metalWorld,baseColor.a). GBuffer N normalizes this sum afterward.',
            'broadenedSHSpecular': 'if cb1[3].x>0, add cb1[3].x times native broadened SH specular before final zero clamp; eight selected hose sections disable it, two machinery/light sections enable it.',
            'materialId': 0, 'reflectance': .5, 'materialAO': 1, 'emissive': [0, 0, 0]},
        'limitations': ['Native original live pass and dynamic overrides are not captured.', 'Do not normalize the prelighting sum or supply a guessed atlas route.',
            'Browser material, native frame, raw-normal SH and gated broadened-SH execution require separate scoped integration.']}
    (OUT / 'material-analysis.json').write_text(json.dumps(result, indent=2) + '\n')
    (OUT / 'decoded-tree.json').write_text(json.dumps(tree, indent=2) + '\n')
    print(json.dumps({'sections': len(rows), 'placements': 164, 'atlas': False, 'specularDisabledSections': sum(row['constants'][3]['value'][0] == 0 for row in rows),
        'textureIdentities': len({binding['texture']['fileGuid'] for row in rows for binding in row['bindings']})}))


if __name__ == '__main__':
    main()
