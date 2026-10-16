"""Retain the native aiming compensation and first-person recoil boundary."""
from pathlib import Path
import hashlib
import importlib.util
import json

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('native',Path(__file__).with_name('projectile-native-evidence.py'))
n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n)


def build():
    functions=[]
    spans=[
        (0x141693a10,0x141693de9),(0x14169bdd0,0x14169bf07),
        (0x141683e40,0x14168408b),(0x1416902c0,0x1416902eb),
        (0x1416927e0,0x1416927e8),(0x141694c50,0x141694c70),
        (0x1416841c0,0x141684fdf),(0x14180d0b0,0x14180d100),
        (0x146cb4ea0,0x146cb4ee9),(0x146cb4890,0x146cb48d5),
        (0x14165ab30,0x14165ad9a),(0x14166f230,0x14166f718),
        (0x1416812b0,0x14168194a),(0x1416a9b00,0x1416aa753),
        (0x1416aa760,0x1416aaf92),(0x14164d550,0x14164dc78),
        (0x140a651d0,0x140a651f0),(0x1417d5c00,0x1417d5fcd),
        (0x1417d58b0,0x1417d5bf9),(0x146fae660,0x146fae736),
        (0x1417ec410,0x1417ec4ea),
    ]
    for entry,end in spans:
        path=ROOT/f'exports/camera-recoil-native/aiming/{entry:x}.c';raw=path.read_bytes()
        assert b'// Error: \n' in raw and b'/* Instructions:' in raw
        functions.append(dict(entry=hex(entry),file=path.relative_to(ROOT).as_posix(),
            sha256=hashlib.sha256(raw).hexdigest(),nativeSpan=n.raw(entry,end-entry)))
    fields=[n.field(*row) for row in [
        (0x144dfdcd8,'AimingSimDynamicState','Recoil',0x188),
        (0x144dfdd38,'AimingSimDynamicState','Tick',0x19c),
        (0x144dfde40,'AimingSimDynamicState','SimPitchToApply',0x1c8),
        (0x144dfde58,'AimingSimDynamicState','SimYawToApply',0x1cc),
        (0x144dfdfa8,'AimingSimDynamicState','IsAlive',0x1fd),
        (0x144dfea30,'AimingRenderReturnedValues','RecoilCompensation',0x20),
        (0x144dfea60,'AimingRenderReturnedValues','Yaw',0x2c),
        (0x144dfea78,'AimingRenderReturnedValues','Pitch',0x30),
        (0x144dfe630,'SoldierFirstPersonCameraSimState','ProceduralTransform',0x100),
        (0x144dfe648,'SoldierFirstPersonCameraSimState','ShakeTransform',0x140),
        (0x144dfe678,'SoldierFirstPersonCameraSimState','WeaponSwayTransform',0x1c0),
        (0x144dfe768,'SoldierFirstPersonCameraSimState','AnimatedCameraFactor',0x234),
        (0x144e126b8,'ShotConfigData','RelativeTargetAiming',0x80),
        (0x144e126d0,'ShotConfigData','ForceSpawnToCamera',0x81),
        (0x144e126e8,'ShotConfigData','SpawnVisualAtWeaponBone',0x82),
        (0x144e12718,'ShotConfigData','ActiveForceSpawnToCamera',0x83),
    ]]
    pointers=[n.pointer(*row) for row in [
        (0x143467b20+0x108,0x146cb4ea0,'GunSway raw-target rotation getter'),
        (0x143467b20+0x110,0x146cb4890,'GunSway spring-output rotation getter'),
        (0x144bfc0c0,0x14345db98,'SoldierFirstPersonCameraSimState type name'),
        (0x144bfc110,0x144dfe5d0,'SoldierFirstPersonCameraSimState field table'),
        (0x144bfbfa0,0x14345dbc0,'AimingRenderReturnedValues type name'),
        (0x1434c06e0+0xa0,0x1417d5c00,'Server initial shot transform builder'),
        (0x1434c06e0+0x98,0x1417d58b0,'Server camera-spawn override stage'),
        (0x1434c06e0+0x90,0x146fae660,'Server optional aim correction stage'),
    ]]
    projectile=json.loads((ROOT/'tools/gameplay-recovery/projectile-evidence.json').read_bytes())
    shots=[]
    for row in projectile['observations']:
        if not row['jsonPointer'].endswith('/Shot'):continue
        source=next(s for s in projectile['provenance']['sources'] if s['guid']==row['sourceGuid'])
        raw=(ROOT/source['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==source['jsonSha256']
        actual=json.loads(raw)
        for key in row['jsonPointer'].split('/')[1:]:actual=actual[int(key)] if isinstance(actual,list) else actual[key]
        assert actual==row['value']
        assert actual['RelativeTargetAiming'] is False
        assert actual['ForceSpawnToCamera'] is actual['ActiveForceSpawnToCamera'] is True
        shots.append(dict(source=source,jsonPointer=row['jsonPointer'],value=actual))
    assert len(shots)==2
    evidence=dict(evidenceId='BF2-CAMERA-AIMING-BOUNDARY-001',runtimeObserved=False,
        target=str(n.pe.TARGET),targetSha256=hashlib.sha256(n.pe.DATA).hexdigest(),
        methodology='Bounded static PE metadata, direct call sites, vtable slots and retained disassembly; no target execution.',
        functions=functions,fields=fields,pointers=pointers,selectedShots=shots,
        recovered=[
            '141693a10 copies dynamic Recoil into aiming working-state +58/+5c once per Tick. After solving aim movement, each same-sign axis consumes min(abs(recoil),abs(movement)); opposite-sign input consumes0. Yaw movement wraps to [-pi,pi). Stored base aim subtracts the consumed portion.',
            '14169bdd0 stores input Recoil minus remaining Recoil at object+470. Metadata identifies this as AimingRenderReturnedValues(+450).RecoilCompensation(+20). 141683e40 copies this returned pair into GunSway context+8/+c when the local returned-values branch is active; its alternative drains Soldier+948 through1416902c0. It is not raw mouse delta.',
            '14165cf10 snapshots raw recoil pitch/yaw at GunSway+1a8/+1ac and spring-output pitch/yaw at+198/+19c. Getters+108 and+110 respectively build rotation through14165ab30.',
            '14165ab30 builds the rotation Rx(pitch)*Ry(yaw), with third basis vector (sin(yaw),-sin(pitch)*cos(yaw),cos(pitch)*cos(yaw)).',
            '14166f230 reads spring-output getter+110 when its enabled flag is set. 1416812b0 writes that matrix to SoldierFirstPersonCameraSimState.ProceduralTransform(+100); raw getter+108 separately supplies WeaponSwayTransform(+1c0).',
            '1416aa760 multiplies the base first-person transform by ProceduralTransform when AnimatedCameraFactor=0; factors between0and1 blend it toward identity, factor>=1 omits it. It then negates right/forward basis columns (diag(-1,1,-1)) and appends the separate ShakeTransform.',
            'Conjugating the native recoil matrix by that explicit camera basis yields local Three Rx(-pitch)*Ry(yaw). This is a derived matrix identity, not an empirical sign guess; append it to the base camera quaternion rather than adding world Euler angles.',
            '14164d550 appends raw-target getter+108 to the initial weapon firing transform. 1416841c0 stores this with140a651d0 into weapon+40, before calling the GunSway update wrapper14180d0b0. 1417d5c00 starts the server shot basis from that stored matrix.',
            'Selected RelativeTargetAiming=false avoids the relative-target branch, but ForceSpawnToCamera=true and ActiveForceSpawnToCamera=true enter1417d58b0 camera selection. It can replace position and orientation with active camera entity transform combined with weapon+80. The later+90 callback has another conditional aim-correction path.',
        ],
        unknowns=[
            'The selected active camera component runtime transform and weapon+80 correction at the camera-spawn override have not been tied to the render spring output or initial raw recoil. Therefore final projectile recoil precedence is unresolved; do not apply raw target as a proven final ray.',
            'Native simulation/render event timing, input device filtering, full constraints/aim assist, animated-camera blend and alternative returned-values branch are not reproduced. The compensation kernel accepts already solved angular movement.',
            'No native runtime output was observed. Browser doubles and RNG are not native float/libm/RNG bit parity.',
        ])
    path=Path(__file__).with_name('camera-aiming-evidence.json');path.write_text(json.dumps(evidence,indent=2)+'\n')
    document=dict(schemaVersion=1,evidenceId=evidence['evidenceId'],runtimeObserved=False,
        camera=dict(source='spring-output',composition='baseCamera * Rx(-nativePitch) * Ry(nativeYaw)',
                    scope='Unanimated first-person camera, identity independent shake transform.'),
        feedback=dict(source='RecoilCompensation',rule='same-sign min(abs(remainingRecoil),abs(solvedAimMovement))',
                      nativeFromBrowserMovement=dict(yawScale=-1,pitchScale=1)),
        projectile=dict(initialBasis='raw-recoil-target',selectedCameraOverride=True,finalRecoilPrecedence='unresolved'),
        provenance=dict(evidenceFile=path.relative_to(ROOT).as_posix(),evidenceSha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    (ROOT/'web/public/assets/camera-aiming.json').write_text(json.dumps(document,indent=2)+'\n')
    print(f'Verified {len(functions)} native spans, {len(fields)} fields, {len(pointers)} pointers and {len(shots)} selected source shots.')


if __name__=='__main__':build()
