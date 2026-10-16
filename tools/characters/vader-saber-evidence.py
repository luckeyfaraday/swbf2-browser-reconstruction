"""Collect Vader lightsaber hilt-attachment and blade parameters from exported source EBX.

Reads only retained exports (exports/characters/vader-ebx/*, vader-converted skeleton,
vader-ebx/raw-emittergraph disassembly). Every value below is copied from source data;
hash-to-name resolution is a verified FNV-1 (Frostbite 5381/33 variant) match, and
anything unresolved stays as its raw hash.

Usage (workspace root): python tools/characters/vader-saber-evidence.py
Output: exports/characters/vader-saber/saber-evidence.json
"""
import json, pathlib, glob
root = pathlib.Path(__file__).resolve().parents[2]
E1 = root / 'exports/characters/vader-ebx/d1/ebx'; E2 = root / 'exports/characters/vader-ebx/d2/ebx'


def fnv(s, h=5381):
    for c in s.encode():
        h = ((h * 33) & 0xFFFFFFFF) ^ c
    return h


def signed(h):
    return h - (1 << 32) if h >= 1 << 31 else h


def load(directory, prefix):
    files = glob.glob(str(directory / (prefix + '__*.json')))
    assert len(files) == 1, prefix
    return json.loads(pathlib.Path(files[0]).read_text())


def entry(doc):
    e = doc['entry']; return {'name': e['name'], 'type': e['type'], 'guid': e['guid'], 'sha1': e['sha1']}


def vec(v):
    return [v[k] for k in ('x', 'y', 'z', 'w') if k in v] if isinstance(v, dict) else v


def lt(t):
    return {k: vec(t[k]) for k in ('right', 'up', 'forward', 'trans')}


def objs(doc):
    return doc['asset']['objects']


# Names verified by recomputing the hash (dictionary search; see VADER.md).
RESOLVED = {n: signed(fnv(n)) for n in ['direction1', 'direction2', 'offset2', 'LightsaberColor0', 'LightSaberColor0', 'LightSaberColor1']}
FIELD_NAMES = ['BladeLength', 'BladeOnOff', 'LightSaberHiltVisible', 'LightSaberTransform', 'IsLocalPlayer', 'AttachToAnimatable',
               'EmitterParameter1', 'EmitterParameter2', 'EmitterParameter3', 'X', 'Y', 'Z']
FIELD = {fnv(n): n for n in FIELD_NAMES}

red = load(E1, 'FX_Weapons_LightSabers_FX_LightSaber_DarthVader_Red'); mesh_fx = load(E1, 'FX_Weapons_LightSabers_FX_LightSaber_DarthVader_Mesh')
eg = load(E1, 'FX_Weapons_LightSabers_Emitters_EG_LightSaber_Generic'); em = load(E1, 'fx_weapons_lightsabers_emitters_em_lightsaber_darthvader_meshp_3p')
pf_fx = load(E1, 'Gameplay_Equipment_Heroes_PF_Lightsaber_FX_Vader'); pf_ls = load(E1, 'Gameplay_Kits_Hero_DarthVader_Prefabs_PF_Lightsaber_DarthVader')
ctrl = load(E2, 'FX_Prefabs_PF_LightSaber_Controllable_Common'); params_list = load(E2, 'Globals_Effects_GlobalEffectParameterList')
planes = load(E1, 'fx_meshes_weapon_meshp_lightsaber_planes_mesh'); hilt = load(E1, 'gameplay_equipment_heroes_lightsaberdarthvader_lightsaberdarthvader_meshp_mesh')
skel = json.loads((root / 'exports/characters/vader-converted/vader-body.skeleton.ebx.json').read_text())

by_id = lambda doc: {o.get('$id'): o for o in objs(doc)}
red_objs = objs(red)
graph = next(o for o in red_objs if o['__Id'] == 'EmitterGraphEntityData')
tube = next(o for o in red_objs if o['__Id'] == 'PbrTubeLightEntityData'); light_fx = next(o for o in red_objs if o['__Id'] == 'LightEffectEntityData')
eg_root = objs(eg)[0]; defaults = {p['PropertyId']: vec(p['Value']) for p in eg_root['EmitterGraphParams']}
lookup = [p['FieldPropertyId'] for p in graph['PropertyIdLookupTable']]
names = {v: k for k, v in RESOLVED.items()}
params = []
for p in graph['EmitterGraphParams']:
    pid = p['PropertyId']
    params.append({'propertyId': pid, 'name': names.get(pid), 'nameBasis': 'FNV-1 hash match' if pid in names else 'unresolved hash',
                   'vaderValue': vec(p['Value']), 'genericDefault': defaults.get(pid), 'inPropertyIdLookupTable': pid in lookup,
                   'lookupIndex': lookup.index(pid) if pid in lookup else None})
for pid in lookup:
    if pid not in [p['propertyId'] for p in params]:
        params.append({'propertyId': pid, 'name': names.get(pid), 'nameBasis': 'FNV-1 hash match' if pid in names else 'unresolved hash',
                       'vaderValue': None, 'genericDefault': defaults.get(pid), 'inPropertyIdLookupTable': True, 'lookupIndex': lookup.index(pid)})
plist = by_id(params_list)
effect_params = [{'index': i, 'name': plist[p['classGuid']]['Name']} for i, p in enumerate(eg_root['EffectParams'])]

# Attachment: every WSVFX in PF_Lightsaber_FX_Vader attaches to the animatable through AnimatableAttachData.
fx_objs = by_id(pf_fx); fx_root = objs(pf_fx)[0]
attach = []
for o in objs(pf_fx):
    if o.get('__Id') == 'WSVFXEntityData':
        a = fx_objs[o['Attach']['$ref']]
        attach.append({'effect': o['Effect']['name'], 'bone': a['Bone']['name'], 'boneEnumValue': a['Bone']['value'], 'linkName': a['LinkName'],
                       'propertyName': a['PropertyName'], 'useRotation': a['UseRotation'], 'rawTransformEffectLocation': lt(o['RawTransformEffectLocation']),
                       'effectParameters': [plist[p['classGuid']]['Name'] for p in o.get('EffectParameters', [])]})
attach_offset_hash = fnv('AttachOffset')
attach_offset_connected = any(int(pc.get('TargetField', '0x0'), 16) == attach_offset_hash for pc in fx_root.get('PropertyConnections', []))
connections = []
for pc in fx_root.get('PropertyConnections', []):
    s, t = int(pc['SourceField'], 16), int(pc['TargetField'], 16)
    if s in FIELD or t in FIELD:
        src, tgt = fx_objs.get(pc['Source'].get('$ref'), {}), fx_objs.get(pc['Target'].get('$ref'), {})
        connections.append({'source': src.get('__Id'), 'sourceField': FIELD.get(s, pc['SourceField']), 'target': (tgt.get('Effect') or tgt.get('Blueprint') or {}).get('name', tgt.get('__Id')), 'targetField': FIELD.get(t, pc['TargetField'])})
interface = next(o for o in objs(pf_fx) if o.get('__Id') == 'InterfaceDescriptorData')
interface_values = [{'field': FIELD.get(int(f['Name'], 16), f['Name']), 'value': f.get('Value')} for f in interface['Fields'] if f.get('Value')]
ls_ref = next(o for o in objs(pf_ls) if o.get('__Id') == 'LogicPrefabReferenceObjectData' and o['Blueprint']['name'] == 'Gameplay/Equipment/Heroes/PF_Lightsaber_FX_Vader')

c_objs = by_id(ctrl)
interp = next(o for o in objs(ctrl) if o['__Id'] == 'FloatInterpolatorEntityData'); conds = [o for o in objs(ctrl) if o['__Id'] == 'ConditionalFloatEntityData']
sk = objs(skel)[0]; gb = sk['GameplayBonesToSkeleton']; bone_names = sk['BoneNames']
weapon_enum = attach[0]['boneEnumValue']; weapon_bone = gb[weapon_enum]
em_t = objs(em)[1]; mesh_emitter = next(o for o in objs(mesh_fx) if o['__Id'] == 'EmitterEntityData')

out = {
    'evidenceId': 'VADER-SABER-EVIDENCE-001',
    'sources': [entry(d) for d in (red, mesh_fx, eg, em, pf_fx, pf_ls, ctrl, params_list, planes, hilt, skel)],
    'hilt': {
        'mesh': hilt['entry']['name'], 'renderedBy': 'mesh particle emitter ' + em['entry']['name'],
        'emitter': {k: (em_t.get(k) or {}).get('name') if isinstance(em_t.get(k), dict) else em_t.get(k) for k in ('EmittableType', 'EmittableAlignment', 'LocalSpace', 'FollowSpawnSource', 'MaxCount')},
        'emitterOrientToPosition': vec(em_t['OrientToPosition']),
        'emitterProcessors': ['UpdateAgeData', 'SpawnRateData'], 'emitterEntityTransform': lt(mesh_emitter['Transform']),
        'effect': mesh_fx['entry']['name'],
    },
    'attachment': {
        'gameplayBone': attach[0]['bone'], 'gameplayBoneEnumValue': weapon_enum,
        'skeletonBoneIndex': weapon_bone, 'skeletonBoneName': bone_names[weapon_bone], 'skeletonBoneParent': bone_names[sk['Hierarchy'][weapon_bone]],
        'mappingBasis': 'Walrus_HumanMale SkeletonAsset.GameplayBonesToSkeleton[GameplayBones_WeaponBone=6]',
        'attachOffsetPropertyConnected': attach_offset_connected,
        'offset': {'translation': [0, 0, 0], 'rotation': [0, 0, 0, 1],
                   'basis': 'AnimatableAttachData has no Offset/CoordinateSpace; AttachOffset property unconnected; RawTransformEffectLocation, emitter-entity transform and PF_Lightsaber_DarthVader->PF_Lightsaber_FX_Vader BlueprintTransform are identity (emitter transform within 1e-6).'},
        'prefabReferenceTransform': lt(ls_ref['BlueprintTransform']),
        'perEffect': attach,
    },
    'blade': {
        'effect': red['entry']['name'], 'emitterGraph': eg['entry']['name'], 'templateMesh': planes['entry']['name'],
        'emitterTransformInHiltSpace': lt(graph['Transform']),
        'direction': 'emitter forward (local +Z) = hilt/effect +Y',
        'emitterGraphParams': params, 'effectParams': effect_params,
        'lengthModel': {
            'observation': 'spawn and simulate compute shaders store emitterTransform forward axis (normalised) * max(effectParams[0].x, 1e-5) as the particle length vector',
            'effectParams0': effect_params[0]['name'],
            'drivenBy': 'PF_LightSaber_Controllable_Common BladeLength (FloatInterpolator) -> EmitterParameter2',
            'bladeLengthOn': next(c['ValueIfTrue'] for c in conds if c.get('ValueIfTrue') == 1),
            'bladeLengthOff': 0.0,
            'igniteSeconds': float(next(v['value'] for v in interface_values if v['field'] == '0x255054e2').split()[-1]),
            'igniteSecondsBasis': 'PF_Lightsaber_FX_Vader interface 0x255054e2 -> Controllable_Common ConditionalFloat(ValueIfTrue) -> FloatInterpolator.Duration',
            'retractSeconds': float(next(v['value'] for v in interface_values if v['field'] == '0x46fda363').split()[-1]),
            'simulateShaderNote': 'simulate shader also reads emitterGraphParams[4].z and [7].xy (PropertyIdLookupTable order) for trail/age handling; not reproduced',
            'interpolation': {'mode': interp['InterpolationMode']['name'], 'type': interp['InterpolationType']['name']},
            'metricLength': None,
            'metricLengthLimitation': 'BladeLength is a normalised 0..1 extension; the mesh vertex-shader fragment (EG_LightSaber_Generic_GraphEmVSF) that maps the template mesh to world size is not recovered, so the absolute blade length is not established.',
        },
        'colorHdr': next(p['vaderValue'] for p in params if p['name'] == 'LightSaberColor1'),
        'tubeLight': {'type': 'PbrTubeLightEntityData', 'color': vec(tube['Color']), 'intensity': tube['Intensity'], 'lightUnit': tube['LightUnit']['name'],
                      'tubeWidth': tube['TubeWidth'], 'attenuationRadius': tube['AttenuationRadius'], 'isCapsule': tube['IsCapsule'],
                      'effectTransformInHiltSpace': lt(light_fx['Transform']), 'effectTubeWidth': light_fx['TubeWidth'],
                      'randomIntensity': [light_fx['RandomIntensityMin'], light_fx['RandomIntensityMax']]},
        'interfaceValues': interface_values,
        'propertyConnections': connections,
    },
}
dest = root / 'exports/characters/vader-saber/saber-evidence.json'; dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps(out, indent=1)); print(json.dumps({'attach': out['attachment']['skeletonBoneName'], 'color': out['blade']['colorHdr'], 'params': len(params)}))
