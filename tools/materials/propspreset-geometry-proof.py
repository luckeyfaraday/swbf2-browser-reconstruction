"""Exact native input-layout/UV association and the only active alternative LOD."""
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('routing', Path(__file__).with_name('propspreset-routing.py'))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
from cityhash import CityHash64


def main():
    document = json.loads((ROOT / 'exports/materials/propspreset-routing/routing-evidence.json').read_text())
    recovered = json.loads((ROOT / 'exports/materials/propspreset-uv/manifest.json').read_text())
    assert len(recovered['records']) == 1
    uv = recovered['records'][0]
    elements = {x['usage']: x for x in uv['elements']}
    assert uv['strides'][0] == 36
    for usage, offset in [('TexCoord0', 24), ('TexCoord1', 28), ('RadiosityTexCoord', 32)]:
        assert all(elements[usage][key] == value for key, value in {'offset': offset, 'format': 'Half2', 'stream': 0, 'size': 4}.items())
    layout = R.b.raw('07a62c2c96')
    assert len(layout) == 160
    input_rows = []
    for at in range(0, len(layout), 32):
        semantic_index, dxgi, slot, offset, classification, rate = struct.unpack_from('<6I', layout, at + 8)
        input_rows.append({'semanticIndex': semantic_index, 'dxgiFormat': dxgi, 'inputSlot': slot, 'alignedByteOffset': offset,
                           'inputSlotClass': classification, 'instanceDataStepRate': rate})
    assert input_rows[3] == {'semanticIndex': 3, 'dxgiFormat': 10, 'inputSlot': 0, 'alignedByteOffset': 24, 'inputSlotClass': 0, 'instanceDataStepRate': 0}
    assert input_rows[4]['dxgiFormat'] == 34 and input_rows[4]['alignedByteOffset'] == 32
    ordinary = (ROOT / 'exports/materials/propspreset-shader/9d03671509.asm').read_text()
    atlas = (ROOT / 'exports/materials/propspreset-shader/18d0bd9bee.asm').read_text()
    for operation in ['mov o1.w, v3.x', 'mov o2.w, v3.y', 'mov o3.w, v3.z', 'mov o4.w, v3.w']:
        assert operation in ordinary
    assert 'mov o6.xyzw, v3.zwxy' in atlas
    for ps in ['3352783e34', 'd390b460db']:
        for instance in document['shaders'][ps]['instances']:
            assert '07a62c2c96' in R.b.reachable(instance['instance'])
    lod_document = json.loads((ROOT / 'web/public/assets/source-lods.json').read_text())
    selected = {x['assetId']: x for x in document['sections']}
    alternates = [x for x in lod_document['assets'] if x['assetId'] in selected]
    assert len(alternates) == 1 and [x['level'] for x in alternates[0]['lods']] == [1, 2]
    source, row = alternates[0], selected[alternates[0]['assetId']]
    alternate_evidence = []
    for level in [1, 2]:
        expected = CityHash64(struct.pack('<IIi', source['sourceMeshSetNameHash'], 0, level))
        entry = next(x for x in R.BLOCKS.values() if x.get('hash') == str(expected))
        original_section = R.BLOCKS[row['sourceEntry']]['children'][row['sourceSection']]
        alternate_section = entry['children'][row['sourceSection']]
        original = R.params_under(original_section)
        alternate = R.params_under(alternate_section)
        def material_params(values):
            return [(b['source']['rid'], p['packedFlags'], p['rawHex']) for b, p in values if b.get('kind') != 3]
        assert material_params(original) == material_params(alternate)
        hashes = {key: int(value['hash']) for key, value in row['conditionValues'].items()}
        for block, parameter in alternate:
            if parameter['packedFlags'] in R.PACKED_KEYS:
                key = R.PACKED_KEYS[parameter['packedFlags']]
                hashes[key] = R.t.hash_value(key, bytes.fromhex(parameter['rawHex']))
        leaves = R.t.candidates(R.t.decode(), hashes)
        shaders = sorted({ps for leaf in leaves for ps in R.b.reachable(R.t.PERMUTATIONS[leaf]) & R.PS})
        assert shaders == ['6ce45ee0f4', 'c13680b516']
        alternate_evidence.append({'assetId': row['assetId'], 'sourceLod': level, 'sourceEntry': entry['source']['rid'], 'entryHash': str(expected), 'meshSetNameHash': source['sourceMeshSetNameHash'], 'variation': 0, 'sourceSection': row['sourceSection'], 'sectionBlock': alternate_section, 'materialParameterBlocksEqual': True, 'parameters': material_params(alternate), 'candidatePixelShaders': shaders, 'ordinaryPixelShader': 'c13680b516'})
    result = {'evidenceId': 'BF2-PROPSPRESET-GEOMETRY-ROUTING-001', 'runtimeObserved': False,
        'alarmUv': {'assetId': uv['assetId'], 'sourceLod': 0, 'originalRecord': uv,
            'nativeInputLayout': {'block': '07a62c2c96', 'rawHex': layout.hex(), 'rows': input_rows},
            'ordinaryVertexShader': '9d03671509', 'atlasVertexShader': '18d0bd9bee',
            'association': 'Native TEXCOORD3 is R16G16B16A16_FLOAT at byte24: original TexCoord0 is XY and TexCoord1 is ZW. Ordinary PS v1.w/v2.w is UV0, v3.w/v4.w is UV1; atlas PS v6.xy is UV1 and v6.zw is UV0.',
            'materialCoordinates': 'UV0 drives clamped normal and tiled detail; UV1 drives CS, packed slice index and emissive mask.'},
        'activeAlternativeLods': alternate_evidence,
        'limitations': ['Proof is static source byte layout and routing, not a native live frame.', 'Unused LODs and other material sections are outside this bounded selected route.']}
    (ROOT / 'exports/materials/propspreset-routing/geometry-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'alarmUvAssociation': 'exact-source-offsets-and-VS', 'activeAlternativeLods': 2, 'materialIdentityEqual': True}))


if __name__ == '__main__':
    main()
