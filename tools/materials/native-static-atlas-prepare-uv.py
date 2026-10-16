"""Retain exact source radiosity UVs after matching existing browser topology."""
import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXPORT = ROOT / 'exports/lighting/static-atlas-all-uv'
PUBLIC = ROOT / 'web/public/assets/lighting'
read = lambda path: json.loads((ROOT / path).read_text(encoding='utf-8'))
sha = lambda value: hashlib.sha256(value).hexdigest()


def fingerprint(value):
    result = 2166136261
    for byte in value:
        result = ((result ^ byte) * 16777619) & 0xffffffff
    return result


def glb(path):
    source = path.read_bytes()
    length = struct.unpack_from('<I', source, 12)[0]
    document = json.loads(source[20:20+length])
    binary = source[28+length:]
    assert source[:4] == b'glTF' and len(document['meshes']) == 1

    def attribute(index):
        accessor = document['accessors'][index]
        view = document['bufferViews'][accessor['bufferView']]
        at = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        components = {'VEC2': 2, 'VEC3': 3, 'SCALAR': 1}[accessor['type']]
        assert accessor['componentType'] in (5125, 5126) and 'byteStride' not in view
        return binary[at:at+accessor['count']*components*4]
    return source, document['meshes'][0]['primitives'], attribute


def main():
    scene = read('web/public/assets/map.scene.json')
    lods = read('web/public/assets/source-lods.json')
    paths = {(asset['id'], 0): ROOT / 'web/public/assets' / asset['url'] for asset in scene['assets']}
    for asset in lods['assets']:
        for level in asset['lods']:
            paths[asset['assetId'], level['level']] = ROOT / 'web/public' / level['url'].lstrip('/')
    source_manifest = (EXPORT / 'manifest.json').read_bytes()
    document = json.loads(source_manifest)
    cache, payload, records = {}, bytearray(), []
    for row in document['records']:
        key = row['assetId'], row['sourceLod']
        if key not in cache:
            cache[key] = glb(paths[key])
        source, primitives, attribute = cache[key]
        primitive = primitives[row['primitiveIndex']]
        uv0 = attribute(primitive['attributes']['TEXCOORD_0'])
        indices = attribute(primitive['indices'])
        positions = attribute(primitive['attributes']['POSITION'])
        assert sha(uv0) == row['uv0Sha256'] and sha(indices) == row['indexSha256'], key
        assert len(positions) == row['vertexCount'] * 12 and len(indices) == row['indexCount'] * 4
        fields = [field for field in row['fields'] if field['usage'] == 'RadiosityTexCoord']
        assert len(fields) == 1, key
        field = fields[0]
        raw = (EXPORT / field['file']).read_bytes()
        assert sha(raw) == field['sha256'] and len(raw) == row['vertexCount'] * 8
        values = list(struct.iter_unpack('<ff', raw))
        records.append({**{key: row[key] for key in ('assetId', 'sourceLod', 'primitiveIndex', 'sourceSectionIndex',
                          'sourceMaterialId', 'vertexCount', 'indexCount', 'chunkGuid', 'chunkSha256')},
                        'sourceFile': (EXPORT / field['file']).relative_to(ROOT).as_posix(),
                        'sourceSha256': field['sha256'], 'byteOffset': len(payload), 'byteLength': len(raw),
                        'uvBounds': [[min(value[axis] for value in values) for axis in range(2)],
                                     [max(value[axis] for value in values) for axis in range(2)]],
                        'glbPath': paths[key].relative_to(ROOT).as_posix(), 'glbSha256': sha(source),
                        'uv0Sha256': sha(uv0), 'indexSha256': sha(indices),
                        'uv0Fingerprint': fingerprint(uv0), 'indexFingerprint': fingerprint(indices)})
        payload.extend(raw)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / 'static-atlas-uv.bin').write_bytes(payload)
    result = {'version': 1, 'evidenceId': 'BF2-NATIVE-STATIC-ATLAS-UV-PREPARED-001',
              'sourceEvidenceId': document['evidenceId'], 'sourceManifestSha256': sha(source_manifest),
              'url': '/assets/lighting/static-atlas-uv.bin', 'sha256': sha(payload), 'byteLength': len(payload),
              'records': records, 'coordinateConversion': 'None. Original Half2 decoded to float32 with no V flip.',
              'limitations': ['Source radiosity coordinates and topology are proven; shader variant selection and atlas composition remain separately scoped.',
                              'Only nonzero matched map assets and already exported browser LODs are retained. No mesh or triangle is changed.']}
    (PUBLIC / 'static-atlas-uv.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'records': len(records), 'assetLods': len(cache), 'bytes': len(payload)}))


if __name__ == '__main__':
    main()
