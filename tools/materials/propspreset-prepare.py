"""Publish proven PropsPreset branches with original mip and UV correspondence."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/propspreset-bounded-textures'
PUBLIC = ROOT / 'web/public/assets/textures/propspreset'
REPORT = json.loads((ROOT / 'exports/materials/propspreset-routing/routing-evidence.json').read_text())
FAMILIES = {'c13680b516': 'clampAll', '93681d7ffd': 'clampVertical', '3352783e34': 'emissiveTwoUV', '34120bd05e': 'lodSimple'}
ROLE_HASHES = {'colorSmoothness': 2596658578, 'normalPacked': 3454255561, 'detailArray': 26739661}
sha = lambda data: hashlib.sha256(data).hexdigest()


def fingerprint(data):
    value = 2166136261
    for byte in data:
        value = ((value ^ byte) * 16777619) & 0xffffffff
    return value


def source_materials():
    array = next(iter(json.loads((ROOT / 'web/public/assets/recovered-array2uv-materials.json').read_text())['sourceTextures'].get(key)
                      for key in ['15a8c654-a0e2-11e6-9bec-d439480edcea']))
    assert array['source']['rootInstanceGuid'] == 'd72f699d-b7ad-f0da-de8e-7f2741b3ef4c'
    assert sha((ROOT / array['sourceDdsPath']).read_bytes()) == array['sourceDdsSha256']
    assert sha((ROOT / 'web/public' / array['url'].lstrip('/')).read_bytes()) == array['sha256']
    split = {row['source']['rid']: row for row in json.loads((ROOT / 'exports/materials/final-map-blocks.json').read_text())['blocks']}
    materials, identities = [], {}
    for row in REPORT['sections']:
        bindings = {item['parameterHash']: item for item in row['bindings']}
        selected = {}
        for role, hashed in ROLE_HASHES.items():
            if role == 'detailArray' and row['ordinaryPixelShader'] == '34120bd05e':
                continue
            binding = dict(bindings[hashed])
            if role == 'detailArray':
                original = next(p for p in split[binding['sourceBlock']]['parameters'] if p['offset'] == binding['sourceOffset'])
                assert original['textureGuid'] == array['source']['rootInstanceGuid']
                binding['texture'] = array['source']
            selected[role] = binding
            identities[binding['texture']['fileGuid']] = binding['texture']
        materials.append({'assetId': row['assetId'], 'meshName': row['meshName'], 'materialId': row['materialId'],
            'family': FAMILIES[row['ordinaryPixelShader']], 'pixelShader': row['ordinaryPixelShader'],
            'pixelShaderSha256': REPORT['shaders'][row['ordinaryPixelShader']]['sha256'],
            'atlasPixelShader': next(iter(row['atlasPixelShaders']), None), 'sourceEntry': row['sourceEntry'],
            'sourceSection': row['sourceSection'], 'variationHash': 0, 'placementCount': row['placementCount'],
            'conditionValues': row['conditionValues'], 'sourcePermutationIndices': row['permutationIndices'],
            'bindings': selected, 'constants': [item['value'] for item in row['pixelConstants']], 'constantEvidence': row['pixelConstants']})
    return materials, identities, array


def publish_textures(identities, array):
    sources = {}
    for manifest in sorted((ROOT / 'exports/materials').glob('*/texture.manifest.json')):
        for row in json.loads(manifest.read_text()).get('results', []):
            if row.get('guid') in identities and (manifest.parent / row['file']).exists():
                sources[row['guid']] = (manifest.parent / row['file'], row)
    assert set(sources) == set(identities)
    provenance = {}
    for guid, (path, metadata) in sources.items():
        if guid == array['source']['fileGuid']:
            provenance[guid] = array
            continue
        raw = path.read_bytes()
        assert raw[:4] == b'DDS ' and raw[84:88] == b'DX10'
        height, width = struct.unpack_from('<II', raw, 12)
        mip_count = struct.unpack_from('<I', raw, 28)[0]
        dxgi, dimension, misc, layers = struct.unpack_from('<IIII', raw, 128)
        assert dimension == 3 and misc == 0 and layers == 1 and dxgi in (28, 29, 77, 78, 83, 98, 99), (guid, dxgi)
        compressed = dxgi not in (28, 29)
        def size(w, h):
            return max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * 16 if compressed else w * h * 4
        dimensions, w, h = [], width, height
        for _ in range(mip_count):
            dimensions.append((w, h, size(w, h)))
            w, h = max(1, w // 2), max(1, h // 2)
        assert len(raw) == 148 + sum(n for _, _, n in dimensions)
        skip = next(i for i, (w, h, _) in enumerate(dimensions) if max(w, h) <= 1024)
        width, height, _ = dimensions[skip]
        source_offset = 148 + sum(n for _, _, n in dimensions[:skip])
        header = bytearray(raw[:148])
        struct.pack_into('<II', header, 12, height, width)
        struct.pack_into('<I', header, 20, size(width, height) if compressed else width * 4)
        struct.pack_into('<I', header, 28, mip_count - skip)
        selected = bytes(header) + raw[source_offset:]
        dds, png = OUT / (guid + '.dds'), OUT / (guid + '.png')
        changed = not dds.exists() or dds.read_bytes() != selected
        if changed:
            dds.write_bytes(selected)
        if changed or not png.exists():
            subprocess.run([str(ROOT / 'tools/bf2-extract/bf2-extract.exe'), 'dds-png', '--input', str(dds), '--out', str(png)], cwd=ROOT, check=True, capture_output=True)
        pixels = png.read_bytes()
        assert struct.unpack_from('>II', pixels, 16) == (width, height)
        target = PUBLIC / png.name
        target.write_bytes(pixels)
        provenance[guid] = {'source': identities[guid], 'sourceMetadata': metadata['metadata'],
            'sourceDdsPath': path.relative_to(ROOT).as_posix(), 'sourceDdsSha256': sha(raw),
            'sourceMip': skip, 'width': width, 'height': height, 'layers': layers, 'dxgiFormat': dxgi,
            'colorSpace': 'srgb' if dxgi in (29, 78, 99) else 'linear', 'format': 'png',
            'url': '/assets/textures/propspreset/' + target.name, 'sha256': sha(pixels), 'bytes': len(pixels),
            'slices': [{'selectedDdsPath': dds.relative_to(ROOT).as_posix(), 'selectedDdsSha256': sha(selected),
                'sourceDataOffset': source_offset, 'retainedDataBytes': len(raw) - source_offset,
                'pngPath': png.relative_to(ROOT).as_posix(), 'pngSha256': sha(pixels)}],
            'operation': 'Existing native DDS mip <=1024, original compressed suffix unchanged; historical native DDS-to-PNG decode. Browser lower mipmaps regenerate.'}
    return provenance


def glb_accessors(path, primitive):
    data = path.read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    document, binary = json.loads(data[20:20 + length]), data[28 + length:]
    primitive = document['meshes'][0]['primitives'][primitive]
    def attribute(index):
        accessor = document['accessors'][index]
        view = document['bufferViews'][accessor['bufferView']]
        offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        components = {'VEC2': 2, 'SCALAR': 1}[accessor['type']]
        assert accessor['componentType'] in [5125, 5126] and 'byteStride' not in view
        return binary[offset:offset + accessor['count'] * components * 4]
    return attribute(primitive['attributes']['TEXCOORD_0']), attribute(primitive['indices'])


def publish_uv():
    recovered = json.loads((ROOT / 'exports/materials/propspreset-uv/manifest.json').read_text())
    scene = json.loads((ROOT / 'web/public/assets/map.scene.json').read_text())
    paths = {row['id']: ROOT / 'web/public/assets' / row['url'] for row in scene['assets']}
    payload, records = bytearray(), []
    for row in recovered['records']:
        assert row['sourceLod'] == 0
        path = paths[row['assetId']]
        uv0, indices = glb_accessors(path, row['primitiveIndex'])
        assert sha(uv0) == row['uv0Sha256'] and sha(indices) == row['indexSha256']
        source = (ROOT / 'exports/materials/propspreset-uv' / row['uv1File']).read_bytes()
        assert sha(source) == row['uv1Sha256'] and len(source) == row['vertexCount'] * 8
        records.append({**row, 'glbSha256': sha(path.read_bytes()), 'byteOffset': len(payload), 'byteLength': len(source),
                        'uv0Fingerprint': fingerprint(uv0), 'indexFingerprint': fingerprint(indices)})
        payload.extend(source)
    target = ROOT / 'web/public/assets/propspreset-uv1.bin'
    target.write_bytes(payload)
    return {'evidenceId': recovered['evidenceId'], 'url': '/assets/propspreset-uv1.bin', 'sha256': sha(payload), 'byteLength': len(payload), 'records': records}


def main():
    OUT.mkdir(exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    materials, identities, array = source_materials()
    textures = publish_textures(identities, array)
    for row in materials:
        row['textures'] = {role: textures[binding['texture']['fileGuid']]['url'] for role, binding in row['bindings'].items()}
    document = {'schemaVersion': 1, 'evidenceId': 'BF2-PROPSPRESET-MATERIAL-001', 'shaderName': REPORT['sourceShader'],
        'sourceRvmSha256': REPORT['sourceRvmSha256'], 'routingEvidence': 'exports/materials/propspreset-routing/routing-evidence.json',
        'routingSha256': sha((ROOT / 'exports/materials/propspreset-routing/routing-evidence.json').read_bytes()),
        'geometryRouting': json.loads((ROOT / 'exports/materials/propspreset-routing/geometry-evidence.json').read_text()),
        'materialGroups': REPORT['materialGroups'], 'materials': materials, 'sourceTextures': textures, 'uv1': publish_uv(),
        'placedSectionCount': sum(row['placementCount'] for row in materials),
        'nativeLightingInputs': {'materialId': 0, 'reflectance': .5, 'shNormal': 'final-normalized-source-world-normal',
            'smoothnessExpression': 'bf2_props_surface.smoothness', 'metalnessExpression': 'bf2_props_surface.metalness',
            'emissiveExpression': 'bf2_props_surface.emissive', 'emissiveStage': 'prelighting-before-frame-exposure-and-deferred-DFG/albedo/nonmetal', 'ao': 1},
        'runtimeMapping': {'branchSelection': 'Exact compiled section predicates plus authored shader defaults; native live pass is not claimed observed.',
            'color': 'Original 4*CS.rgb*detail.b*tint; LOD-simple uses 2*CS.rgb*tint.',
            'normal': 'Original tangent expression, normalized after exact native interpolated T/B/N for19 source-bound rigid32/36 sections (376 placed instances); other geometry retains derivative TBN.',
            'roughness': '1-clamp(raw source smoothness,0,1) for Three; raw smoothness preserved for original atlas.',
            'emissive': 'Source-probe integration must add surface.emissive to atlas/SH prelighting before DFG/albedo/nonmetal; Three emission disabled.',
            'samplers': 'Native 5993a514cd wrap U/V; shader explicitly clamps only normal coordinates. Browser linear mip filtering; native anisotropy conversion remains unresolved.',
            'uv': 'Source UV0 drives normal/detail. Alarm source UV1 drives CS, layer index, and emissive mask. Existing native UV bytes retained, no flip.',
            'lod': 'Both currently active alternative LODs (box LOD1/LOD2) resolve to identical material parameter blocks and the same ordinary PS. Exact proof retained in geometryRouting.'},
        'limitations': ['Native pass activation and dynamic runtime material overrides are not captured.',
            'Native tangent frames are restricted to BF2-NATIVE-TANGENT-PROPSPRESET32-001 and BF2-NATIVE-TANGENT-PROPSPRESET36-001:19 sections/376 instances. Eight other base sections/98 instances and their lower LODs retain derivative TBN.',
            'Selected native mips are preserved; browser lower mips, filtering and Three BRDF remain existing renderer boundaries.',
            'Source branch/model API is ready; shared source lighting and atlas integration are separate root-owned changes.']}
    (ROOT / 'web/public/assets/recovered-propspreset-materials.json').write_text(json.dumps(document, indent=2) + '\n')
    (OUT / 'provenance.json').write_text(json.dumps(textures, indent=2) + '\n')
    template = (ROOT / 'tools/materials/propspreset-adapter.template.js').read_text()
    equations = (ROOT / 'tools/materials/propspreset-equations.glsl').read_text()
    (ROOT / 'web/src/propspreset-material.js').write_text(template.replace('__PROPSPRESET_GLSL__', json.dumps(equations)))
    print(json.dumps({'materials': len(materials), 'sourceTextures': len(textures), 'uvRecords': len(document['uv1']['records']),
                      'uvBytes': document['uv1']['byteLength'], 'newTextureBytes': sum(row['bytes'] for row in textures.values() if row['format'] != 'rgba8-array')}))


if __name__ == '__main__':
    main()
