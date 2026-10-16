"""Retain auditable source references for selected first-person faction assets."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
documents = {}
patterns = [
    'exports/firstperson-roots/ebx/*.json', 'exports/firstperson-bundles/ebx/*.json',
    'exports/firstperson-geometry/*.ebx.json',
    'exports/characters/rebel-unlock/ebx/*MPVUR_L_Assault_Orig_DS_01__*.json',
    'exports/faction-rebel-weapon/ebx/*U_BlasterRifle_A280__*.json',
    'tools/gameplay-recovery/state/ebx/*U_BlasterRifle_E11__*.json',
    'exports/faction-rebel-kit/ebx/*.json',
    'tools/gameplay-recovery/detail/ebx/*Kit_D_Assault_Orig_DS__*.json',
]
for pattern in patterns:
    for path in ROOT.glob(pattern):
        doc = json.loads(path.read_text(encoding='utf-8-sig'))
        if 'entry' not in doc:
            continue
        assert not doc['asset']['errors']
        documents[doc['entry']['name'].lower()] = (path, doc)

observations = []
used = {}


def observe(name, index, field):
    path, doc = documents[name.lower()]
    used[name.lower()] = {
        'file': path.relative_to(ROOT).as_posix(), 'name': doc['entry']['name'],
        'guid': doc['entry']['guid'], 'sourceSha1': doc['entry']['sha1'],
        'jsonSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    value = doc['asset']['objects'][index]
    for part in field.split('/'):
        value = value[int(part)] if isinstance(value, list) else value[part]
    observations.append({'file': path.relative_to(ROOT).as_posix(),
                         'jsonPointer': f'/asset/objects/{index}/{field}', 'value': value})
    return value


def follow(name, index, field):
    ref = observe(name, index, field)
    target = documents[ref['name'].lower()][1]
    assert ref['$external'] == target['entry']['guid']
    assert ref['classGuid'] == target['asset']['root']
    observe(ref['name'], 0, 'Name')
    return ref['name']


models = []
for weapon, team, weapon_id in [('E11', 1, 'primary'), ('A280', 0, 'rebel-a280')]:
    unlock = f'Gameplay/Equipment/Rifles/{weapon}/U_BlasterRifle_{weapon}'
    bundle = 'Win32/' + observe(unlock, 0, 'Weapon1pBlueprintBundleReference/Name')
    mesh = follow(bundle, 2, 'WeaponMesh1p/0/Mesh')
    zoom = follow(bundle, 2, 'WeaponMesh1p/0/MeshZoom')
    assert mesh == zoom
    skin_path = (ROOT / 'exports/characters/converted/e11.skin.json' if weapon == 'E11'
                 else ROOT / 'exports/firstperson-geometry/firstperson-a280.skin.json')
    skin = json.loads(skin_path.read_text())
    assert skin['source'].lower() == mesh.lower()
    assembly = json.loads((ROOT / f'exports/firstperson-animation/{weapon.lower()}-assembly.json').read_text())
    validate = json.loads((ROOT / f'exports/firstperson-{weapon.lower()}-validation.json').read_text())
    assert validate['issues']['numErrors'] == 0
    url = f'firstperson/firstperson-{weapon.lower()}.glb'
    models.append({
        'weaponId': weapon_id, 'team': team, 'name': weapon, 'url': url,
        'scale': 1, 'position': [0, 0, 0], 'rotation': [0, 0, 0],
        'clips': {'idle': 'idle', 'sprint': 'sprint'}, 'sourcePoseDuration': 0, 'playbackDuration': 1,
        'sourceMesh': mesh, 'sourceMeshGuid': skin['sourceGuid'], 'sourceWeaponVertexCount': skin['vertexCount'],
        'muzzleBoneName': 'Wep_Muzzle',
        'idleCameraSpaceMuzzle': assembly['idleCameraSpaceBones']['Wep_Muzzle'][-1]['position'],
        'sha256': hashlib.sha256((ROOT / 'web/public/assets' / url).read_bytes()).hexdigest(),
        'validationErrors': 0, 'validationWarnings': validate['issues']['numWarnings'],
    })

for faction, kit_name, appearance in [
    ('imperial', 'Gameplay/Kits/MP/Assault/Kit_D_Assault_Orig_DS',
     'Characters/Dark/D_Assault_Orig/D_Assault_Orig_01/MPVUR_D_Assault_Orig_01'),
    ('rebel', 'Gameplay/Kits/MP/Assault/Kit_L_Assault_Orig_DS',
     'Characters/Light/L_Assault_Orig/L_Assault_Orig_DS_01/MPVUR_L_Assault_Orig_DS_01'),
]:
    kit = documents[kit_name.lower()][1]
    # Kits contain the selected root appearance as an explicit external ref.
    appearances = []
    for index, obj in enumerate(kit['asset']['objects']):
        if 'Appearances' in obj:
            appearances = observe(kit_name, index, 'Appearances')
    assert any(v.get('$external') == documents[appearance.lower()][1]['entry']['guid'] for v in appearances)
    observe(appearance, 0, 'DefaultSkin')
    bundle = observe(appearance, 0, 'FirstPersonBundles/0/Name')
    bundle_doc = documents[bundle.lower()][1]
    for index, obj in enumerate(bundle_doc['asset']['objects']):
        if obj['$type'].endswith('.VisualUnlockPartAsset'):
            assert observe(bundle, index, 'RenderIn1p') is True
            wrapper = follow(bundle, index, 'OutObjectBlueprint')
            mesh = observe(wrapper, 1, 'Mesh')
            if 'lowerbody' not in mesh['name'].lower():
                follow(wrapper, 1, 'Mesh')

camera_asset = 'Gameplay/Equipment/Shared/DefaultFirstPersonCamera'
camera_offset = observe(camera_asset, 1, 'Offset')
camera_rotation = observe(camera_asset, 1, 'Rotation')
poses = json.loads((ROOT / 'exports/firstperson-animation/poses.json').read_text())
limitations = [
    'Native rendering/camera/blend graph execution is unobserved; these are retained source asset/config observations.',
    'The glTF models use inverse source idle CameraJoint with a +Z-source to -Z-renderer conversion. The native composition of DefaultFirstPersonCamera.Offset remains unresolved and is not silently added.',
    'Cross-mesh Wep_Root parent attachment follows the observed first-person humanoid hierarchy and identical DOFs; native binding execution is inferred.',
    'Idle and sprint are exact single-frame poses. One-second constant glTF tracks are playback packaging, not a measured native animation duration.',
    'Two unmapped Vec3 DOFs contain [1,1,1]; all 140 named pose channels are retained. DCT fire/deploy/zoom and procedural blend/IK remain unsupported.',
    'Four-weight skin conversion discards up to 0.0901961 weight on some first-person hand vertices. All original eight-weight data remain in retained skin exports.',
    'Materials use recovered source textures with partial PBR translation; scope lenses remain neutral, and tangent reconstruction is renderer-dependent.',
]
evidence = {
    'evidenceId': 'BF2-FIRSTPERSON-ASSETS-001', 'runtimeObserved': False,
    'sourceDocuments': list(used.values()), 'observations': observations,
    'firstpersonSkeleton': 'Characters/Rigs/Humanoids/Walrus_HumanMale_1p',
    'sourceAnimationRig': poses['sourceRig'], 'sourceAnimationBankSha256': poses['sourceSha256'],
    'sourceClips': [{k: c[k] for k in ['sourceName', 'sourceAnimationKey', 'sourceByteRange',
                                    'rawCounts', 'unmapped', 'maxQuaternionNormError']} for c in poses['clips']],
    'models': models, 'limitations': limitations,
}
evidence['sourceSkinFiles'] = []
for path in [*ROOT.glob('exports/firstperson-geometry/*.skin.json'), ROOT / 'exports/characters/converted/e11.skin.json']:
    skin = json.loads(path.read_text())
    evidence['sourceSkinFiles'].append({
        'file': path.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'source': skin['source'], 'sourceGuid': skin['sourceGuid'], 'sourceSha1': skin['sourceSha1'],
        'resourceId': skin['resourceId'], 'chunkGuid': skin['chunkGuid'], 'skeleton': skin['skeleton'],
        'vertexCount': skin['vertexCount'], 'boneCount': len(skin['bones']), 'lod': skin['lod'],
    })
evidence_path = ROOT / 'tools/characters/firstperson-evidence.json'
evidence_path.write_text(json.dumps(evidence, indent=2))
manifest = {
    'schemaVersion': 1, 'models': models,
    'provenance': {'evidenceId': evidence['evidenceId'], 'poseEvidenceId': poses['evidenceId'],
                   'runtimeObserved': False, 'sourceRig': poses['sourceRig'],
                   'sourceAnimationBankSha256': poses['sourceSha256'],
                   'observedCameraConfig': {'offset': camera_offset, 'rotation': camera_rotation},
                   'limitations': limitations},
}
manifest_path = ROOT / 'web/public/assets/firstperson-weapons.json'
manifest_path.write_text(json.dumps(manifest, indent=2))
print(json.dumps({'manifest': str(manifest_path), 'sourceDocuments': len(used),
                  'observations': len(observations), 'models': models}, indent=2))
