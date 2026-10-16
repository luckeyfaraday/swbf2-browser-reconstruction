"""Publish native shadow-category caster geometry for the browser.

Evidence: BF2-NATIVE-SHADOW-CASTERS-PUBLISH-001. Input is the hash-checked export
BF2-NATIVE-SHADOW-CASTER-METADATA-001 (category index 4 = MeshSubsetCategoryFlags_
Shadow). Only LOD0 shadow-category sections are published; their original float32
positions and uint32 indices are copied byte for byte. Records whose shadow
sections have no exported geometry (composite meshes) are listed for an explicit
visible-geometry fallback; records without any shadow section cast nothing.
"""
from pathlib import Path
import hashlib, json, struct

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'exports/lighting/native-shadow-caster-geometry'
OUT = ROOT / 'web/public/assets/lighting'
SHADOW = 1 << 4

doc = json.loads((SOURCE / 'metadata.json').read_text(encoding='utf-8'))
assert doc['evidenceId'] == 'BF2-NATIVE-SHADOW-CASTER-METADATA-001'
payload = bytearray(); assets = []; fallback = []; none = []
for record in doc['records']:
    lod0 = next((lod for lod in record['lods'] if lod['sourceLod'] == 0), None)
    shadow = [s for s in (lod0['sections'] if lod0 else []) if s['categoryMask'] & SHADOW]
    if not shadow:
        none.append(record['assetId']); continue
    if any(not s.get('geometry') for s in shadow):
        # Composite meshes: shadow sections exist but rigid positions were not exported.
        fallback.append({'assetId': record['assetId'], 'meshType': record['meshType'], 'shadowSections': [s['sourceSectionIndex'] for s in shadow]})
        continue
    sections = []
    for s in shadow:
        g = s['geometry']
        positions = (SOURCE / g['positionsFile']).read_bytes(); indices = (SOURCE / g['indicesFile']).read_bytes()
        assert hashlib.sha256(positions).hexdigest() == g['positionsSha256']
        assert hashlib.sha256(indices).hexdigest() == g['indicesSha256']
        assert len(positions) == s['vertexCount'] * 12 and len(indices) == s['indexCount'] * 4
        assert max(struct.unpack('<%dI' % s['indexCount'], indices)) < s['vertexCount']
        while len(payload) % 4: payload.append(0)
        positionsOffset = len(payload); payload += positions
        indicesOffset = len(payload); payload += indices
        sections.append({'sourceSectionIndex': s['sourceSectionIndex'], 'categoryMask': s['categoryMask'],
                         'visibleSection': bool(s['categoryMask'] & 1), 'positionsOffset': positionsOffset,
                         'vertexCount': s['vertexCount'], 'indicesOffset': indicesOffset, 'indexCount': s['indexCount'],
                         'positionsSha256': g['positionsSha256'], 'indicesSha256': g['indicesSha256']})
    assets.append({'assetId': record['assetId'], 'meshName': record['meshName'], 'meshType': record['meshType'], 'sections': sections})

OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'native-shadow-casters.bin').write_bytes(bytes(payload))
report = {
    'evidenceId': 'BF2-NATIVE-SHADOW-CASTERS-PUBLISH-001',
    'sourceEvidenceId': doc['evidenceId'],
    'sourceMetadataSha256': hashlib.sha256((SOURCE / 'metadata.json').read_bytes()).hexdigest(),
    'url': '/assets/lighting/native-shadow-casters.bin',
    'sha256': hashlib.sha256(payload).hexdigest(), 'byteLength': len(payload),
    'coordinateConversion': 'none; original rigid mesh-local positions and winding, as in the visible GLBs',
    'assets': assets, 'visibleFallbackAssets': fallback, 'nonCastingAssets': none,
    'summary': {'castingAssets': len(assets), 'sections': sum(len(a['sections']) for a in assets),
                'vertices': sum(s['vertexCount'] for a in assets for s in a['sections']),
                'triangles': sum(s['indexCount'] for a in assets for s in a['sections']) // 3,
                'shadowOnlySections': sum(not s['visibleSection'] for a in assets for s in a['sections']),
                'visibleFallbackAssets': len(fallback), 'nonCastingAssets': len(none)},
    'limitations': [
        'LOD0 shadow-category sections only; native caster LOD selection is not linked.',
        'Entity-level caster overrides and per-view culling/fade are not linked.',
        'Composite meshes listed in visibleFallbackAssets cast with their visible browser geometry (inferred).',
    ],
}
(OUT / 'native-shadow-casters.json').write_text(json.dumps(report, indent=1) + '\n', encoding='utf-8', newline='\n')
print(json.dumps(report['summary']))
