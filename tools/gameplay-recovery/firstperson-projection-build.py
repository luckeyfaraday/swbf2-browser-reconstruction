"""Verify selected render FOV and its bounded native model-state submission."""
from pathlib import Path
import hashlib
import importlib.util
import json

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('native', Path(__file__).with_name('projectile-native-evidence.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
pe = native.pe


def build():
    sources, observations, links, weapons = [], [], [], []
    for weapon_id, pattern in [('primary', 'tools/gameplay-recovery/e11-root/ebx/*W_BlasterRifle_E11__*.json'),
                               ('rebel-a280', 'exports/faction-rebel-weapon/ebx/*W_BlasterRifle_A280__*.json')]:
        paths = list(ROOT.glob(pattern))
        assert len(paths) == 1
        path = paths[0]
        raw = path.read_bytes()
        doc = json.loads(raw)
        assert not doc['asset'].get('errors')
        source = dict(file=path.relative_to(ROOT).as_posix(), guid=doc['entry']['guid'], name=doc['entry']['name'],
                      sha1=doc['entry']['sha1'], jsonSha256=hashlib.sha256(raw).hexdigest())
        sources.append(source)

        def observe(obj, field):
            observations.append(dict(sourceGuid=source['guid'], objectId=obj['$id'],
                jsonPointer=f"/asset/objects/{doc['asset']['objects'].index(obj)}/{field}", value=obj[field]))
            return obj[field]

        weapon = next(o for o in doc['asset']['objects'] if o['$type'].endswith('.SoldierWeaponData'))
        fovs = []
        for ref in observe(weapon, 'ZoomLevels'):
            zoom = next(o for o in doc['asset']['objects'] if o['$id'] == ref['$ref'])
            assert zoom['$type'].endswith('.WeaponZoomLevelData')
            links.append(dict(sourceGuid=source['guid'], objectId=weapon['$id'], field='ZoomLevels', targetObjectId=zoom['$id']))
            fovs.append(observe(zoom, 'RenderFov'))
            assert observe(zoom, 'RenderFovTransition') is None
        assert fovs == [55, 55]
        weapons.append(dict(weaponId=weapon_id, source=source, renderFov=fovs))

    functions = []
    for start, end in [(0x14167d3d0,0x14167d5d6),(0x14169af70,0x14169b17c),
                       (0x141697450,0x141697774),(0x140d4f6b0,0x140d4f719),
                       (0x142d28d50,0x142d28dea),(0x140e14700,0x140e148aa),
                       (0x140dff730,0x140dff799),(0x140e9a320,0x140e9a329),
                       (0x140f2c790,0x140f2c904),(0x142d4db40,0x142d4df2c)]:
        path=ROOT/f'exports/camera-native/functions/{start:x}.c'
        raw=path.read_bytes()
        assert b'// Error: \n' in raw
        functions.append(dict(entry=hex(start),file=path.relative_to(ROOT).as_posix(),
            sha256=hashlib.sha256(raw).hexdigest(),nativeSpan=native.raw(start,end-start)))
    evidence = dict(evidenceId='BF2-FIRSTPERSON-PROJECTION-001', runtimeObserved=False,
        target=str(pe.TARGET),targetSha256=hashlib.sha256(pe.DATA).hexdigest(),sources=sources,
        observations=observations,links=links,functions=functions,
        fields=[native.field(*row) for row in [
            (0x144e05480,'WeaponZoomLevelData','RenderFov',0x44),
            (0x144e05498,'WeaponZoomLevelData','RenderFovTransition',0x18),
            (0x144dcaf10,'ModelDynamicState','RenderFovDeg',0x30),
            (0x144dcaef8,'ModelDynamicState','IsFirstPerson',0x3f),
            (0x144dcaf70,'ModelDynamicState','FieldFlagChanged0',0x38),
        ]],
        pointers=[native.pointer(*row) for row in [
            (0x144b76df0,0x1432f9640,'ModelDynamicState type name'),
            (0x144b76e40,0x144dcadc0,'ModelDynamicState field table'),
            (0x1434715a8+0x3c8,0x14169af70,'Soldier render-FOV getter'),
            (0x14331f0a8+0x18,0x140e9a320,'Active render-object manager model-state update dispatch'),
        ]],
        conclusions=[
            dict(id='selected-data', status='observed-configuration', text='Both selected SoldierWeaponData.ZoomLevels entries refer to WeaponZoomLevelData with RenderFov=55 and RenderFovTransition=null. Follow reference order, not object-number order.'),
            dict(id='weapon-getter',status='static-native',text='14167d3d0 reads the selected WeaponZoomLevelData+0x44 from instance array+0x3850. Its selected blend combines the same selected value on both sides. Initial source-array assignment is not part of this retained trace.'),
            dict(id='soldier-getter',status='static-native',text='14169af70 calls the active weapon render-FOV getter for a local first-person soldier, with optional separate user-scale blending. With explicitly selected user scale1 the output remains55. Other modes can return -1.'),
            dict(id='submit',status='static-native',text='141697450 calls Soldier virtual+0x3c8 and sends the result through140d4f6b0. It maps sentinel-1 to0. 140d4f6b0 writes ModelDynamicState.RenderFovDeg+0x30 and changed bit0x8000, then calls global1444ee678 virtual+0x18.'),
            dict(id='manager',status='static-native',text='140e14700 creates active manager via140dff730, whose vtable14331f0a8 virtual+0x18 is140e9a320. That thunk adjusts this+0x10 and dispatches140f2c790, whose changed-state application142d4db40 copies the +0x30 field when bit0x8000 is present.'),
        ],
        unknowns=[
            'Final renderer/GPU matrix consumer, weapon FOV axis, clipping/depth bias and native render-pass architecture remain untraced.',
            'Source weapon-array initial assignment and non-default user-scale interpolation have not been fully followed in this bounded package.',
            'No native runtime camera or render-object output has been observed.',
        ])
    evidence_path=Path(__file__).with_name('firstperson-projection-evidence.json')
    evidence_path.write_text(json.dumps(evidence,indent=2)+'\n')
    policy=dict(axis='vertical',axisStatus='inferred-from-recovered-world-camera-convention',userScale=1,
        composition='Apply a per-viewmodel clip-space XY projection correction in the existing world pass; independent rendering camera is only a CPU matrix calculator.',
        depth='Retain world near/far and clip-space Z/W. Native first-person depth/clipping composition remains unknown.',
        camera='Use existing world view transform and source camera-relative rig. No additional animation or camera recoil is applied.',
        offset='Symmetric perspective supported. Off-axis projection/jitter/view offsets are not recovered.')
    document=dict(schemaVersion=1,angleUnit='degrees',weapons=weapons,browserPolicy=policy,
        provenance=dict(evidenceId=evidence['evidenceId'],runtimeObserved=False,
            evidenceFile=evidence_path.relative_to(ROOT).as_posix(),
            evidenceSha256=hashlib.sha256(evidence_path.read_bytes()).hexdigest(),
            observed='Selected RenderFov55/55 and native per-model RenderFovDeg submission are established.',
            inferred='Vertical projection and Three clip-space XY correction are explicitly reconstructed; native renderer consumer is unresolved.'))
    (ROOT/'web/public/assets/firstperson-projection.json').write_text(json.dumps(document,indent=2)+'\n')
    print(f'Verified {len(observations)} source observations, {len(links)} links and {len(functions)} native consumers.')


if __name__ == '__main__':
    build()
