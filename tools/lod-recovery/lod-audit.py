"""Bounded original-LOD feasibility audit; no synthetic simplification or GPU work."""
import argparse, collections, hashlib, json, math, pathlib, struct, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lod-recovery'
OUT.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--extra-visible-profile', type=pathlib.Path)
parser.add_argument('--extra-visible-count', type=int, default=24)
args = parser.parse_args()
sys.path.insert(0, str(ROOT / 'tools/materials/python-libs'))
from cityhash import CityHash64
scene = json.loads((ROOT / 'web/public/assets/map.scene.json').read_text())
mesh_doc = json.loads((ROOT / 'exports/materials/mesh-info/mesh-info.json').read_text())
mesh_info = {r['guid']: r for r in mesh_doc['results']}
block_doc = json.loads((ROOT / 'exports/materials/final-map-blocks.json').read_text())
blocks = {b['source']['rid']: b for b in block_doc['blocks']}
roots = collections.defaultdict(list)
for row in block_doc['roots']: roots[row['name'].split('_entry_')[0].lower()].append(row['resourceId'])
files = {}
for folder in ['root','spatial-extra','spatial-extra2','spatial-extra3','spatial-extra4','spatial-extra5']:
    for path in (ROOT / 'exports/map-initial' / folder / 'ebx').glob('*.json'):
        files[path.stem.split('__')[-1]] = path
instances = collections.defaultdict(list)
for row in scene['instances']: instances[row['assetId']].append(row)

def material_parameters(rid, seen=None):
    seen = set() if seen is None else seen
    if rid in seen: return []
    seen.add(rid)
    b = blocks[rid]
    return [dict(p, sourceBlock=rid) for p in b.get('parameters', [])] + [p for c in b.get('children', []) for p in material_parameters(c,seen)]

def parameters_key(parameters):
    return sorted(set((p['packedFlags'],p['typeHash'],p['rawHex']) for p in parameters))

def source_sections(asset, info, root_guid, lod):
    expected = str(CityHash64(struct.pack('<IIi', info['meshSetNameHash'],0,lod['index'])))
    candidates = [blocks[rid] for rid in roots[asset['name'].lower()] if blocks[rid]['hash']==expected]
    result = []
    for section in lod['sections']:
        if not section['exportedByStaticConverter']: continue
        matches = []
        for entry in candidates:
            children = entry.get('children', [])
            if section['index'] >= len(children): continue
            sec = blocks[children[section['index']]]
            children = sec.get('children', [])
            if len(children)<2: continue
            geometry = blocks[children[0]]
            if geometry.get('kind')!=3 or geometry.get('lod')!=lod['index'] or geometry.get('meshGuid')!=root_guid: continue
            params = material_parameters(children[1])
            matches.append({'sourceEntry':entry['source']['rid'],'sourceEntrySha256':entry['sha256'],
                            'sourceSection':section['index'],'geometryBlock':geometry['source']['rid'],
                            'parameterRoot':children[1],'parameters':params})
        result.append({**section,'matches':matches})
    return result

audit = []
groups = set()
for asset in scene['assets']:
    info = mesh_info[asset['id']]
    path = files.get(asset['id'])
    if path is None: raise AssertionError(('missing EBX',asset['id']))
    doc = json.loads(path.read_text())
    root = next(r for r in doc['asset']['objects'] if r['$id']==doc['asset']['root'])
    group = root.get('LodGroup')
    if group: groups.add(group['name'])
    lods = []
    baseline = None
    for lod in info['lods']:
        sections = source_sections(asset,info,root['$id'],lod)
        if lod['index']==0: baseline = sections
        for section in sections:
            peers = [s for s in baseline if s['materialId']==section['materialId']]
            section['lod0MaterialIdsUnique'] = len(peers)==1
            section['materialParametersEqualLod0'] = bool(len(peers)==1 and len(peers[0]['matches'])==1 and len(section['matches'])==1 and parameters_key(peers[0]['matches'][0]['parameters'])==parameters_key(section['matches'][0]['parameters']))
            if len(peers)==1: section['lod0SectionIndex'] = peers[0]['index']
        lods.append({'index':lod['index'],'chunkGuid':lod['chunkGuid'],'triangles':sum(s['primitiveCount'] for s in sections),
                     'sections':sections,'exactMaterialReuseEligible':all(s['materialParametersEqualLod0'] for s in sections)})
    assert lods[0]['triangles']==asset['localBounds']['triangles']
    count = len(instances[asset['id']])
    row = {'assetId':asset['id'],'name':asset['name'],'meshType':info['meshType'],'resourceId':info['resourceId'],
           'sourceEbxSha1':info['entry']['sha1'],'sourceResourceSha1':info['resource']['sha1'],
           'sourceEbxPath':path.relative_to(ROOT).as_posix(),'sourceEbxJsonSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
           'meshSetNameHash':info['meshSetNameHash'],'rootInstanceGuid':root['$id'],'sourceLodGroup':group,
           'sourceLodScale':root.get('LodScale'),'sourceLodDirectionalDistances':{k:v for k,v in root.items() if k.startswith('LodDistances')},
           'instanceCount':count,'lod0PlacedTriangles':lods[0]['triangles']*count,'localBounds':asset['localBounds'],'lods':lods}
    audit.append(row)
audit.sort(key=lambda r:-r['lod0PlacedTriangles'])
selected = [r for r in audit if len(r['lods'])>1 and r['lods'][1]['exactMaterialReuseEligible']][:24]
selected_ids = {r['assetId'] for r in selected}
selection = 'Top 24 all-placement triangle contributors with source LOD1 and exact per-material parameter equivalence to LOD0.'
visible_selection = None
if args.extra_visible_profile:
    raw = args.extra_visible_profile.read_bytes()
    profile = json.loads(raw)
    assert profile['pass'] and args.extra_visible_count > 0
    geometry = next(row['geometry'] for row in reversed(profile['lodProfile']) if row['enabled'])
    by_id = {row['assetId']: row for row in audit}
    candidates = []
    for visible in sorted(geometry['assets'], key=lambda row: (-row['triangles'], row['id'])):
        row = by_id[visible['id']]
        if row['assetId'] in selected_ids or len(row['lods']) < 2 or not row['lods'][1]['exactMaterialReuseEligible']: continue
        # Equal values alone are insufficient for existing browser reuse.
        roots_by_id = {section['materialId']: section['matches'][0]['parameterRoot'] for section in row['lods'][0]['sections'] if len(section['matches']) == 1}
        if not all(len(section['matches']) == 1 and roots_by_id.get(section['materialId']) == section['matches'][0]['parameterRoot'] for section in row['lods'][1]['sections']): continue
        candidates.append((row, visible['triangles']))
    extra = candidates[:args.extra_visible_count]
    selected.extend(row for row, _ in extra)
    selected_ids.update(row['assetId'] for row, _ in extra)
    visible_selection = {'profile': args.extra_visible_profile.as_posix(), 'sha256': hashlib.sha256(raw).hexdigest(),
                         'count': len(extra), 'visibleLod0Triangles': sum(cost for _, cost in extra),
                         'assetIds': [row['assetId'] for row, _ in extra], 'camera': geometry['camera']}
    selection += f' Plus {len(extra)} highest remaining visible source assets in the retained enabled-LOD profile; all use identical material parameter roots.'
chunk_ids = {lod['chunkGuid'] for r in selected for lod in r['lods']}
chunks = {}
for line in (ROOT/'exports/map-initial/inventory/inventory.chunks.ndjson').open():
    row = json.loads(line)
    if row['guid'] in chunk_ids: chunks[row['guid']]={k:v for k,v in row.items() if k!='bundles'}
for row in audit:
    for lod in row['lods']:
        if lod['chunkGuid'] in chunks: lod['chunkSource']=chunks[lod['chunkGuid']]
report = {'evidenceId':'BF2-NATIVE-LOD-AUDIT-001','analysisKind':'source metadata and default parameter identity comparison, no GPU observation',
          'sourceMeshMetadataEvidence':mesh_doc['evidenceId'],'mapAssets':len(audit),'assetsWithLowerLods':sum(len(r['lods'])>1 for r in audit),
          'allPlacedLod0Triangles':sum(r['lod0PlacedTriangles'] for r in audit),'selection':selection,'visibleSelection':visible_selection,
          'selectedAssetIds':[r['assetId'] for r in selected],'selectedLod0PlacedTriangles':sum(r['lod0PlacedTriangles'] for r in selected),
          'selectedLod1PlacedTriangles':sum(r['lods'][1]['triangles']*r['instanceCount'] for r in selected),
          'assets':audit,'limitations':['All-placement triangle ranking is not a visible-frustum or occlusion profile.',
          'Source LOD geometry and parameters exist; native distance selection and global quality scaling still require the LodGroup dependency and controller interpretation.',
          'Parameter equality permits material reuse by original material ID only when explicitly proven; original section indices can change with LOD.',
          'Keep original LOD0 collision and per-instance probe identities independent of render geometry selection.',
          'No mesh decimation, guessed LOD thresholds or renderer changes are performed by this audit.']}
(OUT/'audit.json').write_text(json.dumps(report,indent=2))
(OUT/'lod1-names.txt').write_text('\n'.join(r['name'] for r in selected)+'\n')
(OUT/'lod2-names.txt').write_text('\n'.join(r['name'] for r in selected if len(r['lods'])>2 and r['lods'][2]['exactMaterialReuseEligible'])+'\n')
(OUT/'group-names.txt').write_text('\n'.join(sorted({r['sourceLodGroup']['name'] for r in selected if r['sourceLodGroup']}))+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ('assets','limitations','selectedAssetIds')},indent=2))
print(json.dumps([{'name':r['name'].split('/')[-1],'instances':r['instanceCount'],'triangles':[l['triangles'] for l in r['lods']], 'eligible':[l['exactMaterialReuseEligible'] for l in r['lods']], 'group':(r['sourceLodGroup']or{}).get('name')} for r in selected],indent=2))
