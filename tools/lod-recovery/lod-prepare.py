"""Validate and package bounded native render LODs; never replace LOD0 collision."""
import hashlib, json, math, pathlib, struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lod-recovery'
PUBLIC = ROOT / 'web/public/assets/lods'
PUBLIC.mkdir(exist_ok=True)
audit = json.loads((OUT/'audit.json').read_text())
scene = json.loads((ROOT/'web/public/assets/map.scene.json').read_text())
base_assets = {r['id']:r for r in scene['assets']}
groups = {}
for path in [*(OUT/'groups/ebx').glob('*.json'), *(OUT/'groups-extra/ebx').glob('*.json')]:
    doc = json.loads(path.read_text())
    root = next(x for x in doc['asset']['objects'] if x['$id']==doc['asset']['root'])
    groups[doc['entry']['guid']] = {'name':doc['entry']['name'],'guid':doc['entry']['guid'],
        'rootInstanceGuid':root['$id'],'sourceEbxSha1':doc['entry']['sha1'],
        'sourcePath':path.relative_to(ROOT).as_posix(),'sourceJsonSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'autoLod':root['AutoLod'],'distances':[root[f'Lod{i}Distance'] for i in range(1,7)],
        'cullScreenArea':root['CullScreenArea'],'shadowDistance':root['ShadowDistance']}

def glb(raw):
    magic,version,length = struct.unpack_from('<III',raw,0)
    assert (magic,version,length)==(0x46546c67,2,len(raw))
    json_length = struct.unpack_from('<I',raw,12)[0]
    doc = json.loads(raw[20:20+json_length])
    binary = raw[28+json_length:]
    assert len(binary)==doc['buffers'][0]['byteLength']
    return doc,binary

def accessor(doc,binary,index):
    a = doc['accessors'][index]
    v = doc['bufferViews'][a['bufferView']]
    components = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    code,width = {5126:('f',4),5125:('I',4),5123:('H',2)}[a['componentType']]
    assert v.get('byteStride',components*width)==components*width
    start = v.get('byteOffset',0)+a.get('byteOffset',0)
    values = struct.unpack_from('<'+str(a['count']*components)+code,binary,start)
    assert all(math.isfinite(x) for x in values)
    return a,values

exports = {}
for level in (1,2):
    manifest = json.loads((OUT/f'lod{level}/mesh.manifest.json').read_text())
    assert manifest['complete'] and not manifest['errors'], (level,manifest['errors'])
    exports[level] = {r['guid']:r for r in manifest['results']}
assets = []
for source in audit['assets']:
    if source['assetId'] not in audit['selectedAssetIds']: continue
    source_group = source['sourceLodGroup']
    group = groups[source_group['$external']]
    assert group['rootInstanceGuid']==source_group['classGuid']
    baseline = base_assets[source['assetId']]
    base_raw = (ROOT/'web/public/assets'/baseline['url']).read_bytes()
    base_doc,_ = glb(base_raw)
    row = {'assetId':source['assetId'],'name':source['name'],'meshType':source['meshType'],
           'lodScale':source['sourceLodScale'],'sourceLodGroup':group,'sourceDirectionalDistances':source['sourceLodDirectionalDistances'],
           'sourceEbxSha1':source['sourceEbxSha1'],'sourceResourceId':source['resourceId'],'sourceResourceSha1':source['sourceResourceSha1'],
           'sourceMeshSetNameHash':source['meshSetNameHash'],'instanceCount':source['instanceCount'],
           'lod0Triangles':source['lods'][0]['triangles'],'lod0Bounds':source['localBounds'],
           'lod0BrowserGlbSha256':hashlib.sha256(base_raw).hexdigest(),'lods':[]}
    for level in (1,2):
        if source['assetId'] not in exports[level]: continue
        selected = source['lods'][level]
        assert selected['exactMaterialReuseEligible']
        export = exports[level][source['assetId']]
        path = OUT/f'lod{level}'/export['file']
        raw = path.read_bytes()
        doc,binary = glb(raw)
        meta = doc['extras']
        assert meta['guid']==source['assetId'] and meta['lod']==level
        assert meta['resourceId']==source['resourceId'] and meta['chunkGuid']==selected['chunkGuid']
        assert meta['bindingApplied'] and not meta['flipV'] and not meta['textureMaterialsApplied']
        assert not any('reconstructed from triangles' in note for note in meta['limitations'])
        assert all(not any(k in node for k in ['matrix','translation','rotation','scale']) for node in doc['nodes'])
        primitives = [p for mesh in doc['meshes'] for p in mesh['primitives']]
        assert len(primitives)==len(selected['sections'])
        sections = []
        minimum,maximum = [math.inf]*3,[-math.inf]*3
        for primitive_index,(primitive,section) in enumerate(zip(primitives,selected['sections'])):
            a,positions = accessor(doc,binary,primitive['attributes']['POSITION'])
            n,normals = accessor(doc,binary,primitive['attributes']['NORMAL'])
            u,uvs = accessor(doc,binary,primitive['attributes']['TEXCOORD_0'])
            i,indices = accessor(doc,binary,primitive['indices'])
            assert a['count']==n['count']==u['count']==section['vertexCount']
            assert len(indices)==section['primitiveCount']*3 and max(indices)<a['count']
            mat = doc['materials'][primitive['material']]
            assert mat['extras']['sourceMaterialId']==primitive['extras']['sourceMaterialId']==section['materialId']
            assert primitive['extras']['sectionName']==section['name']
            lower = section['matches'][0]
            original = next(s for s in source['lods'][0]['sections'] if s['index']==section['lod0SectionIndex'])
            original = original['matches'][0]
            assert lower['parameterRoot']==original['parameterRoot'], 'Refuse material reuse without identical source block identity'
            for axis in range(3):
                minimum[axis] = min(minimum[axis],min(positions[axis::3]))
                maximum[axis] = max(maximum[axis],max(positions[axis::3]))
            sections.append({'primitiveIndex':primitive_index,'sourceSectionIndex':section['index'],
                'sourceMaterialId':section['materialId'],'sourceSectionName':section['name'],
                'lod0SectionIndex':section['lod0SectionIndex'],'lod0MaterialId':section['materialId'],
                'materialParametersEqualLod0':True,'sharedParameterRoot':lower['parameterRoot'],
                'sourceEntry':lower['sourceEntry'],'sourceEntrySha256':lower['sourceEntrySha256'],
                'lod0SourceEntry':original['sourceEntry'],'triangles':section['primitiveCount'],'vertices':section['vertexCount']})
        target = PUBLIC/f'{source["assetId"]}-lod{level}.glb'
        target.write_bytes(raw)
        row['lods'].append({'level':level,'url':'/assets/lods/'+target.name,'sha256':hashlib.sha256(raw).hexdigest(),
            'bytes':len(raw),'sourcePath':path.relative_to(ROOT).as_posix(),'triangles':selected['triangles'],
            'chunkGuid':selected['chunkGuid'],'chunkSource':selected.get('chunkSource'),
            'sections':sections,'bounds':{'min':minimum,'max':maximum},
            'coordinateConversion':meta['coordinateConversion'],'units':meta['units'],
            'identityNodeTransform':True,'sourceCompositePartTransforms':meta['partTransforms'],
            'compositePartTransformsEqualLod0':meta['partTransforms']==base_doc['extras'].get('partTransforms',[])})
    assert row['lods']
    assets.append(row)
helper = ROOT/'tools/lod-recovery/bf2-lod.exe'
document = {'evidenceId':'BF2-NATIVE-LOD-EXPORT-001','parentEvidenceId':audit['evidenceId'],
    'selection':audit['selection'],'assets':assets,'exporter':{'path':helper.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(helper.read_bytes()).hexdigest(),
    'sourceFiles':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ['tools/bf2-extract/ConvertAssets.cs','tools/bf2-extract/Historical.cs','tools/bf2-extract/Program.cs']}},
    'thresholdInterpretation':{'observed':'Each asset references its exact MeshLodGroup; distances and AutoLod=false are source values. Asset LodScale and directional distances are retained separately.',
       'unresolved':'Native group-versus-directional-distance precedence, LodScale arithmetic, global quality/FOV scaling, distance origin and hysteresis are not recovered. Do not apply guessed reciprocal scaling.'},
    'integration':{'materials':'Reuse the original loaded material by sourceMaterialId only for each proven sharedParameterRoot. Primitive order is recorded but original section indices are not assumed equal.',
       'geometry':'Use original native GLB positions/normals/UV0/indices; all GLB node transforms are identity and source Y-up metres are retained. Composite rest transforms are already baked by the original converter.',
       'collision':'Keep original LOD0 CollisionWorld/BVH immutable. These files are render alternatives only.',
       'probes':'Keep original per-instance probe assignments/offsets and original sampling bounds; changing render geometry must not change the instance identity or atlas row.'},
    'limitations':[f'This bounded export contains {sum(any(l["level"]==1 for l in a["lods"]) for a in assets)} native LOD1 and {sum(any(l["level"]==2 for l in a["lods"]) for a in assets)} native LOD2 alternatives, not the complete map LOD hierarchy.',
       'No native rendering or automatic LOD selection was observed. Camera distance choice and hysteresis must remain explicitly identified browser policy.',
       'Material constants and texture bindings share identical original parameter-root blocks; native tangent parity and unresolved original material shaders remain separate.',
       'No simplified replacement geometry is generated; source LOD0 collision and assets are unchanged.']}
(ROOT/'web/public/assets/source-lods.json').write_text(json.dumps(document,indent=2))
(OUT/'render-lods.json').write_text(json.dumps(document,indent=2))
print(json.dumps({'assets':len(assets),'levels':sum(len(a['lods']) for a in assets),'bytes':sum(l['bytes'] for a in assets for l in a['lods']),
                  'compositePartTransformsDiffer':[(a['name'],l['level']) for a in assets for l in a['lods'] if not l['compositePartTransformsEqualLod0']]}))
