"""Inventory current active GLB sections after all published material adapters.

Read only source inputs; unused GLB material slots cannot inflate coverage.
Visibility numbers are retained CPU frustum evidence, not occlusion or pixels.
"""
import collections
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return json.loads((ROOT / path).read_text())


def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def main():
    scene_path = 'web/public/assets/map.scene.json'
    plan_path = 'exports/materials/final-map-material-plan.json'
    audit_path = 'exports/materials/visible-material-audit-current.json'
    scene, plan, audit = read(scene_path), read(plan_path), read(audit_path)
    placements = collections.Counter(row['assetId'] for row in scene['instances'])
    active, geometry = {}, []
    for asset in scene['assets']:
        path = 'web/public/assets/' + asset['url']
        raw = (ROOT / path).read_bytes()
        assert raw[:4] == b'glTF'
        size, kind = struct.unpack_from('<II', raw, 12)
        assert kind == 0x4E4F534A
        gltf = json.loads(raw[20:20 + size])
        active[asset['id']] = {p['material'] for mesh in gltf.get('meshes', []) for p in mesh['primitives'] if 'material' in p}
        geometry.append({'assetId': asset['id'], 'path': path, 'sha256': hashlib.sha256(raw).hexdigest(), 'activeMaterials': sorted(active[asset['id']])})
    recovered, documents = {}, []
    for file in sorted((ROOT / 'web/public/assets').glob('recovered-*-materials.json')):
        document = json.loads(file.read_text())
        relative = file.relative_to(ROOT).as_posix()
        documents.append({'path': relative, 'sha256': digest(relative)})
        for row in document.get('materials', []):
            recovered[(row['assetId'], row['materialId'])] = relative
    visible = {(row['assetId'], row['materialId']): row.get('visible') for family in audit['remainingFamilies'] for row in family['members']}
    families, unused = {}, []
    for mesh in plan['meshes']:
        if mesh['guid'] not in active:
            continue
        for material in mesh['materials']:
            key = mesh['guid'], material['index']
            name = (material.get('shader') or {}).get('name', 'UNKNOWN')
            if material['index'] not in active[mesh['guid']]:
                unused.append({'assetId': mesh['guid'], 'materialId': material['index'], 'shader': name, 'placementCount': placements[mesh['guid']]})
                continue
            if key in recovered:
                continue
            family = families.setdefault(name, {'shader': name, 'sections': 0, 'placedSectionInstances': 0, 'retainedFrustumTriangles': 0, 'members': []})
            frame = visible.get(key)
            family['sections'] += 1
            family['placedSectionInstances'] += placements[mesh['guid']]
            family['retainedFrustumTriangles'] += frame['triangles'] if frame else 0
            family['members'].append({'assetId': mesh['guid'], 'materialId': material['index'], 'meshName': mesh['name'], 'placementCount': placements[mesh['guid']], 'shaderIdentity': material.get('shader'), 'retainedFrustum': frame})
    rows = sorted(families.values(), key=lambda row: (-row['placedSectionInstances'], -row['retainedFrustumTriangles'], row['shader']))
    result = {'evidenceId': 'BF2-REMAINING-ACTIVE-MATERIALS-001', 'kind': 'Original GLB primitive references intersected with source material plan and published adapters',
        'inputs': [{'path': path, 'sha256': digest(path)} for path in [scene_path, plan_path, audit_path]], 'recoveredDocuments': documents,
        'geometry': geometry, 'families': rows, 'unusedPlanMaterialSlots': unused,
        'limitations': ['Base source GLB primitives only; alternative LOD material routing requires separate proof.',
            'Placed section instances can overlap on one mesh and are not unique placements.',
            'Retained frustum triangles are not screen coverage, opacity, or occlusion.',
            'Published adapter identity is counted as implemented, not as a new live GPU validation.']}
    output = ROOT / 'exports/materials/remaining-active-materials.json'
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'families': len(rows), 'sections': sum(row['sections'] for row in rows), 'unusedMaterialSlots': len(unused), 'top': [{k: v for k, v in row.items() if k != 'members'} for row in rows[:12]]}, indent=2))


if __name__ == '__main__':
    main()
