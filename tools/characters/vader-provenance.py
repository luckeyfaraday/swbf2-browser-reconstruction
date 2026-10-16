"""Write web/public/assets/characters/vader.source.json from retained Vader exports.

Pure aggregation of files written by the earlier steps (see tools/characters/VADER.md);
no game access. Run last, after validation.
Usage (workspace root): python tools/characters/vader-provenance.py
"""
import json, pathlib, hashlib, struct, glob, datetime
root = pathlib.Path(__file__).resolve().parents[2]
X = root / 'exports/characters'; WEB = root / 'web/public/assets/characters'
J = lambda p: json.loads(pathlib.Path(p).read_text())


def sha256(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()


def ebx(prefix, d='d1'):
    f = glob.glob(str(X / f'vader-ebx/{d}/ebx/{prefix}__*.json'))
    assert len(f) == 1, prefix
    e = J(f[0])['entry']; return {'name': e['name'], 'type': e['type'], 'guid': e['guid'], 'sha1': e['sha1']}


def glb_stats(path):
    data = pathlib.Path(path).read_bytes(); n = struct.unpack_from('<I', data, 12)[0]; doc = json.loads(data[20:20 + n])
    verts = tris = 0
    for m in doc['meshes']:
        for p in m['primitives']:
            verts += doc['accessors'][p['attributes']['POSITION']]['count']; tris += doc['accessors'][p['indices']]['count'] // 3
    return {'file': str(pathlib.Path(path).relative_to(root)).replace('\\', '/'), 'bytes': len(data), 'sha256': sha256(path),
            'vertices': verts, 'triangles': tris, 'nodes': len(doc['nodes']), 'skins': [(s['name'], len(s['joints'])) for s in doc.get('skins', [])],
            'materials': len(doc.get('materials', [])), 'images': [i['uri'] for i in doc.get('images', [])]}, doc


def validation(name):
    r = J(X / f'vader-validation/{name}.json'); i = r['issues']
    return {'validator': r.get('validatorVersion'), 'errors': i['numErrors'], 'warnings': i['numWarnings'], 'infos': i['numInfos'],
            'warningCodes': sorted({m['code'] for m in i['messages'] if m['severity'] == 1})}


session = J(X / 'vader-ebx/d1/session.json'); meshinfo = {m['guid']: m for m in J(X / 'vader-mesh-info/mesh-info.json')['results']}
skins = {c: J(X / f'vader-converted/vader-{c}.skin.json') for c in ('body', 'cape')}
fits = {c: J(X / f'vader-converted/vader-{c}.skeleton-fit.json') for c in ('body', 'cape')}
bindings = {c: J(X / f'vader-material-inputs/vader-{c}.glb.binding.json') for c in ('body', 'cape')}
saber = J(X / 'vader-saber/saber-evidence.json'); post = J(X / 'vader-materials/material-post.json')
conversion = J(X / 'vader-materials/glb/material-conversion.json')
skel = J(X / 'vader-converted/vader-body.skeleton.ebx.json'); skel_root = skel['asset']['objects'][0]
spec = J(X / 'vader-ebx/raw-specialization/1b1dee6b-dc60-4a0d-afad-b41e67fa2960.json')
bp = J(glob.glob(str(X / 'vader-ebx/d1/ebx/Characters_Hero_DarthVader_DarthVader_01_DarthVader_01__*.json'))[0])['asset']['objects'][1]
cloth = J(glob.glob(str(X / 'vader-ebx/d1/ebx/Characters_Hero_DarthVader_DarthVader_01_DarthVader_01_Cape__*.json'))[0])['asset']['objects'][1]
clothasset = J(glob.glob(str(X / 'vader-ebx/d1/ebx/Characters_Hero_DarthVader_DarthVader_01_Cloth_DarthVader_01_Cape_EACloth__*.json'))[0])['asset']['objects'][0]
vurb = J(glob.glob(str(X / 'vader-ebx/d1/ebx/characters_hero_darthvader_darthvader_01_vur_darthvader_01_bpb__*.json'))[0])['asset']['objects']
vur_root = next(o for o in vurb if o.get('__Id') == 'VisualUnlockRootAsset'); vur_ids = {o.get('$id'): o for o in vurb}
rig_scale = vur_ids[vur_root['RigScale']['$ref']]; ant_states = [vur_ids[r['$ref']] for r in vur_root['VisualAntGameStates']]
bone_names = skel_root['BoneNames']


def lt(t): return {k: [t[k][c] for c in 'xyz'] for k in ('right', 'up', 'forward', 'trans')}


def mesh_block(c, guid):
    s = skins[c]; mi = meshinfo[guid]; lod = next(l for l in mi['lods'] if l['index'] == s['lod'])
    return {'source': s['source'], 'guid': s['sourceGuid'], 'sha1': s['sourceSha1'], 'resourceId': s['resourceId'], 'lodChunkGuid': s['chunkGuid'],
            'meshSetNameHash': mi['meshSetNameHash'], 'meshType': s['meshType'], 'lod': s['lod'], 'lodCount': len(mi['lods']),
            'sections': [{'index': x['index'], 'name': x['name'], 'materialId': x['materialId'], 'vertices': x['vertexCount'], 'triangles': x['primitiveCount'],
                          'exported': x['exportedByStaticConverter']} for x in lod['sections']],
            'skin': {'standardBones': s['standardBoneCount'], 'proceduralBones': [{'name': b['name'], 'parent': bone_names[b['parent']]} for b in s['bones'] if b['procedural']],
                     'jointCount': len(s['bones']), 'maxJoint': s['maxJoint'], 'zeroWeightVertices': s['zeroWeightVertices'],
                     'maxRestMatrixError': bindings[c]['maxRestMatrixError'], 'maxDiscardedWeight': bindings[c]['maxDiscardedWeight'],
                     'bindingRule': s['bindingRule']},
            'skeletonFit': fits[c]}


outputs = {}
for name in ('vader', 'vader-body', 'vader-cape', 'vader-saber'):
    stats, doc = glb_stats(WEB / f'{name}.glb'); stats['validation'] = validation(name); outputs[name] = stats
textures = [{'file': t['file'], 'sha256': t['sha256']} for t in post['textures']]
materials = []
for name in ('vader-body', 'vader-cape', 'vader-saber'):
    _, doc = glb_stats(WEB / f'{name}.glb')
    for m in doc.get('materials', []):
        ex = m.get('extras', {}); b = ex.get('sourceBindings', {})
        materials.append({'component': name, 'material': m.get('name'), 'sourceMaterialId': ex.get('sourceMaterialId'), 'sourceSection': ex.get('sourceSection'),
                          'surfaceShader': (ex.get('sourceMaterial') or {}).get('surfaceShader'),
                          'bindings': {role: {'parameter': v['parameter'], 'texture': v['texture']['name'], 'fileGuid': v['texture']['fileGuid'],
                                              'rootInstanceGuid': v['texture']['rootInstanceGuid'], 'sha1': v['texture']['sha1'],
                                              'shaderEntryResourceId': v.get('sourceEntry'), 'basis': v['identityBasis']} for role, v in b.items()},
                          'gltf': {k: m['pbrMetallicRoughness'].get(k) for k in ('metallicFactor', 'roughnessFactor')} | {
                              'roughnessFromCSAlpha': 'metallicRoughnessTexture' in m['pbrMetallicRoughness'], 'normalTexture': 'normalTexture' in m,
                              'emissiveFactor': m.get('emissiveFactor'), 'doubleSided': m.get('doubleSided', False)},
                          'emissive': ex.get('emissive'), 'sourceVectorParameters': (ex.get('sourceMaterial') or {}).get('vectorParameters')})

out = {
    'schemaVersion': 1, 'evidenceId': 'VADER-CHARACTER-001', 'generatedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    'game': {'profile': session['profile'], 'patchHead': session['patchHead'], 'toolSdkSha256': session['toolSdkSha256'], 'gameSdkSha256': session['gameSdkSha256'],
             'access': 'install opened read-only through the pinned Frosty 1.0.5.2 adapter; no files written to the install'},
    'outputs': outputs, 'textures': textures,
    'actor': {'file': 'vader.glb', 'components': ['vader-body.glb', 'vader-cape.glb'], 'animated': False,
              'nodeConventions': 'identical to stormtrooper.glb: per-component mesh node + independent Walrus_HumanMale rig; bone nodes carry extras.sourceBoneIndex/procedural; animation tracks bind by bone name',
              'coordinates': 'source Y-up metres, actor faces +Z in bind space (same as troopers; manifest rotation pi about Y used for troopers)',
              'lodPolicy': 'source LOD1 for body and cape (same policy as stormtrooper/rebel)'},
    'meshes': {'body': mesh_block('body', '862681fd-919a-9bf8-415c-cdf09866a6e6'), 'cape': mesh_block('cape', 'a86c541e-bceb-5b1a-450e-61e4bd19aaff')},
    'skeleton': {'name': skel['entry']['name'], 'guid': skel['entry']['guid'], 'sha1': skel['entry']['sha1'], 'bones': len(bone_names),
                 'evidence': [
                     'OBSERVED: SoldierBlueprint Gameplay/Characters/Heroes/Specializations/Hero_Lightsaber_DarthVader (sha1 %s) lists EBX dependency b23fb851-8dc5-4e3b-8f48-14169450daa0 = Characters/Rigs/Humanoids/Walrus_HumanMale_MasterSke; its typed decode fails in the historical SDK, raw EBX retained.' % spec['sha1'],
                     'OBSERVED: Walrus_HumanMale_MasterSke.MasterSkeleton = Characters/Rigs/Humanoids/Walrus_HumanMale (ba601bce-6842-11e6-8f94-abfe6fb10024).',
                     'OBSERVED: Characters/NPC/Characters/Actor_Lightsaber_DarthVader AntAnimatableEntityData.MasterSkeletonAsset = Walrus_HumanMale_MasterSke.',
                     'OBSERVED: DarthVader_01 MeshProxyEntityData.BasePoseTransforms.Count = 248 and ClothAsset.RuntimeRigBoneCount = 248 = Walrus_HumanMale bone count.',
                     'OBSERVED: mesh SkinnedProceduralAnimation bone parents 8 (LeftShoulder) / 144 (RightShoulder); all weighted joints in range; rest-pose matrices agree within %.1e.' % bindings['body']['maxRestMatrixError'],
                     'CORROBORATION: median vertex-to-strongest-bone distance body %.3f m vs stormtrooper 0.172 m; cape bounding box equals ClothEntityData.PartBoundingBoxes.' % fits['body']['sections'][-2]['medianDistanceToStrongestBone']]},
    'blueprint': {**ebx('Characters_Hero_DarthVader_DarthVader_01_DarthVader_01'),
                  'basePoseOverride': {'boneIndex': bp['BasePoseTransforms']['Indices'][0], 'bone': bone_names[bp['BasePoseTransforms']['Indices'][0]],
                                       'transform': lt(bp['BasePoseTransforms']['Transforms'][0]), 'applied': False,
                                       'note': 'MeshProxyEntityData base-pose override of the camera bone; recorded, not baked (camera bone carries no skin weights).'}},
    'visualUnlock': {**ebx('Characters_Hero_DarthVader_DarthVader_01_VUR_DarthVader_01'), 'bundle': ebx('characters_hero_darthvader_darthvader_01_vur_darthvader_01_bpb'),
                     'meshVariationDatabase': ebx('characters_hero_darthvader_darthvader_01_vur_darthvader_01_bpb_MeshVariationDb_Win32'),
                     'parts': ['Characters/Hero/DarthVader/DarthVader_01/DarthVader_01', 'Characters/Hero/DarthVader/DarthVader_01/DarthVader_01_Cape'],
                     'rigScale': {'value': rig_scale['Value'], 'kind': rig_scale['__Id'], 'antGameState': rig_scale['GameState']['AssetGuid'], 'applied': False,
                                  'note': 'OBSERVED VUR RigScale writes ANT float game state 1.1. INFERENCE: native animation scales Vader\'s rig by 1.1 (bind mesh height 1.844 m -> ~2.03 m). Not baked; apply uniform 1.1 at the actor root if matching native size is wanted.'},
                     'visualAntGameStates': [{'kind': s['__Id'], 'antGameState': s['GameState']['AssetGuid'], 'value': s['Value']} for s in ant_states]},
    'specialization': {k: spec[k] for k in ('name', 'type', 'guid', 'sha1')},
    'cloth': {'blueprint': ebx('Characters_Hero_DarthVader_DarthVader_01_DarthVader_01_Cape'), 'clothAsset': ebx('Characters_Hero_DarthVader_DarthVader_01_Cloth_DarthVader_01_Cape_EACloth'),
              'clothWrapping': ebx('characters_hero_darthvader_darthvader_01_darthvader_01_cape_ClothWrappingAsset'),
              'clothAssetResource': clothasset['ClothAssetResource']['$resource'], 'runtimeRigBoneCount': clothasset['RuntimeRigBoneCount'],
              'windScale': cloth['WindScale'], 'wrapOnGPU': cloth['WrapOnGPU'], 'activationRadiusHigh': cloth['ActivationRadius']['High'],
              'partBoundingBox': {k: [cloth['PartBoundingBoxes'][0][k][c] for c in 'xyz'] for k in ('min', 'max')},
              'reproduced': False, 'browserTreatment': 'cape skinned only with its own source weights (18 joints, max 2 influences); EA cloth simulation and GPU wrapping not reproduced'},
    'proceduralBones': {'graph': ebx('Characters_Hero_DarthVader_DarthVader_01_DarthVader_01_RenderBones'), 'implemented': False,
                        'note': 'PROC_0/PROC_1 (shoulder pads) are rest-posed children of LeftShoulder/RightShoulder; the expression graph that drives them is recorded only.'},
    'materials': {'method': 'tools/materials plan-materials.py + apply-materials.py unchanged (exact split shader entry: CityHash64(MeshSet.NameHash, variation 0, LOD) + mesh primary GUID + LOD + section index), then tools/characters/vader-materials-post.py',
                  'crossCheck': {k: v for k, v in J(X / 'vader-materials/mvdb-crosscheck.json').items() if k != 'rows'} | {'materialsChecked': len(J(X / 'vader-materials/mvdb-crosscheck.json')['rows']), 'file': 'exports/characters/vader-materials/mvdb-crosscheck.json', 'meaning': 'Vader bundle MeshVariationDb_Win32 default-variation BaseColor/CS/Normal parameters vs exact shader-entry plan'},
                  'entries': materials, 'textureSizeCap': 1024, 'textureConversion': [{'source': t['source']['name'], 'role': t['role'], 'pixelFormat': t['pixelFormat'], 'originalSize': t['originalSize'], 'outputSize': t['outputSize'], 'notes': t['notes']} for t in conversion['textures']]},
    'saber': {'file': 'vader-saber.glb', 'hilt': saber['hilt'], 'attachment': saber['attachment'], 'blade': saber['blade'],
              'attachCheck': J(X / 'vader-saber/attach-check.json') if (X / 'vader-saber/attach-check.json').exists() else None,
              'bladeTemplateMesh': {'file': 'exports/characters/vader-saber/vader-saber-blade.glb', 'vertices': 145, 'triangles': 136,
                                    'note': 'source fx/meshes/weapon/meshp_lightsaber_planes_mesh is a parametric template (x,y in [-1,2], z in [0,1], UV-u region codes) expanded by the unrecovered EG_LightSaber_Generic vertex-shader fragment; not placed in vader-saber.glb.'},
              'sources': saber['sources']},
    'limitations': [
        'Unanimated: bind pose only. No Vader/lightsaber ANT clips decoded; trooper rifle clips bind by bone name but are not Vader animation.',
        'Wep_Root sits at the model origin in bind pose; the saber reaches the hand only through source animation. Corroborated with the separately decoded vader-animations.glb (idle/run-fwd/block-idle: mid-grip 0.057-0.067 m from RightHand, blade along hilt +Y); no extra hand offset is applied or invented.',
        'Rig scale 1.1 (VUR) not baked.',
        'Cape cloth simulation (EA cloth + GPU wrapping) not reproduced; cape is linearly skinned.',
        'Procedural shoulder bones (RenderBones expression graph) not driven.',
        'Browser GLB keeps four strongest influences per vertex (source has up to 4 here; discarded weight 0).',
        'Materials: partial PBR mapping like the troopers; AOSlice/WeatheringMask/NormalDetail/Smoothness masks, metallic channels and native shader graphs not reproduced; emissive factors are normalised source colours without absolute HDR intensity or blinking.',
        'Blade: metric length/width and the GPU blade geometry are not established; only emitter frame, direction, normalised BladeLength timing, HDR colour and tube light are source values.',
        'Tangents are generated by the viewer (validator MESH_PRIMITIVE_GENERATED_TANGENT_SPACE warnings), as for the troopers.'],
    'reproduction': 'tools/characters/VADER.md',
}
(WEB / 'vader.source.json').write_text(json.dumps(out, indent=1)); print(json.dumps({k: (v['vertices'], v['triangles'], v['validation']['errors']) for k, v in outputs.items()}))
