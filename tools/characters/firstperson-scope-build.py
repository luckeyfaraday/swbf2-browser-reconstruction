"""Selected rifle zoom visibility: serialized assets and bounded native evidence."""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = 'BF2-FIRSTPERSON-SCOPE-VISIBILITY-NATIVE-001'


def read(relative):
    path = ROOT / relative
    data = json.loads(path.read_text())
    entry = data['entry']
    return data['asset']['objects'], {
        'file': relative, 'name': entry['name'], 'guid': entry['guid'],
        'sha1': entry['sha1'], 'jsonSha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    camera = json.loads((ROOT / 'web/public/assets/camera-fov.json').read_text())
    controller_path = 'tools/gameplay-recovery/detail/ebx/Gameplay_Equipment_Shared_AimingControllers_AimingController_Default_Short_ZoomOverlay__c70b6ddb-e9b7-4400-bae1-822accd03495.json'
    objects, controller_source = read(controller_path)
    controller = next(o for o in objects if o['$type'].endswith('.SoldierAimingSimulationData'))
    aim_levels = []
    for level in camera['zoomLevels']:
        objects, source = read(level['source']['file'])
        obj = next(o for o in objects if o['$type'].endswith('.ZoomLevelData'))
        aim_levels.append({'source': source, 'objectId': obj['$id'],
                           'UseWeaponMeshZoom1p': obj['UseWeaponMeshZoom1p']})
    weapons = []
    for record in camera['weapons']:
        objects, source = read(record['source']['file'])
        weapon = next(o for o in objects if o['$type'].endswith('.SoldierWeaponData'))
        assert weapon['AimingController']['$external'] == controller_source['guid']
        by_id = {o['$id']: o for o in objects}
        slug = 'e11' if record['weaponId'] == 'primary' else 'a280'
        bundle_path = next((ROOT / 'exports/firstperson-bundles/ebx').glob('Win32_weapons_w_blasterrifle_' + slug + '_1p_bpb__*.json'))
        bundle_objects, bundle_source = read(bundle_path.relative_to(ROOT).as_posix())
        state = next(o for o in bundle_objects if 'WeaponMesh1p' in o)
        mesh = state['WeaponMesh1p'][0]
        levels = []
        for ref in weapon['ZoomLevels']:
            obj = by_id[ref['$ref']]
            levels.append({'objectId': obj['$id'], 'ZoomInOutMeshTransitionFactors': obj['ZoomInOutMeshTransitionFactors']})
        scope = [o['Blueprint'] for o in objects if o.get('Blueprint', {}).get('name', '').endswith('/PF_Hud_Weapon_Scope_Rifle')]
        assert len(scope) == 1
        weapons.append({'weaponId': record['weaponId'], 'source': source, 'objectId': weapon['$id'],
            'bundleSource': bundle_source, 'mesh': mesh['Mesh'], 'meshZoom': mesh['MeshZoom'],
            'hasNormalModel': True, 'hasZoomModel': True,
            'ZoomMeshTransitionFactor': weapon['WeaponStates'][0]['ZoomMeshTransitionFactor'],
            'zoomLevels': levels, 'scopePrefab': scope[0]})
    spec = importlib.util.spec_from_file_location('native', ROOT / 'tools/gameplay-recovery/weapon-handling-native.py')
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    fields = []
    for owner, name, address in [
        ('WeaponZoomLevelData', 'ZoomInOutMeshTransitionFactors', 0x144e054b0),
        ('WeaponStateData', 'ZoomMeshTransitionFactor', 0x144e03c80),
        ('ZoomLevelData', 'UseWeaponMeshZoom1p', 0x144e03428),
        ('SoldierWeaponData', 'ZoomLevels', 0x144e02a98),
        ('SoldierAimingSimulationData', 'ZoomLevels', 0x144e04250),
        ('SoldierAimingSimulationData', 'ZoomTransitionTime', 0x144e042f8),
        ('SocketData', 'HideByZoomTransition', 0x144dffed8)]:
        offset = native.offset(address)
        name_pointer = struct.unpack_from('<Q', native.DATA, offset)[0]
        at = native.offset(name_pointer)
        actual_name = native.DATA[at:native.DATA.index(b'\0', at)].decode()
        assert actual_name == name, (name, actual_name)
        fields.append({'owner': owner, 'name': name, 'offset': hex(struct.unpack_from('<H', native.DATA, offset + 10)[0]),
                       'recordAddress': hex(address), 'recordBytes': native.DATA[offset:offset + 24].hex()})
    spans = [(0x141683340, 0x141683680), (0x141683680, 0x141683766),
             (0x14167b600, 0x14167bb60), (0x1416a4500, 0x1416a4544),
             (0x1416a38b0, 0x1416a3f40), (0x140d4f0f0, 0x140d4f10b),
             (0x141671e30, 0x141671f2f)]
    functions = []
    for start, end in spans:
        path = ROOT / f'exports/firstperson-scope-native/functions/{start:x}.c'
        at = native.offset(start)
        blob = native.DATA[at:at + end - start]
        functions.append({'address': hex(start), 'endExclusive': hex(end),
                          'file': path.relative_to(ROOT).as_posix(),
                          'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                          'nativeSpan': {'fileOffset': at, 'bytes': blob.hex(), 'sha256': hashlib.sha256(blob).hexdigest()}})
    limitations = [
        'Static executable and serialized source evidence; no original-game runtime capture.',
        'The native consumer accepts distinct camera zoom index and weapon aiming index. Browser driver synchronizes both to its accepted aiming boolean; both selected aiming levels have UseWeaponMeshZoom1p=true, so this does not alter the selected visibility result. Pure helper exposes both inputs separately.',
        'Native selection for more than two zoom levels, remote actors, attachment socket visibility, deploy/holster and ANT HideWeapon1P are outside the browser driver.',
        'Scope HUD animation and visual effects are separate source systems. This document does not infer their palette, timing, alpha or glow from mesh visibility.',
        'The physical A280 lens remains opaque. Its cosmetic parallax shader is not replaced by transparency.']
    provenance = {'evidenceId': EVIDENCE, 'runtimeObserved': False,
        'selectionFunction': '0x141683340', 'timerFunction': '0x1416a38b0', 'fractionFunction': '0x1416a4500',
        'browserPolicy': 'Two source zoom levels; accepted browser aiming supplies both native zoom indices. Native masks and timer reversal formula are retained.',
        'limitations': limitations}
    document = {'schemaVersion': 1, 'weapons': weapons, 'aimingController': controller_source,
                'aimingZoomLevels': aim_levels, 'ZoomTransitionTime': controller['ZoomTransitionTime'], 'provenance': provenance}
    evidence = {'evidenceId': EVIDENCE, 'runtimeObserved': False, 'target': str(native.TARGET),
        'sha256': hashlib.sha256(native.DATA).hexdigest(), 'fields': fields, 'functions': functions,
        'findings': [
            '0x141683340 reads WeaponZoomLevelData +0x20 override array and WeaponStateData +0x68 fallback. A one-element override uses element 0; multiple elements use index (cameraZoomIndex == 0).',
            'Local selection: zoom mesh = ((zoomFraction >= threshold) AND current weapon aiming level UseWeaponMeshZoom1p) OR ((zoomFraction < threshold) AND cameraZoomIndex != 0 AND a weapon zoom entry exists AND that camera level UseWeaponMeshZoom1p). Zoom model must exist.',
            '1416834ed TEST R15B,R12B and 1416834f5 SETZ BPL compute firstpersonVisible = !(zoomMeshSelected AND transitionOverridePresent). This mask is ANDed into output body visibility.',
            '141683548 TEST BPL,BPL and 14168357a TEST BPL,BPL gate BOTH normal and zoom weapon model handles before renderer visibility calls at 141683553 and 141683585. Consequently the identical Mesh/MeshZoom references are both hidden for the selected overlay zoom state.',
            'Caller 0x141697450 submits output body visibility through ModelDynamicState change bit 0x200. See retained exports/camera-native/functions/141697450.c.',
            'Selected E11 overrides [.5]/[.5]; selected A280 [.1]/[.2]. Both share aiming levels UseWeaponMeshZoom1p true/true and select PF_Hud_Weapon_Scope_Rifle. Local ADS hides immediately; zoom-out restores only below hip threshold (.5 E11, .1 A280). The two native indices do not change this selected result because both aiming level flags are true.',
            '0x1416a38b0 updates camera zoom index from input, initializes or reverses remaining zoom time, and decrements by dt. 0x1416a4500 returns 1-remaining/duration when zoom index !=0, else remaining/duration; zero remaining gives exactly 1 or 0.',
            'SocketData.HideByZoomTransition is a separate attachment predicate, not a field of Animated1pOnlyWeaponBinding.'],
        'limitations': limitations, 'configuration': document}
    (ROOT / 'exports/firstperson-scope-native/visibility-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    (ROOT / 'web/public/assets/firstperson-scope-visibility.json').write_text(json.dumps(document, indent=2) + '\n')
    print(json.dumps({'evidenceId': EVIDENCE, 'weapons': [w['weaponId'] for w in weapons], 'nativeFunctions': len(functions)}))


if __name__ == '__main__':
    main()
