"""Verify exact original 36-byte frames and prepare an inactive expansion."""
import collections
import hashlib
import json
import math
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/native-tangent-array2uv-composite44'
STRIDE = 44
read = lambda path: json.loads(path.read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()


def fingerprint(data):
    result = 2166136261
    for byte in data:
        result = ((result ^ byte) * 16777619) & 0xffffffff
    return result


def parse_glb(path):
    data = path.read_bytes()
    json_length = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + json_length])
    binary = data[28 + json_length:]
    assert len(document['meshes']) == 1
    assert all(not any(key in node for key in ['matrix', 'translation', 'rotation', 'scale']) for node in document['nodes'])

    def attribute(index):
        accessor = document['accessors'][index]
        view = document['bufferViews'][accessor['bufferView']]
        offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        assert accessor['componentType'] in (5125, 5126) and 'byteStride' not in view
        count = accessor['count'] * {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[accessor['type']]
        return binary[offset:offset + count * 4]
    return data, document, attribute


def main():
    selection = read(OUT / 'selection.json')
    targets = {(r['assetId'], r['sourceLod'], r['sourceMaterialId']): r for r in selection['targets']}
    extraction = read(OUT / 'manifest.json')
    original = read(ROOT / 'exports/materials/native-tangent-witness/evidence.json')
    routing = read(OUT / 'shader-routing.json') if (OUT / 'shader-routing.json').exists() else None
    coverage_id = routing['evidenceId'] if routing else 'BF2-NATIVE-TANGENT-COVERAGE-001'
    records, rejected, samples = [], [], []
    payload, sample_vertices = bytearray(), bytearray()
    for row in extraction['records']:
        route = targets[(row['assetId'], row['sourceLod'], row['sourceMaterialId'])]
        if not row['exactPreparedLayout'] or not row['compositeIdentitySource']:
            rejected.append(dict(assetId=row['assetId'], sourceLod=row['sourceLod'], sourceMaterialId=row['sourceMaterialId'],
                                 reason=f'Original declaration is outside the proven identity-composite{STRIDE} input layout.', fields=row['fields']))
            continue
        vertices = (OUT / row['vertexFile']).read_bytes()
        indices = (OUT / row['indexFile']).read_bytes()
        assert sha(vertices) == row['vertexSha256'] and sha(indices) == row['indexSha256']
        assert len(vertices) == row['vertexCount'] * STRIDE and len(indices) == row['indexCount'] * 4
        columns = {name: [struct.unpack_from('<' + fmt, vertices, i * STRIDE + offset) for i in range(row['vertexCount'])]
                   for name, offset, fmt in [('position', 0, '3e'), ('sign', 6, 'e'), ('normal', 16, '4e'),
                                            ('tangent', 24, '4e'), ('uv0', 32, '2e'), ('uv1', 36, '2e'), ('bone', 8, '4H')]}
        assert all(math.isfinite(value) for column in columns.values() for vertex in column for value in vertex)
        assert all(abs(sign[0]) == 1 for sign in columns['sign'])
        assert all(sum(v * v for v in vertex[:3]) > 0 for name in ['normal', 'tangent'] for vertex in columns[name])
        source_glb, gltf, attribute = parse_glb(ROOT / route['glbPath'])
        primitive = gltf['meshes'][0]['primitives'][row['primitiveIndex']]
        assert gltf['materials'][primitive['material']]['extras']['sourceMaterialId'] == row['sourceMaterialId']
        assert attribute(primitive['indices']) == indices
        attributes = {}
        for label, key, count in [('POSITION', 'position', 3), ('NORMAL', 'normal', 3), ('TEXCOORD_0', 'uv0', 2)]:
            raw = b''.join(struct.pack('<' + str(count) + 'f', *values[:count]) for values in columns[key])
            source_raw = raw
            if label == 'POSITION':
                raw = b''.join(struct.pack('<3f', *[v + 0.0 for v in values[:3]]) for values in columns[key])
            if label == 'NORMAL':
                f32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
                normalized = []
                for values in columns[key]:
                    # Identity inverse-transpose sums include +0, preserving the exporter signed-zero behavior.
                    nx, ny, nz = values[:3]
                    x, y, z = nx + 0.0*ny + 0.0*nz, 0.0*nx + ny + 0.0*nz, 0.0*nx + 0.0*ny + nz
                    length = f32(math.sqrt(f32(f32(f32(x*x) + f32(y*y)) + f32(z*z))))
                    normalized.append(tuple(f32(v / length) for v in (x, y, z)))
                raw = b''.join(struct.pack('<3f', *v) for v in normalized)
            assert raw == attribute(primitive['attributes'][label]), (row['assetId'], row['sourceLod'], label)
            attributes[label] = dict(sha256=sha(raw), fingerprint=fingerprint(raw), bytes=len(raw), bitIdentical=True,
                                     sourceRawSha256=sha(source_raw), mapping='pinned-exporter-identity-composite-normalization' if label == 'NORMAL' else ('pinned-exporter-identity-composite-position' if label == 'POSITION' else 'original-half-to-float'))
        offset = len(payload)
        for i in range(row['vertexCount']):
            payload.extend(struct.pack('<4f', *columns['tangent'][i][:3], columns['sign'][i][0]))
        normal_offset = len(payload)
        for normal in columns['normal']:
            payload.extend(struct.pack('<3f', *normal[:3]))
        record = {key: row[key] for key in ['assetId', 'sourceLod', 'primitiveIndex', 'sourceSectionIndex', 'sourceMaterialId',
                                           'vertexCount', 'indexCount', 'chunkGuid', 'chunkSha256', 'fields',
                                           'vertexFile', 'vertexSha256', 'indexFile', 'indexSha256']}
        record.update(family=route['family'], lod0MaterialId=route['lod0MaterialId'], sourceShader=route['sourceShader'],
                      glbPath=route['glbPath'], glbSha256=sha(source_glb), attributes=attributes,
                      indexFingerprint=fingerprint(indices), tangentOffset=offset, tangentBytes=row['vertexCount'] * 16,
                      signCounts={str(sign): sum(v[0] == sign for v in columns['sign']) for sign in [-1, 1]},
                      placementCount=route['placementCount'], sourceMeshName=row['meshName'],
                      frameKind='signed-cross-source-normal', normalOffset=normal_offset, normalBytes=row['vertexCount']*12,
                      partTransforms=row['partTransforms'], selectedShaderRoute=route['selectedShaderRoute'])
        if 'lodSourceMaterial' in route:
            record['lodSourceMaterial'] = route['lodSourceMaterial']
        if routing:
            record['sourceInputLayout'] = routing['shaders'][0]['inputLayoutBlock']
            record['sourceVertexStride'] = STRIDE
        records.append(record)
        # Sample every recovered section throughout its original vertex order,
        # include the first occurrence of each handedness, and retain identities.
        identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
        assert row['partTransforms'] == gltf['extras']['partTransforms']
        assert all(matrix == identity for matrix in row['partTransforms'])
        assert all(v[3] < len(row['partTransforms']) and v[0] == v[3] for v in columns['bone'])
        sample_indices = {round(i * (row['vertexCount'] - 1) / 63) for i in range(64)}
        for part in set(v[0] for v in columns['bone']):
            sample_indices.add(next(i for i,v in enumerate(columns['bone']) if v[0] == part))
        for sign in [-1, 1]:
            first = next((i for i, value in enumerate(columns['sign']) if value[0] == sign), None)
            if first is not None:
                sample_indices.add(first)
        for i in sorted(sample_indices):
            samples.append(dict(recordIndex=len(records) - 1, sourceVertex=i))
            sample_vertices.extend(vertices[i * STRIDE:(i + 1) * STRIDE])

    # Visible and zero-output gate cases retain all original vertex inputs.
    cases = [{**case, 'partVisibility': visibility, 'highBitBranch': high} for case in original['inputFixture']['cases']
             for visibility, high in [(1, False), (0, False), (1, True), (0, True), (2, False)]]
    fixture = bytearray(struct.pack('<4I', 0x3147544e, len(cases), len(samples), STRIDE))
    fixture.extend(sample_vertices)
    for case in cases:
        matrix = case['matrix']
        instance = bytearray(13 * 16)
        for base in [2, 9]:
            for row in range(3):
                struct.pack_into('<4f', instance, (base + row) * 16, *[matrix[column*4+row] for column in range(4)])
        # Original VS selects roots.x or roots.z by BoneIndices.x high bit.
        for root in [5, 12]:
            struct.pack_into('<4I', instance, root*16, 0, 0, 32, 0)
        globals_ = [0.0] * 152
        for i in range(4):
            globals_[14*4+i*4+i] = 1
        visibility = [0.0] * (64*4)
        for part in range(32):
            value = float(part % 2) if case['partVisibility'] == 2 else float(case['partVisibility'])
            visibility[(part + (32 if case['highBitBranch'] else 0))*4] = value
        # Opposite bank stays zero: incorrect high-bit routing cannot pass the positive cases.
        fixture.extend(instance)
        fixture.extend(struct.pack('<4I152f256fI', 0, 13, 0, 0, *globals_, *visibility, int(case['highBitBranch'])))
    (OUT / 'vertex-input.bin').write_bytes(fixture)
    document = dict(version=1, evidenceId='BF2-NATIVE-TANGENT-WITNESS-001', coverageEvidenceId=coverage_id,
                    url='/assets/native-tangent-witness.bin', sha256=sha(payload), byteLength=len(payload), records=records,
                    frameEquation=original['frameEquation'],
                    limitations=['Only selected identity-composite44 declarations with exact section permutation routes are included.',
                                 'UV0 and indices match each GLB byte-for-byte; positions and normals match pinned identity-part exporter arithmetic including signed zeros. Raw normals remain separately retained.',
                                 'Other layouts require a separate original input-layout or conversion proof; no extrapolation.',
                                 'Native dynamic destruction and part visibility are not reconstructed. Positive static rest-pose visibility is the scoped browser policy.',
                                 'This expanded candidate is retained outside web/public and is not activated by this builder.'])
    (OUT / 'native-tangent-witness.bin').write_bytes(payload)
    (OUT / 'native-tangent-witness.json').write_text(json.dumps(document, indent=2) + '\n')
    covered = {(r['assetId'], r['sourceLod'], r['sourceMaterialId']) for r in records}
    excluded = [r for r in selection['targets'] if (r['assetId'], r['sourceLod'], r['sourceMaterialId']) not in covered] + selection.get('excluded', [])
    stats = dict(sections=len(records), assets=len({r['assetId'] for r in records}), vertices=sum(r['vertexCount'] for r in records),
                 tangentBytes=len(payload), sectionsByLod=dict(collections.Counter(r['sourceLod'] for r in records)),
                 baseSectionInstances=sum(r['placementCount'] for r in records if r['sourceLod'] == 0),
                 basePlacements=sum({r['assetId']: r['placementCount'] for r in records if r['sourceLod'] == 0}.values()),
                 excludedSections=len(excluded), sampledVertices=len(samples))
    evidence = dict(evidenceId=coverage_id, stats=stats, shaders=routing['shaders'] if routing else original['shaders'],
                    baseEvidencePath='exports/materials/native-tangent-witness/evidence.json',
                    baseEvidenceSha256=sha((ROOT / 'exports/materials/native-tangent-witness/evidence.json').read_bytes()),
                    extractionSha256=sha((OUT / 'manifest.json').read_bytes()), selectionSha256=sha((OUT / 'selection.json').read_bytes()),
                    payloadSha256=sha(payload), records=records, nativeRejected=rejected, excluded=excluded,
                    inputFixture=dict(path='vertex-input.bin', sha256=sha(fixture), cases=cases, vertices=len(samples), stride=STRIDE, samples=samples))
    if routing:
        evidence['shaderRoutingSha256'] = sha((OUT / 'shader-routing.json').read_bytes())
    (OUT / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(stats))


if __name__ == '__main__':
    main()
