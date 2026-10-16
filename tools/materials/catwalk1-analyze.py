"""Bounded CatwalkSystem_Preset_01 native tree and exact binding recovery."""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/catwalk1-shader'
NAME = 'Objects/Props/ObjectSets/_Generic/CatwalkSystem_01/SS_CatwalkSystem_Preset_01'
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
    assert GRAPH['sourceNameHash'] == R.name_hash(NAME) == 2105226253
    assert GRAPH['rootBlocks'] == ['d63ba5a5ab']
    root = T.raw('d63ba5a5ab')
    expected = {16: '366d77bb05', 24: 'bc665ec3b4', 32: 'e19e6718ec', 40: '20f8766238'}
    for offset, key in expected.items():
        assert B.ref(struct.unpack_from('<Q', root, offset)[0]) == key
    T.KEYS = T.refs(expected[40])
    T.PERMUTATIONS = T.refs(expected[24])
    T.VALUES = [x[0] for x in struct.iter_unpack('<Q', T.raw(expected[32]))]
    words = [x[0] for x in struct.iter_unpack('<H', T.raw(expected[16]))]
    assert struct.unpack_from('<HH', root, 48) == (len(words), len(T.PERMUTATIONS)) == (179, 14)
    tree = T.decode(words)
    keys = {str(int(T.META[k]['values'][0]['hash']) & 0xffffffffffff): k for k in T.KEYS}
    shaders = {row['hash']: row for row in GRAPH['shaders'] if row['stage'] == 'ps_5_0'}
    permutation_ps = {i: B.reachable(key) & shaders.keys() for i, key in enumerate(T.PERMUTATIONS)}
    plan = json.loads((ROOT / 'exports/materials/final-map-material-plan.json').read_text())
    scene = json.loads((ROOT / 'web/public/assets/map.scene.json').read_text())
    placed = collections.Counter(row['assetId'] for row in scene['instances'])
    bindings = {ps: R.instance_bindings(ps) for ps in ['d260c7f82c', '3b42a4bca7']}
    for ps, instances in bindings.items():
        assert instances
        for instance in instances:
            material = [x for x in instance['textureMapping'] if 'parameterHash' in x]
            assert [x['parameterHash'] for x in material] == [5861109, 5861212, 5861208, 2990320127]
            assert [x['register'] for x in material] == [f't{i}' for i in range(7 if ps == '3b42a4bca7' else 2, 11 if ps == '3b42a4bca7' else 6)]
            expected_samplers = ['9216198462', '5993a514cd', '83d4c1d84a'] if ps == '3b42a4bca7' else ['5993a514cd', '83d4c1d84a']
            assert [x['payloadBlock'] for x in instance['samplerMapping']] == expected_samplers
            if ps == '3b42a4bca7':
                assert [x['producer']['selector'] for x in instance['textureMapping'][:5]] == list(range(18, 23))
    constant = next(x for x in bindings['d260c7f82c'][0]['constantMapping'] if x['parameterKey'] == '03271e4aab')
    assert constant['offset'] == 0 and constant['count'] == 1
    rows = []
    for mesh in plan['meshes']:
        for material in mesh['materials']:
            if (material.get('shader') or {}).get('name') != NAME:
                continue
            textures = material['fallbackTextureBindings']
            first = textures[0]
            assert all(row['sourceEntry'] == first['sourceEntry'] and row['sourceSection'] == first['sourceSection'] and row['variationHash'] == 0 for row in textures)
            section = R.BLOCKS[first['sourceEntry']]['children'][first['sourceSection']]
            parameters = R.params_under(section)
            supplied = {}
            for block, param in parameters:
                if param['packedFlags'] in keys:
                    key = keys[param['packedFlags']]
                    supplied[key] = {'rawHex': param['rawHex'], 'sourceBlock': block['source']['rid'], 'sourceOffset': param['offset'],
                        'sourceBlockSha256': block['sha256'], 'valueHash': str(T.hash_value(key, bytes.fromhex(param['rawHex'])))}
            selected = sorted(T.candidates(tree, {key: int(row['valueHash']) for key, row in supplied.items()}))
            candidates = sorted(set().union(*(permutation_ps[index] for index in selected)))
            ordinary = [ps for ps in candidates if 'dcl_resource_buffer' in (OUT / (ps + '.asm')).read_text() and (OUT / (ps + '.asm')).read_text().count('dcl_output ') == 4]
            assert ordinary == ['d260c7f82c']
            matches = [(block, param) for block, param in parameters if param['packedFlags'] == constant['packedLow48']]
            assert len({param['rawHex'] for _, param in matches}) <= 1
            block, param = matches[0] if matches else (None, None)
            raw = param['rawHex'] if param else constant['rawHex']
            rows.append({'assetId': mesh['guid'], 'meshName': mesh['name'], 'materialId': material['index'], 'placementCount': placed[mesh['guid']],
                'sourceEntry': first['sourceEntry'], 'sourceSection': first['sourceSection'], 'shaderIdentity': material['shader'], 'variationHash': 0,
                'treeInputs': supplied, 'permutationIndices': selected, 'candidatePixelShaders': candidates, 'ordinaryPixelShader': ordinary[0],
                'atlasPixelShader': '3b42a4bca7' if '3b42a4bca7' in candidates else None, 'textureBindings': textures,
                'constant': {'register': 'cb1[0]', 'role': 'detailUVScale', 'value': list(struct.unpack('<4f', bytes.fromhex(raw))), 'rawHex': raw,
                    'sourceBlock': block['source']['rid'] if block else None, 'sourceOffset': param['offset'] if param else None, 'default': constant}})
    assert len(rows) == 23 and sum(row['placementCount'] for row in rows) == 312
    assert sum(bool(row['atlasPixelShader']) for row in rows) == 22
    # The browser reuses base material objects for original lower LOD geometry.
    # Prove material blocks and deferred material PS for every active alternative.
    from cityhash import CityHash64
    alternates = []
    selected_rows = {row['assetId']: row for row in rows}
    lods = json.loads((ROOT / 'web/public/assets/source-lods.json').read_text())
    for asset in lods['assets']:
        if asset['assetId'] not in selected_rows:
            continue
        original = selected_rows[asset['assetId']]
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
            ordinary = [ps for ps in candidates if 'dcl_resource_buffer' in (OUT / (ps + '.asm')).read_text() and (OUT / (ps + '.asm')).read_text().count('dcl_output ') == 4]
            assert ordinary == ['d260c7f82c']
            alternates.append({'assetId': asset['assetId'], 'sourceLod': lod['level'], 'materialId': original['materialId'],
                'sourceEntry': entry['source']['rid'], 'sourceEntryHash': str(expected), 'sourceSection': section['sourceSectionIndex'],
                'materialParameterBlocksEqual': True, 'candidatePixelShaders': candidates, 'ordinaryPixelShader': ordinary[0],
                'atlasPixelShader': '3b42a4bca7' if '3b42a4bca7' in candidates else None})
    result = {'evidenceId': 'BF2-CATWALK1-MATERIAL-ROUTING-001', 'runtimeObserved': False, 'shaderName': NAME,
        'sourceRvmSha256': hashlib.sha256(T.DATA).hexdigest(), 'tree': {'root': 'd63ba5a5ab', 'words': len(words), 'nodes': len(tree['nodes']),
            'backreferences': len(tree['backreferences']), 'permutations': len(T.PERMUTATIONS), 'completeByteCoverage': True,
            'decoderEvidence': 'exports/materials/propspreset-native/functions/1414ff520.c', 'unknownInputs': 'Remain free; exact compiled section values alone are applied.'},
        'materials': rows, 'activeAlternativeLods': alternates, 'pixelShaders': {ps: {**shaders[ps], 'instances': instances} for ps, instances in bindings.items()},
        'materialContract': {'textures': ['CS', 'NW', 'NS', 'worldGrungeCS'], 'samplers': {'CS/NS/grunge': '5993a514cd wrap U/V', 'NW': '83d4c1d84a clamp U/V'},
            'grungeCoordinates': 'absolute source world XZ * 0.1; native VS writes transformed world position before camera subtraction',
            'normal': 'Normalize tangent vector, then normalize(TBN*tangentNormal)', 'metalness': 0, 'materialAO': 1, 'reflectance': .5, 'emissive': [0, 0, 0]},
        'limitations': ['Static allowed native pass routes, not a captured original game frame.', 'Symbolic arithmetic and browser publication are separate.',
            'One selected rigid section has no five-atlas route; do not enable atlas from shader name alone.',
            'Default variation zero only. Runtime material overrides and anisotropic sampler conversion remain unresolved.']}
    (OUT / 'material-analysis.json').write_text(json.dumps(result, indent=2) + '\n')
    (OUT / 'decoded-tree.json').write_text(json.dumps(tree, indent=2) + '\n')
    print(json.dumps({'sections': len(rows), 'placements': 312, 'atlasEligible': 22, 'atlasExcluded': 1, 'pixelShaders': list(bindings), 'textureIdentities': len({b['texture']['fileGuid'] for row in rows for b in row['textureBindings']})}))


if __name__ == '__main__':
    main()
