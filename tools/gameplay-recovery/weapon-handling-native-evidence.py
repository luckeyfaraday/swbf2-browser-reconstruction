"""Bind the inspected GunSway native path to immutable PE bytes and source fields."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('handling_pe', ROOT/'tools/gameplay-recovery/weapon-handling-native.py')
pe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pe)


def data_at(address, size):
    position = pe.offset(address)
    return {'address': hex(address), 'fileOffset': position,
            'hex': pe.DATA[position:position+size].hex()}


fields = []
for index in range(25):
    address = 0x144e06950 + index*24
    name_address, packed, type_address = struct.unpack_from('<QQQ', pe.DATA, pe.offset(address))
    position = pe.offset(name_address)
    name = pe.DATA[position:pe.DATA.index(0, position)].decode('ascii')
    fields.append({'name': name, 'offset': (packed >> 16) & 0xffff,
                   'record': data_at(address, 24), 'nameAddress': hex(name_address),
                   'typeAddress': hex(type_address)})
field_map = {row['name']: row['offset'] for row in fields}
assert {name: field_map[name] for name in ['Dispersion', 'Recoil', 'PowerOfDispersionRandom',
    'FirstShotNoZoomDispersionMultiplier', 'FirstShotZoomDispersionMultiplier']} == {
        'Dispersion': 0x18, 'Recoil': 0x20, 'PowerOfDispersionRandom': 0x3e8,
        'FirstShotNoZoomDispersionMultiplier': 0x3dc, 'FirstShotZoomDispersionMultiplier': 0x3e0}

constants = []
for address, label in [(0x14303f598, 'minusPi'), (0x14301ee88, 'pi'),
                       (0x14302cd08, 'oneOver180'), (0x143012f68, 'one'),
                       (0x14301a310, 'recoilRecoveryTimeExponent'),
                       (0x14303f52c, 'recoilRecoveryScale'), (0x14301d838, 'randomScale')]:
    constants.append({'name': label, 'float32': struct.unpack_from('<f', pe.DATA, pe.offset(address))[0],
                      **data_at(address, 4)})
math_thunks = []
for address, expected in [(0x141e73026, 'powf'), (0x141e72ff0, 'cosf'), (0x141e72ff6, 'sinf')]:
    raw = pe.DATA[pe.offset(address):pe.offset(address)+6]
    assert raw[:2] == b'\xff\x25'
    iat_address = address+6+struct.unpack_from('<i', raw, 2)[0]
    hint_rva = struct.unpack_from('<Q', pe.DATA, pe.offset(iat_address))[0]
    position = pe.offset(pe.BASE+hint_rva)+2
    name = pe.DATA[position:pe.DATA.index(0, position)].decode('ascii')
    assert name == expected
    math_thunks.append({'name': name, 'thunk': data_at(address, 6),
                        'importSlot': data_at(iat_address, 8), 'hintNameAddress': hex(pe.BASE+hint_rva)})

functions = []
for address, role in [
    (0x14165c120, 'Registers source GunSwayData typeinfo with runtime factory.'),
    (0x141659fe0, 'Factory allocates0x1e0 bytes then calls constructor.'),
    (0x141657d30, 'Constructor stores vtable0x143467b20 and source-data pointer at+8.'),
    (0x14165bc40, 'Accepted-shot pulse and polar dispersion sample, before subsequent frame increment.'),
    (0x14165cf10, 'Frame update dispatches spread/recoil kernels and consumes accepted-shot pulse.'),
    (0x14165d2e0, 'Spread increment, conditional recovery, threshold selection and min/max clamp.'),
    (0x141659ab0, 'Reads flat Dispersion array and blends movement/sprint parameters with base parameters.'),
    (0x14165a5c0, 'Selects default/moving/jumping/sprinting action from native input state.'),
    (0x14165ab30, 'Builds source-local Rx(pitch)*Ry(yaw) rotation matrix from stored two angular offsets.'),
    (0x1401c6410, 'Native random-number arithmetic and float scaling; native seeding not reconstructed.'),
    (0x1401c63d0, 'Native uniform interval mapping: U*(maximum-minimum)+minimum.'),
    (0x14165d570, 'Separate recoil accumulation/recovery and camera spring composition; not applied by spread adapter.'),
]:
    path = ROOT/f'exports/weapon-handling-native/functions/{address:x}.c'
    raw = path.read_bytes()
    assert b'// Error: \n' in raw and b'\n/* Instructions:' in raw
    functions.append({'address': hex(address), 'role': role, 'file': path.relative_to(ROOT).as_posix(),
                      'sha256': hashlib.sha256(raw).hexdigest(),
                      'evidenceType': 'Ghidra12.1.4-bounded-static-decompilation-and-instructions'})

report = {'schemaVersion': 1, 'evidenceId': 'BF2-WEAPON-HANDLING-NATIVE-001',
    'target': {'file': str(pe.TARGET), 'sha256': hashlib.sha256(pe.DATA).hexdigest(),
               'imageBase': hex(pe.BASE)}, 'runtimeObserved': False,
    'scope': 'Source-selected GunSwayData registration, runtime factory/vtable, spread sampling and frame update; bounded static analysis without whole-program auto-analysis.',
    'sourceEvidence': 'tools/gameplay-recovery/weapon-handling-evidence.json',
    'nativeFields': fields, 'constants': constants, 'mathThunks': math_thunks, 'functions': functions,
    'vtable': {'address': '0x143467b20', 'acceptedShotSlot': 3, 'frameUpdateSlot': 30,
               'spreadTransformSlot': 32, 'recoilTransformSlots': [33, 34]},
    'observed': [
        {'claim': 'The selected source GunSwayData has a registered runtime factory. Its constructor stores the source-data pointer at runtime+8 and a vtable whose shot/update functions are inspected.',
         'addresses': ['0x14165c120', '0x141659fe0', '0x141657d30', '0x143467b20']},
        {'claim': 'Native spread resolver reads flattened Dispersion[(pose*2+zoom)*4+action] with24-byte records, not named Stand/Crouch/Prone structs on this path.',
         'addresses': ['0x141659ab0', '0x144e06950']},
        {'claim': 'Moving and sprinting blend all six parameters with base by clamped speed/recordedMaxSpeed. Native action selection and a0.5-second jumping state exist, but browser state mapping is not native input replay.',
         'addresses': ['0x141659ab0', '0x14165a5c0', '0x14165d2e0']},
        {'claim': 'Accepted shot samples azimuth=U*(pi-(-pi))+(-pi); radial=powf(V,PowerOfDispersionRandom)*currentDispersion*pi*(1/180). Stored offsets are pitch=sin(azimuth)*radial and yaw=cos(azimuth)*radial. This establishes degree units for currentDispersion.',
         'addresses': ['0x14165bc40', '0x1401c63d0', '0x141e73026', '0x141e72ff0', '0x141e72ff6']},
        {'claim': 'The spread transform is Rx(pitch)*Ry(yaw); its source-local +Z output is(sin(yaw),-sin(pitch)*cos(yaw),cos(pitch)*cos(yaw)).',
         'addresses': ['0x14165ab30']},
        {'claim': 'Shot sets runtime+0x1cc pulse and zeroes time+0x1d0; the following nonzero-dt update adds IncreasePerShot, with source first-shot multiplier under a separate guard, conditionally subtracts rate*dt, clamps to MinAngle/MaxAngle, increments elapsed time and clears pulse.',
         'addresses': ['0x14165bc40', '0x14165d2e0', '0x14165cf10']},
        {'claim': 'Recovery runs when runtime+0x1d4 is false. Rate is DecreasePerSecond until elapsed>=NoFireTimeThreshold, then NoFireDecreasePerSecond. The same flag selects ShootingRecoilDecreaseScale in the separate recoil kernel.',
         'addresses': ['0x14165d2e0', '0x14165d570']},
        {'claim': 'Recoil array amplitudes also multiply by pi/180. Recoil recovery includes powf(timeSinceShot,2)*RecoilAmplitudeDecreaseFactor*0.3*dt, modifier factors and optional camera spring composition. It is separate from shot spread.',
         'addresses': ['0x14165d570']},
    ],
    'adapter': {'file': 'web/src/weapon-handling.js', 'factory': 'createWeaponSpread',
        'sourceStates': ['stand/crouch/prone', 'hip/zoom', 'base/moving/jumping/sprinting'],
        'nativeEquationsImplemented': ['flattened source array lookup', 'base/motion interpolation',
            'accepted-shot increment', 'conditional linear recovery', 'no-fire threshold selection',
            'minimum/maximum clamp', 'degree conversion', 'power radial sample', 'source-local rotation'],
        'inferences': ['Browser held trigger maps to runtime recovery-suppression flag+0x1d4; its native caller is not traced.',
            'Caller provides pose/action, movementFraction and first-shot guard; native actor state and pose-transition replay are not implemented.',
            'New/reset browser state starts at selected minimum, equivalent to the first native steady-state clamp; native constructor stores0 before its first frame update.',
            'Random stream and call scheduling are supplied by the browser. JavaScript uses double precision and Math trigonometry, not native float32/libm bit parity.',
            'Returned localDirection uses native source-local +Z. Mapping this basis into browser camera/projectile coordinates is an integration step, not measured native camera composition.'],
        'excluded': ['native pose-transition penalties', 'suppression', 'active conditional modifiers',
                     'native random seeding', 'camera spring/recoil and additive animation composition']},
    'limitations': ['This is static reconstruction, not native runtime observation.',
        'PE exception records split some functions into multiple ranges. Retained pseudocode follows reachable branches; short pdata ranges alone are not complete source-function boundaries.',
        'The caller of recovery-suppression flag and complete weapon firing pipeline scheduling are not recovered.',
        'Whole-weapon legacy dispersion combination and projectile/aim compensation outside this selected GunSway path remain unmeasured.']}
destination = ROOT/'tools/gameplay-recovery/weapon-handling-native-evidence.json'
destination.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'evidenceId': report['evidenceId'], 'nativeFields': len(fields),
                  'functions': len(functions), 'mathThunks': [row['name'] for row in math_thunks]}))
