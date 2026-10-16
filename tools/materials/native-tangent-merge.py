"""Merge independently proven source layouts; publication is explicit."""
import argparse
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/native-tangent32/combined'
sha = lambda data: hashlib.sha256(data).hexdigest()
parser = argparse.ArgumentParser()
parser.add_argument('--publish', action='store_true')
args = parser.parse_args()
records, sources, payload = [], [], bytearray()
frame = None
frame_equations = {}
for directory, stride, layout in [('native-tangent-coverage', 36, '07a62c2c96'), ('native-tangent32', 32, 'ad2dd1141c'), ('native-tangent-nonmetal', 32, 'ad2dd1141c'), ('native-tangent-metallic', 32, 'ad2dd1141c'), ('native-tangent44', 44, '21d0b76a8c'), ('native-tangent-metalonly32', 32, 'ad2dd1141c'), ('native-tangent-metalonly36', 36, '07a62c2c96'), ('native-tangent-metalonly44', 44, '21d0b76a8c'), ('native-tangent-ceiling32', 32, 'ad2dd1141c'), ('native-tangent-ceiling44', 44, '21d0b76a8c'), ('native-tangent-catwalk232', 32, 'ad2dd1141c'), ('native-tangent-catwalk236', 36, '07a62c2c96'), ('native-tangent-propspreset32', 32, 'ad2dd1141c'), ('native-tangent-propspreset36', 36, '07a62c2c96'), ('native-tangent-array2uv36', 36, '07a62c2c96'), ('native-tangent-array1uv32', 32, 'ad2dd1141c'), ('native-tangent-array1uv28', 28, '8271cd66a9'), ('native-tangent-catwalk132', 32, 'ad2dd1141c'), ('native-tangent-catwalk128', 28, '8271cd66a9'), ('native-tangent-array2uv-composite44', 44, '9aa9d715d7'), ('native-tangent-exterior32', 32, 'ad2dd1141c')]:
    folder = ROOT / 'exports/materials' / directory
    composite = directory == 'native-tangent-array2uv-composite44'
    stem = 'native-tangent-explicit' if stride == 44 and not composite else 'native-tangent-witness'
    encoded = (folder / (stem + '.json')).read_bytes()
    document = json.loads(encoded)
    binary = (folder / (stem + '.bin')).read_bytes()
    assert len(binary) == document['byteLength'] and sha(binary) == document['sha256']
    frame_kind = 'signed-cross-source-normal' if composite else 'explicit-binormal' if stride == 44 else 'signed-cross'
    assert frame_kind not in frame_equations or frame_equations[frame_kind] == document['frameEquation']
    frame_equations[frame_kind] = document['frameEquation']
    frame = frame_equations['signed-cross']
    coverage_id = document.get('coverageEvidenceId', document['evidenceId'])
    start = len(payload)
    sources.append(dict(evidenceId=coverage_id, documentPath=str((folder / (stem + '.json')).relative_to(ROOT)).replace('\\', '/'),
                        documentSha256=sha(encoded), evidencePath=str((folder / 'evidence.json').relative_to(ROOT)).replace('\\', '/'),
                        evidenceSha256=sha((folder / 'evidence.json').read_bytes()), payloadSha256=sha(binary),
                        byteOffset=start, byteLength=len(binary), records=len(document['records']),
                        sourceVertexStride=stride, sourceInputLayout=layout, frameKind=frame_kind))
    for row in document['records']:
        record = dict(row, tangentOffset=row['tangentOffset'] + start,
                      sourceTangentOffset=row['tangentOffset'], sourceCoverageEvidenceId=coverage_id,
                      sourceVertexStride=stride, sourceInputLayout=layout, frameKind=frame_kind)
        if frame_kind == 'explicit-binormal':
            record.update(binormalOffset=row['binormalOffset'] + start, sourceBinormalOffset=row['binormalOffset'])
        if frame_kind == 'signed-cross-source-normal':
            record.update(normalOffset=row['normalOffset'] + start, sourceNormalOffset=row['normalOffset'])
        records.append(record)
    payload.extend(binary)
assert len(records) == 273
assert len({(r['assetId'], r['sourceLod'], r['primitiveIndex']) for r in records}) == len(records)
assert sum(r['placementCount'] for r in records if r['sourceLod'] == 0) == 5558
combined = dict(version=1, evidenceId='BF2-NATIVE-TANGENT-WITNESS-001', coverageEvidenceId='BF2-NATIVE-TANGENT-COMBINED-001',
                coverageEvidenceIds=[s['evidenceId'] for s in sources], sourceCoverage=sources,
                url='/assets/native-tangent-witness.bin', sha256=sha(payload), byteLength=len(payload), records=records, frameEquation=frame, frameEquations=frame_equations,
                limitations=['Only original rigid28/32/36-byte signed frames and six rigid44-byte Metallic/MetalOnly/Ceiling explicit-binormal declarations plus five identity-composite44 Array2UV sections with independently recovered RVM shader/input-layout routing are included.',
                             f"Original rigid positions/normals and every UV0/index match corresponding GLBs byte-for-byte; composite positions/normals match pinned identity-part exporter arithmetic, with raw source normals retained separately; all {sum(r['vertexCount'] for r in records)} source vertices are checked.",
                             'WARP covers 1225 sampled36-byte Master vertices, 4575 sampled32-byte Master vertices, 107 sampled nonmetal vertices, 844 sampled metallic signed vertices and 195 sampled metallic explicit-binormal vertices plus1685 sampled MetalOnly32/36/44 and1075 sampled Ceiling32/44 plus2265 sampled Catwalk32/36 and1220 sampled PropsPreset32/36 plus650 sampled Array2UV36 and448 sampled Array1UV32 plus325 sampled Exterior32 and324 sampled Array1UV28 and873 sampled Catwalk1 28/32 vertices across12 transforms; composite44 adds341 sampled vertices through60 transform/visibility cases on each original ordinary/atlas VS; raw payload and GLB checks include every recovered vertex.',
                             'Native converter execution, live native pass dispatch and a running original game frame are not captured.',
                             'Identity composite parts use static positive rest-pose visibility; native destruction/part visibility remains outside this tangent reconstruction.',
                             'Other source layouts and material families retain their prior frame path.'],
                publication=dict(preparedSections=273, baseSectionInstances=5558, sourceVertices=sum(r['vertexCount'] for r in records),
                                 sourceLayoutCounts={'28':6,'32':221,'36':35,'44':11}, baseSections=215, lowerLodSections=58,
                                 activation='Published only when native-tangent-merge.py is invoked with --publish.'))
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'native-tangent-witness.bin').write_bytes(payload)
(OUT / 'native-tangent-witness.json').write_text(json.dumps(combined, indent=2) + '\n')
if args.publish:
    published = dict(combined)
    published['publication'] = dict(combined['publication'], activation='Runtime activation is restricted to these273 exact source sections; all current lower-LOD alternatives are covered. Explicit-binormal routing is scoped to three metallic emissive, two MetalOnly and one Ceiling sections.')
    (ROOT / 'web/public/assets/native-tangent-witness.bin').write_bytes(payload)
    (ROOT / 'web/public/assets/native-tangent-witness.json').write_text(json.dumps(published, indent=2) + '\n')
print(json.dumps(dict(published=args.publish, records=len(records), bytes=len(payload), sha256=sha(payload))))
