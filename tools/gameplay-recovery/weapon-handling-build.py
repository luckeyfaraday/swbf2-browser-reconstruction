"""Recover selected rifle handling configuration; do not simulate native equations."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tools/gameplay-recovery'


def load(pattern):
    matches = list(ROOT.glob(pattern))
    assert len(matches) == 1, (pattern, len(matches))
    path = matches[0]
    raw = path.read_bytes()
    doc = json.loads(raw.decode('utf-8-sig'))
    assert not doc['asset']['errors'], path
    doc['source'] = {'file': path.relative_to(ROOT).as_posix(),
                     'name': doc['entry']['name'], 'guid': doc['entry']['guid'],
                     'sha1': doc['entry']['sha1'],
                     'jsonSha256': hashlib.sha256(raw).hexdigest()}
    return doc


def object_in(doc, identifier):
    objects = [(i, o) for i, o in enumerate(doc['asset']['objects'])
               if o['$id'] == identifier or o['$type'] == 'FrostySdk.Ebx.' + identifier]
    assert len(objects) == 1, (doc['entry']['name'], identifier)
    return objects[0]


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()
                if k not in ['$type', '$id', '__Id', '__InstanceGuid']}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def recover():
    observations, links = [], []

    def observe(doc, identifier, *fields):
        index, obj = object_in(doc, identifier)
        value = obj
        for key in fields:
            value = value[key]
        record = {'source': doc['source'], 'objectId': obj['$id'],
                  'jsonPointer': '/asset/objects/' + str(index) + ''.join('/' + str(k) for k in fields),
                  'value': value, 'evidenceType': 'decoded-installed-EBX-field', 'runtimeObserved': False}
        observations.append(record)
        return value

    def external(doc, identifier, fields, target, target_identifier):
        ref = observe(doc, identifier, *fields)
        _, obj = object_in(target, target_identifier)
        assert ref['$external'] == target['entry']['guid'] and ref['classGuid'] == obj['$id']
        links.append(observations[-1])
        return obj['$id']

    def internal(doc, identifier, *fields):
        ref = observe(doc, identifier, *fields)
        object_in(doc, ref['$ref'])
        links.append(observations[-1])
        return ref['$ref']

    def fields(doc, identifier, names):
        return {name: clean(observe(doc, identifier, name)) for name in names}

    sway = load('tools/gameplay-recovery/detail/ebx/*WeaponSway_Default_Rifle__*.json')
    aim = load('tools/gameplay-recovery/detail/ebx/*AimingController_Default_Short_ZoomOverlay__*.json')
    camera = load('tools/gameplay-recovery/detail/ebx/*DefaultFirstPersonCamera__*.json')
    zooms = [load('tools/gameplay-recovery/state/ebx/*ZoomLevel_0_Default__*.json'),
             load('tools/gameplay-recovery/state/ebx/*ZoomLevel_1_Default_Short_UseZoomMesh__*.json')]
    transition = load('exports/weapon-handling-support/ebx/*FOVTransition_Default__*.json')
    sensitivity = load('exports/weapon-handling-support/ebx/*ZoomedSensitivity__*.json')
    modifier = load('exports/weapon-handling-support/ebx/*WeaponSway_Specials_Splice__*.json')
    weapons = []
    for weapon_id, name, weapon_pattern, firing_pattern, unlock_pattern in [
        ('primary', 'E-11', 'tools/gameplay-recovery/e11-root/ebx/*W_BlasterRifle_E11__*.json',
         'tools/gameplay-recovery/core/ebx/*WeaponFiring_Default_BlasterRifle__*.json',
         'tools/gameplay-recovery/state/ebx/*U_BlasterRifle_E11__*.json'),
        ('rebel-a280', 'A280', 'exports/faction-rebel-weapon/ebx/*W_BlasterRifle_A280__*.json',
         'exports/faction-rebel-detail/ebx/*WeaponFiring_Default_BlasterRifle_A280__*.json',
         'exports/faction-rebel-weapon/ebx/*U_BlasterRifle_A280__*.json'),
    ]:
        weapon, firing, unlock = load(weapon_pattern), load(firing_pattern), load(unlock_pattern)
        external(unlock, unlock['asset']['root'], ['NonStreamedBlueprint'], weapon, weapon['asset']['root'])
        external(weapon, 'SoldierWeaponData', ['WeaponFiring'], firing, 'WeaponFiringData')
        external(weapon, 'SoldierWeaponData', ['AimingController'], aim, 'SoldierAimingSimulationData')
        external(weapon, 'SoldierWeaponData', ['FirstPersonCamera'], camera, 'FirstPersonCameraData')
        external(firing, 'WeaponFiringData', ['WeaponSway'], sway, 'GunSwayData')
        primary = internal(firing, 'WeaponFiringData', 'PrimaryFire')
        weapon_zooms = []
        for i in range(2):
            zoom_id = internal(weapon, 'SoldierWeaponData', 'ZoomLevels', i)
            weapon_zooms.append({'sourceObjectId': zoom_id, **fields(weapon, zoom_id, [
                'AnimationSettings', 'RenderFov', 'RenderFovTransition',
                'ZoomDisabledTransitionTimer', 'ZoomInOutMeshTransitionFactors', 'SightType'])})
        weapons.append({'weaponId': weapon_id, 'name': name,
                        'source': weapon['source'], 'unlockSource': unlock['source'],
                        'swaySourceGuid': sway['entry']['guid'], 'aimingSourceGuid': aim['entry']['guid'],
                        'weaponZoomLevels': weapon_zooms,
                        'legacyWeaponDispersion': clean(observe(firing, primary, 'WeaponDispersion')),
                        'UseAutoAiming': observe(firing, 'WeaponFiringData', 'UseAutoAiming'),
                        'SkipFirstZoomLevel': observe(weapon, 'SoldierWeaponData', 'SkipFirstZoomLevel'),
                        'zoomFireGuards': fields(weapon, 'BlasterWeaponData', [
                            'BlockFireWhenNotZoomed', 'BlockFireWhenZoomed', 'DisableZoomOnOverheat']),
                        'weaponModifiers': clean(observe(weapon, 'SoldierWeaponData', 'WeaponModifierData'))})

    sway_config = fields(sway, 'GunSwayData', ['Stand', 'Crouch', 'Prone', 'Dispersion', 'Recoil',
        'StanceTransitionDispersion', 'StandToCrouch', 'StandToProne', 'CrouchToStand',
        'CrouchToProne', 'ProneToStand', 'ProneToCrouch', 'PowerOfDispersionRandom',
        'FirstShotNoZoomDispersionMultiplier', 'FirstShotZoomDispersionMultiplier',
        'FirstShotRecoilMultiplier', 'ShootingRecoilDecreaseScale', 'CameraRecoilWhenZoomed',
        'MinimumPowerRequiredToFire', 'ModifierUnlocks', 'SuppressionModifierUnzoomed',
        'SuppressionModifierZoomed', 'SuppressionDispersionModifiers', 'SuppressionRecoilModifiers'])
    recoil_id = internal(sway, 'GunSwayData', 'CameraRecoil')
    camera_recoil = fields(sway, recoil_id, ['SpringConstant', 'SpringDamping', 'SpringMinThresholdAngle'])
    modifier_ref = sway_config['ModifierUnlocks'][0]
    # Keep the explicit unlock condition: this referenced modifier is not universal.
    modifier_key = next(k for k, v in modifier_ref.items() if isinstance(v, dict) and '$external' in v)
    external(sway, 'GunSwayData', ['ModifierUnlocks', 0, modifier_key], modifier, 'GunSwayModifierData')
    modifier_config = fields(modifier, 'GunSwayModifierData', ['StandNoZoomModifier', 'StandZoomModifier',
        'CrouchNoZoomModifier', 'CrouchZoomModifier', 'ProneNoZoomModifier', 'ProneZoomModifier',
        'DynamicUpdateEnabled', 'OnlyInSupportedShooting', 'OnlyOnWeaponLightEnabled'])
    alias_checks = []
    for stance_index, stance in enumerate(['Stand', 'Crouch', 'Prone']):
        for zoom_index, zoom in enumerate(['NoZoom', 'Zoom']):
            for motion_index, motion in enumerate(['BaseValue', 'Moving', 'Jumping', 'Sprinting']):
                index = stance_index * 8 + zoom_index * 4 + motion_index
                # Prone's named data omits jump/sprint, while the raw array retains them.
                if motion not in sway_config[stance][zoom]:
                    continue
                assert sway_config[stance][zoom][motion] == sway_config['Dispersion'][index]
                alias_checks.append({'namedPath': [stance, zoom, motion], 'arrayPath': ['Dispersion', index]})
            index = stance_index * 2 + zoom_index
            assert sway_config[stance][zoom]['Recoil'] == sway_config['Recoil'][index]
            alias_checks.append({'namedPath': [stance, zoom, 'Recoil'], 'arrayPath': ['Recoil', index]})

    aim_config = fields(aim, 'SoldierAimingSimulationData', ['StandPose', 'CrouchPose', 'PronePose',
        'UpdateCameraFOV', 'Force1pOnZoom', 'FovDelayTime', 'FovTransitionTime',
        'ZoomTransitionTime', 'ZoomTransitionTimeArray', 'ReturnToZoomAfterReload', 'IgnoreZoomToggle'])
    gameplay_zooms = []
    for index, zoom in enumerate(zooms):
        target_id = external(aim, 'SoldierAimingSimulationData', ['ZoomLevels', index], zoom,
                             '27dbe243-af15-4e52-983d-713ba0f62890' if index == 0 else '0aaf9d35-22b2-6641-cd87-6e0da6cd8191')
        external(zoom, target_id, ['FieldOfViewTransition'], transition, 'FOVTransitionData')
        gameplay_zooms.append(fields(zoom, target_id, ['FieldOfView', 'FieldOfViewSP',
            'AllowFieldOfViewScaling', 'FieldOfViewTransition', 'UseWeaponMeshZoom1p',
            'RecoilMultiplier', 'RecoilFovMultiplier', 'CameraImpulseMultiplier',
            'DispersionMultiplier', 'DispersionRotation', 'MoveSpeedMultiplier',
            'LookSpeedMultiplier', 'LookSpeedSensitivityProfileOption']))
    external(zooms[1], 'ZoomLevelData', ['LookSpeedSensitivityProfileOption'], sensitivity, 'ProfileOptionDataFloat')
    configuration = {'swaySource': sway['source'], 'sway': sway_config, 'cameraRecoil': camera_recoil,
        'aimingSource': aim['source'], 'aiming': aim_config, 'gameplayZoomLevels': gameplay_zooms,
        'firstPersonCamera': fields(camera, 'FirstPersonCameraData', ['Offset', 'Rotation']),
        'fovTransition': fields(transition, 'FOVTransitionData', ['TransitionType', 'Shape', 'Invert', 'StartDelay', 'StartJump', 'EndEarly']),
        'zoomSensitivityProfile': fields(sensitivity, 'ProfileOptionDataFloat', ['Value', 'Min', 'Max', 'Step', 'UniqueId', 'LocalPlayerSpecific']),
        'conditionalModifier': {'condition': clean(modifier_ref), 'source': modifier['source'], 'configuration': modifier_config}}

    sdk_path = ROOT / 'tools/bf2-extract/work/Profiles/StarWarsIISDK.dll'
    getters = {}
    for name in ['Stand', 'Crouch', 'Prone', 'Dispersion', 'Recoil']:
        getters[name] = subprocess.check_output([str(ROOT / 'tools/bf2-extract/CecilInspect.exe'),
            str(sdk_path), 'FrostySdk.Ebx.GunSwayData', 'get_' + name], text=True).strip()
        assert '::_' + name in getters[name] and 'get_Item' not in getters[name]
    sdk_evidence = {'file': sdk_path.relative_to(ROOT).as_posix(),
                    'sha256': hashlib.sha256(sdk_path.read_bytes()).hexdigest(), 'getters': getters,
                    'evidenceType': 'retained-tool-SDK-IL-not-native-game-code',
                    'conclusion': 'Named stances and arrays are separate backing fields, not computed property aliases. Equal values do not establish native precedence.'}
    unresolved = [
        'The selected GunSway native path reads flattened Dispersion/Recoil arrays; see BF2-WEAPON-HANDLING-NATIVE-001. Whole-weapon legacy WeaponDispersion combination outside that path remains unmeasured. Zero legacy angles do not establish zero effective spread.',
        'Native degree conversion, polar power sampling, movement interpolation and spread increment/recovery/clamping are recovered in the native evidence. Browser mapping of actor states, first-shot guard, recovery-suppression flag, native random seeding and full pose-transition/suppression/modifier evaluation remain incomplete.',
        'CameraRecoil SpringConstant3000 and SpringDamping0.84 are configuration, not a recovered differential equation or timestep. Do not directly use them as browser interpolation rates.',
        'Gameplay FOV55/23.9 and weapon RenderFov55/55 are separate referenced fields. FOV axis, user/aspect scaling, exact transition Shape2 function and native camera/render precedence remain unknown.',
        'Weapon animation offsets/kickback, decoded additive firing clips, CameraJoint/CameraBase, FirstPersonCamera offset and gameplay eye transform have unresolved native composition order. Applying all fields together can double-transform the weapon.',
        'WeaponSway_Specials_Splice is explicitly conditional on unlock6acdd7f7-ed2f-4887-a1a8-db5ba8eec151. Its activation and dynamic overrides are not observed; its .3 recoil magnitude and .5 first-shot modifier must not be applied unconditionally.',
        'ZoomedSensitivity source default1 is recovered. User profile value and its runtime combination with LookSpeedMultiplier are not read or measured.',
    ]
    return {'schemaVersion': 1, 'evidenceId': 'BF2-WEAPON-HANDLING-001', 'runtimeObserved': False,
            'scope': 'Selected original-era Assault E11/A280 blueprints and their exact shared sway/aim/camera references; installed patched head1930263.',
            'selectionEvidence': 'tools/gameplay-recovery/faction-weapons-evidence.json',
            'weapons': weapons, 'configuration': configuration, 'observations': observations,
            'referenceChain': links, 'namedArrayEqualities': alias_checks, 'sdkEvidence': sdk_evidence,
            'observed': [
                'Both selected rifle firing configurations reference the identical GunSwayData object06baedb9-ddea-408a-a4ca-6f41773d9beb in asset959d8b88-5a31-434a-aab8-30b7047024a0.',
                'Stand NoZoom base dispersion is .05.. .7 with .08 increase/shot; Moving minimum.1. Zoom base/moving is0.. .5 with .05 increase/shot. Named fields equal corresponding raw array records.',
                'Standing NoZoom recoil increment.7 and horizontal range[-.5,.5]; Zoom increment.55 and horizontal range[-.3,.3]. CameraRecoilWhenZoomed=true.',
                'A280 ordered weapon zoom index0 references internal18 (kickback.8,offset .207/.33/-.189); index1 references internal17 (kickback.5,offset0). E11 ordered internal19/20 both kickback1 and offset0.',
                'Shared gameplay FOV55/23.9, weapon RenderFov55/55, source smooth FOVTransition Shape2, aim FovTransitionTime.2 and ZoomTransitionTime.2 are independently selected.',
            ],
            'inferences': [
                'The optional browser selector maps caller pose/movement/aiming to matching named configuration fields. It does not determine native input-state thresholds or native field precedence.',
                'Default gameplay zoom indices0/1 are exposed as hip/aim for the browser. Both weapon SkipFirstZoomLevel values are false, but native transition state-machine behavior is not recovered.',
            ], 'unresolved': unresolved}


if __name__ == '__main__':
    report = recover()
    (OUT / 'weapon-handling-evidence.json').write_text(json.dumps(report, indent=2) + '\n')
    runtime = {k: report[k] for k in ['schemaVersion', 'weapons', 'configuration']}
    runtime['provenance'] = {k: report[k] for k in ['evidenceId', 'runtimeObserved', 'scope', 'selectionEvidence', 'inferences', 'unresolved']}
    runtime['provenance']['evidenceFile'] = 'tools/gameplay-recovery/weapon-handling-evidence.json'
    runtime['provenance']['nativeEvidenceId'] = 'BF2-WEAPON-HANDLING-NATIVE-001'
    runtime['provenance']['nativeEvidenceFile'] = 'tools/gameplay-recovery/weapon-handling-native-evidence.json'
    (ROOT / 'web/public/assets/weapon-handling.json').write_text(json.dumps(runtime, indent=2) + '\n')
    print(json.dumps({'evidenceId': report['evidenceId'], 'observations': len(report['observations']),
                      'links': len(report['referenceChain']), 'namedArrayEqualities': len(report['namedArrayEqualities'])}))
