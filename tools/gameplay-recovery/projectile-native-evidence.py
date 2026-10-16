"""Reproduce bounded projectile metadata/vtable evidence from the installed PE."""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('pe', HERE / 'weapon-handling-native.py')
pe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pe)


def raw(address, length):
    offset = pe.offset(address)
    return dict(address=hex(address), fileOffset=offset, bytes=pe.DATA[offset:offset+length].hex())


def field(address, owner, name, offset):
    name_pointer, flags, type_pointer = struct.unpack_from('<QQQ', pe.DATA, pe.offset(address))
    start = pe.offset(name_pointer)
    actual = pe.DATA[start:pe.DATA.index(b'\0', start)].decode()
    assert actual == name, (actual, name)
    assert flags >> 16 == offset, (name, hex(flags >> 16), hex(offset))
    return dict(owner=owner, name=name, offset=hex(offset), namePointer=hex(name_pointer),
                typePointer=hex(type_pointer), record=raw(address, 24))


def pointer(address, expected, meaning):
    assert struct.unpack_from('<Q', pe.DATA, pe.offset(address))[0] == expected
    return dict(meaning=meaning, target=hex(expected), record=raw(address, 8))


def function(address, end=None):
    path = ROOT / 'exports/projectile-native/functions' / (f'{address:x}.c')
    data = path.read_bytes()
    span = pe.function(address)
    length = end-address if end else span['bytes']
    assert b'/* Instructions:' in data and b'// Error: \n' in data
    return dict(entry=hex(address), file=path.relative_to(ROOT).as_posix(),
                sha256=hashlib.sha256(data).hexdigest(),
                nativeSpan=raw(address, length),
                note='Span is explicitly bounded; decompiler may follow shared tail calls beyond it.')


def main():
    report = dict(evidenceId='BF2-PROJECTILE-NATIVE-001', runtimeObserved=False,
        target=str(pe.TARGET), sha256=hashlib.sha256(pe.DATA).hexdigest(), imageBase=hex(pe.BASE),
        methodology='Exact installed PE reflection records and vtables, followed by bounded Ghidra disassembly/decompilation without global analysis or target execution.',
        fields=[
            field(0x144e12598, 'ShotConfigData', 'InitialSpeed', 0x20),
            field(0x144e125b0, 'ShotConfigData', 'InitialSpeedScaleByPitch', 0x38),
            field(0x144e125c8, 'ShotConfigData', 'InheritWeaponSpeedAmount', 0x68),
            field(0x144e12f70, 'FiringFunctionData', 'Shot', 0xe0),
            field(0x144e12910, 'ProjectileEntityData', 'InitialSpeed', 0xa8),
            field(0x144e12928, 'ProjectileEntityData', 'TimeToLive', 0xac),
            field(0x144e12370, 'BulletEntityData', 'Gravity', 0x140),
            field(0x144e124d8, 'BulletEntityData', 'InstantHit', 0x181),
            field(0x144e124f0, 'BulletEntityData', 'FirstFrameTravelDistance', 0x178),
            field(0x144e142c0, 'WeaponData', 'ApplyPowerToSpeed', 0x21),
            field(0x144e13a40, 'WeaponShotModifier', 'InitialSpeed', 0x20),
            field(0x144e13a88, 'WeaponShotModifier', 'InitialSpeedMultiplier', 0x38),
        ],
        pointers=[
            pointer(0x143511db8+0x48, 0x14717d990, 'Registered WSBullet server factory virtual create slot'),
            pointer(0x143515838+0x160, 0x1417e97e0, 'WS server bullet initializer'),
            pointer(0x143515838+0x250, 0x1417dbc00, 'WS server bullet velocity setter'),
            pointer(0x143515838+0x258, 0x1417e5a70, 'WS server bullet segment update'),
            pointer(0x1434c06e0+0xa8, 0x1417d51d0, 'Server weapon launch velocity array builder'),
        ],
        functions=[function(a, b) for a, b in [
            (0x1400c3c40, 0x1400c3c85), (0x14717d990, 0x14717da2f),
            (0x1419627d0, 0x141962888), (0x1417e5780, 0x1417e5a21),
            (0x141818e60, 0x141818fc7), (0x1417d51d0, 0x1417d57e1),
            (0x1417d4210, 0x1417d49a7), (0x1417dbea0, 0x1417dbf8d),
            (0x140b35730, 0x140b357a6), (0x140bbf530, 0x140bbf608),
            (0x1417e97e0, 0x1417e9aee), (0x1417dbc00, 0x1417dbc0b),
            (0x1417e5a70, 0x1417e5d86),
        ]],
        conclusions=[
            dict(id='shot-vector', functions=['0x1417e5780','0x141818e60'],
                 observation='With an empty pitch table, read PrimaryFire+0x100 = Shot(+0xe0).InitialSpeed(+0x20). The optional WeaponShotModifier resolver preserves this vector when no shot modifier is active.'),
            dict(id='world-launch-vector', functions=['0x1417d51d0'],
                 observation='ApplyPowerToSpeed=false forces the multiplier to 1. Rotate the initial vector through the firing basis/spread, then add InheritWeaponSpeedAmount times weapon velocity; append each result to the launch velocity array.'),
            dict(id='record-bridge', functions=['0x1417d4210','0x1417dbea0','0x140b35730','0x140bbf530'],
                 observation='The launch loop assigns its current generated velocity pointer to launchRecord+0xd0 (stack 0x758-0x688), then passes the launch record through the generic projectile bridge to virtual initializer+0x160.'),
            dict(id='selected-server-type', functions=['0x1400c3c40','0x14717d990','0x1419627d0'],
                 observation='WSBulletEntityData runtime type 0x144cf9a60 is registered for realm 1 with factory vtable 0x143511db8. Its create slot invokes the WS server bullet constructor, which installs vtable 0x143515838.'),
            dict(id='velocity-precedence', functions=['0x1417e97e0','0x1417dbc00'],
                 observation='Only a null launch record reads ProjectileEntityData.InitialSpeed(+0xa8) and transforms local [0,0,speed]. A supplied record passes its velocity pointer at +0xd0 directly to the setter, which copies the vector to entity+0x1f0.'),
            dict(id='step-and-lifetime', functions=['0x1417e5a70'],
                 observation='For InstantHit=false, advance age by dt, clip travel dt at TimeToLive plus detonation variation, and form a collision segment from position to position+travelDt*velocity. Optional first-frame distance is added; gravity modifies Y velocity. Selected first-frame distance and gravity are zero, TTL is 3, and variation is zero.'),
        ],
        limits=[
            'Static code and configuration evidence only; no observation of a running native match.',
            'Selected unmodified primary E11/A280 shots only; conditional Ion/unlock projectile changes and external live modifiers are excluded.',
            'Recovered velocity magnitude and lifetime do not establish camera/muzzle convergence, tracer appearance, native timing frequency, network prediction, aim-assist or random stream.',
            'Ghidra inferred function signatures can misidentify register arguments; named fields, explicit memory offsets and disassembly support the reported data flow.',
            'The 2100-unit travel bound is derived from 700 times 3 under zero gravity and no collision; it is not a serialized range setting or a guarantee of reaching that distance in a level.',
        ])
    output = HERE / 'projectile-native-evidence.json'
    output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(dict(output=output.relative_to(ROOT).as_posix(), fields=len(report['fields']),
                         pointers=len(report['pointers']), functions=len(report['functions']))))


if __name__ == '__main__':
    main()
