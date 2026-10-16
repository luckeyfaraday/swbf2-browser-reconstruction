"""Bind selected rifle camera recoil to the recovered native spring/kernel."""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('native',Path(__file__).with_name('projectile-native-evidence.py'))
native=importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
pe=native.pe


def build():
    handling_path=ROOT/'tools/gameplay-recovery/weapon-handling-evidence.json'
    handling=json.loads(handling_path.read_bytes())
    selected={'CameraRecoil','CameraRecoilWhenZoomed','SpringConstant','SpringDamping','SpringMinThresholdAngle',
              'Recoil','FirstShotRecoilMultiplier','ShootingRecoilDecreaseScale','SuppressionRecoilModifiers'}
    observations=[row for row in handling['observations'] if row['jsonPointer'].split('/')[-1] in selected]
    links=[row for row in handling['referenceChain'] if row['jsonPointer'].split('/')[-1] in
           {'NonStreamedBlueprint','WeaponFiring','WeaponSway'}]
    source_docs={}
    for row in observations+links:
        source=row['source']
        if source['guid'] not in source_docs:
            raw=(ROOT/source['file']).read_bytes()
            assert hashlib.sha256(raw).hexdigest()==source['jsonSha256']
            source_docs[source['guid']]=json.loads(raw)
        actual=source_docs[source['guid']]
        for key in row['jsonPointer'].split('/')[1:]:actual=actual[int(key)] if isinstance(actual,list) else actual[key]
        assert actual==row['value']
    for row in links:
        value=row['value']
        if '$external' in value:
            assert value['$external'] in source_docs
            assert any(o['$id']==value['classGuid'] for o in source_docs[value['$external']]['asset']['objects'])
    source=handling['configuration']['swaySource']
    sway=next(o for o in source_docs[source['guid']]['asset']['objects'] if o['$type'].endswith('.GunSwayData'))
    spring=next(o for o in source_docs[source['guid']]['asset']['objects'] if o['$id']==sway['CameraRecoil']['$ref'])
    spring={key:spring[key] for key in ['SpringConstant','SpringDamping','SpringMinThresholdAngle']}
    assert spring==dict(SpringConstant=3000,SpringDamping=.84,SpringMinThresholdAngle=0)
    assert sway['CameraRecoilWhenZoomed'] is True
    assert sway['FirstShotRecoilMultiplier']==sway['ShootingRecoilDecreaseScale']==1
    configuration=dict(source=source,spring=spring,recoil=handling['configuration']['sway']['Recoil'],
        **{key:sway[key] for key in ['CameraRecoilWhenZoomed','FirstShotRecoilMultiplier','ShootingRecoilDecreaseScale']})
    assert len(configuration['recoil'])==6
    constants=[]
    for address,name,expected in [(0x14303f56c,'dampingNormalization',30),(0x14301a310,'recoveryExponent',2),
                                  (0x14303f52c,'recoveryScale',.3),(0x14301a300,'settledEpsilon',1e-6),
                                  (0x14301ee88,'pi',3.141592653589793),(0x14302cd08,'degreeScale',1/180)]:
        value=struct.unpack_from('<f',pe.DATA,pe.offset(address))[0]
        assert abs(value-expected)<1e-6
        constants.append(dict(name=name,value=value,record=native.raw(address,4)))
    configuration['nativeConstants']={row['name']:row['value'] for row in constants}
    functions=[]
    for entry,end in [(0x141657e30,0x141657ea3),(0x14165c910,0x14165c975),(0x14165d040,0x14165d13e),
                      (0x14165b390,0x14165b3f2),(0x14165d570,0x14165db0f),(0x14165a7a0,0x14165a880),
                      (0x14165cf10,0x14165d034),(0x14165a5b0,0x14165a5be),(0x141698d00,0x141698d7c),
                      (0x1416bbf70,0x1416bc05e),(0x1416b7ce0,0x1416b7d3a),(0x1416c14f0,0x1416c14f9),
                      (0x1416c6790,0x1416c6927),(0x142e1fbe0,0x142e2032e)]:
        path=ROOT/f'exports/camera-recoil-native/functions/{entry:x}.c';raw=path.read_bytes()
        assert b'// Error: \n' in raw
        functions.append(dict(entry=hex(entry),file=path.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(raw).hexdigest(),nativeSpan=native.raw(entry,end-entry)))
    imports=[]
    for entry,name in [(0x141e73026,'powf'),(0x141e72fae,'log10f')]:
        off=pe.offset(entry);assert pe.DATA[off:off+2]==b'\xff\x25'
        slot=entry+6+struct.unpack_from('<i',pe.DATA,off+2)[0]
        hint=pe.BASE+struct.unpack_from('<Q',pe.DATA,pe.offset(slot))[0]
        start=pe.offset(hint)+2;assert pe.DATA[start:pe.DATA.index(b'\0',start)].decode()==name
        imports.append(dict(name=name,thunk=native.raw(entry,6),slot=native.raw(slot,8),hintName=native.raw(hint,len(name)+3)))
    fire_path=ROOT/'web/public/assets/firstperson-fire.json';fire=json.loads(fire_path.read_bytes());camera_tracks=[]
    for weapon in fire['weapons']:
        for clip in weapon['clips']:
            for track in clip['tracks']:
                if track['bone'] not in ['CameraJoint','CameraBase']:continue
                assert all(value==track['values'][0] for value in track['values'])
                if track['property']=='rotation':assert track['values'][0][:3]==[0,0,0] and track['values'][0][3]>0
                else:assert track['values'][0]==[0,0,0]
                camera_tracks.append(dict(weaponId=weapon['weaponId'],clipId=clip['id'],bone=track['bone'],property=track['property'],constantValue=track['values'][0]))
    boundary_path=Path(__file__).with_name('camera-aiming-evidence.json')
    boundary=json.loads(boundary_path.read_bytes())
    assert boundary['evidenceId']=='BF2-CAMERA-AIMING-BOUNDARY-001'
    boundary_link=dict(evidenceId=boundary['evidenceId'],file=boundary_path.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(boundary_path.read_bytes()).hexdigest())
    evidence=dict(evidenceId='BF2-CAMERA-RECOIL-NATIVE-001',runtimeObserved=False,target=str(pe.TARGET),targetSha256=hashlib.sha256(pe.DATA).hexdigest(),
        aimingBoundary=boundary_link,
        sourceEvidence=dict(file=handling_path.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(handling_path.read_bytes()).hexdigest()),
        observations=observations,links=links,constants=constants,imports=imports,functions=functions,
        fields=[native.field(*row) for row in [
            (0x144e06b90,'GunSwayData','CameraRecoil',0x48),(0x144e06968,'GunSwayData','Recoil',0x20),
            (0x144e06b48,'GunSwayData','CameraRecoilWhenZoomed',0x3f0),
            (0x144e071f0,'CameraRecoilData','SpringConstant',0x18),
            (0x144e07208,'CameraRecoilData','SpringDamping',0x1c),
            (0x144e07220,'CameraRecoilData','SpringMinThresholdAngle',0x20),
            (0x144e06f00,'GunSwayRecoilData','RecoilAmplitudeMax',0),
            (0x144e06f18,'GunSwayRecoilData','RecoilAmplitudeIncPerShot',4),
            (0x144e06f30,'GunSwayRecoilData','HorizontalRecoilAmplitudeIncPerShotMin',8),
            (0x144e06f48,'GunSwayRecoilData','HorizontalRecoilAmplitudeIncPerShotMax',12),
            (0x144e06f60,'GunSwayRecoilData','HorizontalRecoilAmplitudeMax',16),
            (0x144e06f78,'GunSwayRecoilData','RecoilAmplitudeDecreaseFactor',20),
            (0x144dfdcd8,'AimingSimDynamicState','Recoil',0x188),
        ]],
        pointers=[native.pointer(*row) for row in [
            (0x143467b20+0xf8,0x14165a5b0,'GunSway recoil pair getter'),
            (0x143467b20+0xf0,0x14165cf10,'GunSway frame update'),
            (0x144bfb9a0,0x14345d980,'AimingSimDynamicState type name'),
            (0x144bfb9f0,0x144dfdb40,'AimingSimDynamicState field table'),
            (0x143479d98+0x28,0x1416c14f0,'Aiming manager dynamic-state setter'),
        ]],
        animationSeparation=dict(file=fire_path.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(fire_path.read_bytes()).hexdigest(),cameraTracks=camera_tracks),
        recovered=[
            '141657e30 initializes both spring axes from selected GunSwayData.CameraRecoil; initial position/velocity/targets are0.',
            '14165d570 indexes Recoil[pose*2+zoom] with24-byte records and converts angular increments/maxima by pi/180. With no active modifiers and suppression0, log10(1+9*suppression)=0 removes suppression additions.',
            'Accepted-shot pulse adds uniform horizontal[min,max] radians and fixed negative vertical increment radians, then clamps amplitudes. Vertical first-shot factor is selected separately; the selected factor is1. Native still consumes a random value for equal vertical bounds.',
            'No-shot update increments elapsed before recovery. Recovery per axis is elapsed^2*RecoilAmplitudeDecreaseFactor*0.3*dt, optionally multiplied by ShootingRecoilDecreaseScale. The source selected scale is1. It approaches0 without crossing.',
            '14165c910 applies SpringMinThresholdAngle*pi/180 to each target.14165d040 computes v=(v-(x-target)*k*dt)*(1-damping)^(30*dt), then x=x+v*dt.',
            'Native feedback subtracts input pair+8/+c from raw targets before spring, and from selected spring output afterward. The linked aiming-boundary trace identifies it as RecoilCompensation, the same-sign portion of solved aim movement consumed by remaining recoil. It is not raw mouse delta.',
            'CameraRecoilWhenZoomed true selects spring output while zoomed; spring is also selected unzoomed.14165a5b0 returns selected[yaw,pitch].141698d00 writes AimingSimDynamicState.Recoil and submits the state through manager virtual+28. The active manager passes it to142e1fbe0.',
            'All retained E11/A280 CameraJoint/CameraBase additive firing channels are constant identity/zero; the existing decoded clips do not contain this camera spring.',
        ],
        unknowns=['Final projectile camera-override precedence and native simulation/render scheduling remain unresolved; see the linked aiming boundary. Unanimated camera composition and compensation arithmetic are established there.',
                  'Browser pose/aim/held-trigger mapping and RNG stream remain reconstruction; local Three recoil rotation is now derived from the explicit native camera basis flip. No native runtime output was observed.',
                  'Selected unmodified/suppression0 path only. Conditional unlock modifiers, nonzero suppression and full aim correction are excluded.'])
    destination=Path(__file__).with_name('camera-recoil-evidence.json');destination.write_text(json.dumps(evidence,indent=2)+'\n')
    document=dict(schemaVersion=1,weapons=[dict(weaponId=w['weaponId'],source=w['source'],swaySourceGuid=w['swaySourceGuid']) for w in handling['weapons']],
        configuration=configuration,provenance=dict(evidenceId=evidence['evidenceId'],runtimeObserved=False,
            evidenceFile=destination.relative_to(ROOT).as_posix(),evidenceSha256=hashlib.sha256(destination.read_bytes()).hexdigest(),
            aimingBoundary=boundary_link,
            observed='Source pose/zoom recoil, degree conversion, accumulation/clamping, time-squared recovery, spring equation, aiming compensation and unanimated first-person procedural camera composition.',
            derived='Local Three camera rotation is Rx(-nativePitch)*Ry(nativeYaw), appended to base camera quaternion; presentationRadians has XYZ order.',
            inferred='Browser simulation scheduling/RNG, pose inputs and mapping existing controller movement to solved native aim movement.',
            excluded='Suppression/unlock modifiers, full aiming constraints/assist, animated-camera blending and final projectile camera-override precedence. No mutation of recovered firing animation.'))
    (ROOT/'web/public/assets/camera-recoil.json').write_text(json.dumps(document,indent=2)+'\n')
    print(f'Verified {len(observations)} source observations, {len(links)} source links, {len(functions)} native functions and {len(camera_tracks)} constant camera tracks.')


if __name__=='__main__':build()
