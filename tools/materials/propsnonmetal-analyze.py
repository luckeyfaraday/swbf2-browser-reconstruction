"""Bound selected PropsNonMetallicPreset routes using exact retained RVM inputs."""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/propsnonmetal-shader'
NAME = 'Shaders/Presets/SS_PropsNonMetallicPreset'
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
    assert GRAPH['sourceNameHash'] == R.name_hash(NAME) == 1162363461
    assert GRAPH['rootBlocks'] == ['8188cb6263']
    root = T.raw('8188cb6263')
    refs = {offset: B.ref(struct.unpack_from('<Q', root, offset)[0]) for offset in [16, 24, 32, 40]}
    T.KEYS, T.PERMUTATIONS = T.refs(refs[40]), T.refs(refs[24])
    T.VALUES = [value[0] for value in struct.iter_unpack('<Q', T.raw(refs[32]))]
    words = [value[0] for value in struct.iter_unpack('<H', T.raw(refs[16]))]
    assert struct.unpack_from('<HH', root, 48) == (len(words), len(T.PERMUTATIONS))
    tree = T.decode(words)
    keys = {str(int(T.META[key]['values'][0]['hash']) & 0xffffffffffff): key for key in T.KEYS}
    shaders = {row['hash']: row for row in GRAPH['shaders'] if row['stage'] == 'ps_5_0'}
    permutation_ps = {i: B.reachable(key) & shaders.keys() for i, key in enumerate(T.PERMUTATIONS)}
    plan = json.loads((ROOT / 'exports/materials/final-map-material-plan.json').read_text())
    scene = json.loads((ROOT / 'web/public/assets/map.scene.json').read_text())
    placed = collections.Counter(row['assetId'] for row in scene['instances'])
    active = {}
    for asset in scene['assets']:
        raw = (ROOT / 'web/public/assets' / asset['url']).read_bytes()
        length = struct.unpack_from('<I', raw, 12)[0]
        gltf = json.loads(raw[20:20 + length])
        active[asset['id']] = {primitive['material'] for mesh in gltf.get('meshes', []) for primitive in mesh['primitives']}
    rows, unused = [], []
    for mesh in plan['meshes']:
        for material in mesh['materials']:
            if (material.get('shader') or {}).get('name') != NAME:
                continue
            if material['index'] not in active.get(mesh['guid'], set()):
                unused.append({'assetId': mesh['guid'], 'materialId': material['index']})
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
            ordinary = [ps for ps in candidates if 'dcl_resource_buffer' in (OUT / (ps + '.asm')).read_text() and (OUT / (ps + '.asm')).read_text().count('dcl_output ') == 4]
            assert ordinary == ['1e3d99cec3']
            deferred = [ps for ps in candidates if (OUT / (ps + '.asm')).read_text().count('dcl_output ') == 4]
            rows.append({'assetId': mesh['guid'], 'meshName': mesh['name'], 'materialId': material['index'], 'placementCount': placed[mesh['guid']],
                'shaderIdentity': material['shader'], 'sourceEntry': first['sourceEntry'], 'sourceSection': first['sourceSection'], 'variationHash': 0,
                'treeInputs': supplied, 'permutationIndices': selected, 'candidatePixelShaders': candidates, 'ordinaryPixelShader': ordinary[0],
                'deferredPixelShaders': deferred, 'atlasPixelShader': '1c6f05ad3a' if '1c6f05ad3a' in deferred else None, 'bindings': bindings})
    assert len(rows) == 22 and sum(row['placementCount'] for row in rows) == 122
    selected_ps = sorted({ps for row in rows for ps in row['deferredPixelShaders']})
    instances = {ps: R.instance_bindings(ps) for ps in selected_ps}
    from cityhash import CityHash64
    alternates = []
    for asset in json.loads((ROOT / 'web/public/assets/source-lods.json').read_text())['assets']:
        for original in [row for row in rows if row['assetId'] == asset['assetId']]:
            original_section = R.BLOCKS[original['sourceEntry']]['children'][original['sourceSection']]
            def material_parameters(key):
                return [(block['source']['rid'], param['packedFlags'], param['rawHex']) for block, param in R.params_under(key) if block.get('kind') != 3]
            for lod in asset['lods']:
                expected = CityHash64(struct.pack('<IIi',asset['sourceMeshSetNameHash'],0,lod['level']))
                entry = next(block for block in R.BLOCKS.values() if block.get('hash') == str(expected))
                sections = [section for section in lod['sections'] if section['lod0MaterialId'] == original['materialId']]
                for section in sections:
                    alternate_section = entry['children'][section['sourceSectionIndex']]
                    assert material_parameters(original_section) == material_parameters(alternate_section)
                    values = {}
                    for _,param in R.params_under(alternate_section):
                        if param['packedFlags'] in keys:
                            key = keys[param['packedFlags']]
                            values[key] = T.hash_value(key,bytes.fromhex(param['rawHex']))
                    candidates = sorted(set().union(*(permutation_ps[index] for index in T.candidates(tree,values))))
                    ordinary = [ps for ps in candidates if 'dcl_resource_buffer' in (OUT / (ps+'.asm')).read_text() and (OUT / (ps+'.asm')).read_text().count('dcl_output ') == 4]
                    assert ordinary == ['1e3d99cec3']
                    alternates.append({'assetId':asset['assetId'],'sourceLod':lod['level'],'materialId':original['materialId'],
                        'sourceEntry':entry['source']['rid'],'sourceEntryHash':str(expected),'sourceSection':section['sourceSectionIndex'],
                        'materialParameterBlocksEqual':True,'candidatePixelShaders':candidates,'ordinaryPixelShader':ordinary[0],
                        'atlasPixelShader':'1c6f05ad3a' if '1c6f05ad3a' in candidates else None})
    result = {'evidenceId': 'BF2-PROPSNONMETAL-MATERIAL-ROUTING-001', 'runtimeObserved': False, 'shaderName': NAME,
        'sourceRvmSha256': hashlib.sha256(T.DATA).hexdigest(), 'tree': {'root': '8188cb6263', 'refs': refs, 'words': len(words), 'nodes': len(tree['nodes']),
            'backreferences': len(tree['backreferences']), 'permutations': len(T.PERMUTATIONS), 'completeByteCoverage': True,
            'decoderEvidence': 'exports/materials/propspreset-native/functions/1414ff520.c', 'unknownInputs': 'Remain free; exact compiled section values alone are applied.'},
        'pixelShaders': shaders, 'selectedDeferredFunctions': instances, 'materials': rows, 'unusedMaterialSlots': unused, 'activeAlternativeLods':alternates,
        'materialContract':{'albedo':'CS.rgb','rawSmoothness':'CS.a','normal':'NW.rg decode2*x-1; z=sqrt(max(1-dot(xy,xy),0)); final normalize(TBN*normal).',
            'materialId':0,'metalness':0,'reflectance':.5,'materialAO':1,'emissive':[0,0,0],
            'ordinaryPrelighting':'Normalized final-world-normal SH plus always-on broadened SH specular; final maxRGB0.',
            'sourceConstants':'No material PS constant buffer; only view/frame globals and source instance/probe state.'},
        'limitations': ['Static source predicate evidence only; original live dispatch is not captured.', 'Atlas binding and arithmetic classification are separate from candidate reachability.',
            'Three-texture and dual-atlas routes stay separate from the proven five-atlas candidate.']}
    (OUT / 'material-analysis.json').write_text(json.dumps(result, indent=2) + '\n')
    (OUT / 'decoded-tree.json').write_text(json.dumps(tree, indent=2) + '\n')
    print(json.dumps({'sections': len(rows), 'placedSectionInstances': 122, 'treeWords': len(words), 'permutations': len(T.PERMUTATIONS),
        'deferred': collections.Counter(ps for row in rows for ps in row['deferredPixelShaders']), 'alternativeLods':len(alternates),
        'textureIdentities':len({binding['texture']['fileGuid'] for row in rows for binding in row['bindings']})}))


if __name__ == '__main__':
    main()
