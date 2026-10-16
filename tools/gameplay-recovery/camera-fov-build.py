"""Verify selected zoom configuration and bounded native FOV consumers."""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('native', HERE/'projectile-native-evidence.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
pe = native.pe


def build():
    sources, observations, links = {}, [], []

    def load(pattern):
        paths = list(ROOT.glob(pattern))
        assert len(paths) == 1, pattern
        raw = paths[0].read_bytes()
        doc = json.loads(raw)
        assert not doc['asset'].get('errors')
        source = dict(file=paths[0].relative_to(ROOT).as_posix(), name=doc['entry']['name'],
                      guid=doc['entry']['guid'], sha1=doc['entry']['sha1'], jsonSha256=hashlib.sha256(raw).hexdigest())
        sources[source['guid']] = source
        doc['_source'] = source
        return doc

    def observe(doc, obj, key):
        index = doc['asset']['objects'].index(obj)
        observations.append(dict(sourceGuid=doc['_source']['guid'], objectId=obj['$id'],
            jsonPointer=f'/asset/objects/{index}/{key}', value=obj[key], runtimeObserved=False))
        return obj[key]

    def external(doc, obj, key, other, target):
        value = observe(doc, obj, key)
        assert value['$external'] == other['_source']['guid'] and value['classGuid'] == target['$id']
        links.append(dict(sourceGuid=doc['_source']['guid'], objectId=obj['$id'], field=key,
                          targetSourceGuid=other['_source']['guid'], targetObjectId=target['$id']))

    def function(entry, end):
        path = ROOT/f'exports/camera-native/functions/{entry:x}.c'
        raw = path.read_bytes()
        assert b'// Error: \n' in raw
        return dict(entry=hex(entry), file=path.relative_to(ROOT).as_posix(), sha256=hashlib.sha256(raw).hexdigest(),
                    nativeSpan=native.raw(entry, end-entry))

    def constant(address, value):
        actual = struct.unpack_from('<f', pe.DATA, pe.offset(address))[0]
        assert abs(actual-value) < 1e-6
        return dict(value=actual, record=native.raw(address,4))

    def imported(thunk, name):
        off = pe.offset(thunk)
        assert pe.DATA[off:off+2] == b'\xff\x25'
        slot = thunk+6+struct.unpack_from('<i',pe.DATA,off+2)[0]
        hint_name = pe.BASE+struct.unpack_from('<Q',pe.DATA,pe.offset(slot))[0]
        start = pe.offset(hint_name)+2
        actual = pe.DATA[start:pe.DATA.index(b'\0',start)].decode()
        assert actual == name
        return dict(name=name, thunk=native.raw(thunk,6), slot=native.raw(slot,8),
                    hintName=native.raw(hint_name,len(name)+3))

    aiming_doc = load('tools/gameplay-recovery/detail/ebx/*AimingController_Default_Short_ZoomOverlay__*.json')
    aiming = next(o for o in aiming_doc['asset']['objects'] if o['$type'].endswith('.SoldierAimingSimulationData'))
    zoom_docs = [load('tools/gameplay-recovery/state/ebx/*ZoomLevel_0_Default__*.json'),
                 load('tools/gameplay-recovery/state/ebx/*ZoomLevel_1_Default_Short_UseZoomMesh__*.json')]
    transition_doc = load('exports/weapon-handling-support/ebx/*FOVTransition_Default__*.json')
    transition = next(o for o in transition_doc['asset']['objects'] if o['$type'].endswith('.FOVTransitionData'))
    zoom_refs = observe(aiming_doc, aiming, 'ZoomLevels')
    zoom_levels = []
    for ref, doc in zip(zoom_refs,zoom_docs,strict=True):
        assert ref['$external'] == doc['_source']['guid']
        zoom = next(o for o in doc['asset']['objects'] if o['$id'] == ref['classGuid'])
        values = {key:observe(doc,zoom,key) for key in ['FieldOfView','FieldOfViewSP','AllowFieldOfViewScaling']}
        external(doc,zoom,'FieldOfViewTransition',transition_doc,transition)
        zoom_levels.append(dict(source=doc['_source'],objectId=zoom['$id'],**values))
    assert [z['FieldOfView'] for z in zoom_levels] == [55,23.9]
    transition_values = {key:observe(transition_doc,transition,key) for key in
                         ['TransitionType','Shape','Invert','StartDelay','StartJump','EndEarly']}
    assert transition_values['TransitionType']['value'] == 1
    assert [transition_values[k] for k in ['Shape','Invert','StartDelay','StartJump','EndEarly']] == [2,False,0,0,0]
    timing = {key:observe(aiming_doc,aiming,key) for key in ['FovTransitionTime','ZoomTransitionTime','FovDelayTime','UpdateCameraFOV']}
    assert timing == dict(FovTransitionTime=.2,ZoomTransitionTime=.2,FovDelayTime=0,UpdateCameraFOV=True)
    weapons = []
    for weapon_id, pattern in [('primary','tools/gameplay-recovery/e11-root/ebx/*W_BlasterRifle_E11__*.json'),
                               ('rebel-a280','exports/faction-rebel-weapon/ebx/*W_BlasterRifle_A280__*.json')]:
        doc = load(pattern)
        weapon = next(o for o in doc['asset']['objects'] if o['$type'].endswith('.SoldierWeaponData'))
        external(doc,weapon,'AimingController',aiming_doc,aiming)
        render_levels = []
        for ref in observe(doc,weapon,'ZoomLevels'):
            zoom = next(o for o in doc['asset']['objects'] if o['$id'] == ref['$ref'])
            render_levels.append(observe(doc,zoom,'RenderFov'))
        assert render_levels == [55,55]
        weapons.append(dict(weaponId=weapon_id,source=doc['_source'],weaponRenderFov=render_levels))
    functions = [function(a,b) for a,b in [
        (0x141685f30,0x1416861dc),(0x141695bf0,0x141695d6c),(0x141691120,0x141691320),
        (0x1416a3acd,0x1416a3ff8),(0x140b96e20,0x140b96e49),
        (0x140964130,0x140964162),(0x140956370,0x140956421),(0x140963e30,0x140963e65),
        (0x14095ceb0,0x14095cf29),(0x1409564a0,0x140956835),(0x140963e70,0x140963eaf),
        (0x145e19990,0x145e19a0e),(0x14095f520,0x14095f57f),
        (0x1409faec0,0x1409fb044),(0x1409f83a0,0x1409f8550),
        (0x145e17890,0x145e1795b),(0x14024ada0,0x14024b246),
        (0x140960d00,0x1409610d8),(0x1409678e0,0x140967d50),
    ]]
    evidence = dict(evidenceId='BF2-CAMERA-FOV-NATIVE-001',runtimeObserved=False,
        target=str(pe.TARGET),sha256=hashlib.sha256(pe.DATA).hexdigest(),
        fields=[native.field(*args) for args in [
            (0x144e03170,'ZoomLevelData','FieldOfView',0x28),
            (0x144e03188,'ZoomLevelData','FieldOfViewSP',0x2c),
            (0x144e031a0,'ZoomLevelData','FieldOfViewTransition',0x18),
            (0x144e031b8,'ZoomLevelData','AllowFieldOfViewScaling',0x94),
            (0x144e05480,'WeaponZoomLevelData','RenderFov',0x44),
            (0x144e042f8,'SoldierAimingSimulationData','ZoomTransitionTime',0x78),
            (0x144e04358,'SoldierAimingSimulationData','FovTransitionTime',0x80),
            (0x144e04328,'SoldierAimingSimulationData','UpdateCameraFOV',0x8e),
            (0x144db9340,'FOVTransitionData','TransitionType',0x18),
            (0x144db9358,'FOVTransitionData','Shape',0x1c),
            (0x144db9370,'FOVTransitionData','Invert',0x2c),
            (0x144db9388,'FOVTransitionData','StartDelay',0x20),
            (0x144db93a0,'FOVTransitionData','StartJump',0x24),
            (0x144db93b8,'FOVTransitionData','EndEarly',0x28),
        ]],
        pointers=[native.pointer(*args) for args in [
            (0x14320f5f0+0x38,0x140963e30,'Camera manager set-FOV dispatch'),
            (0x14320f5f0+0x78,0x14095ceb0,'Find camera by player and view indices'),
            (0x14320f538+0x30,0x140963e70,'Camera FOV transition setter'),
            (0x14320f538+0x38,0x145e19990,'Camera effective FOV getter'),
            (0x14320f538+0x98,0x145e17890,'Camera frustum writer'),
        ]],
        constants=[constant(a,v) for a,v in [(0x14303caf4,.8),(0x14301a310,2),
                    (0x14301ee88,3.141592653589793),(0x14302cd08,1/180),(0x14301a30c,.5)]],
        imports=[imported(0x141e73002,'tanf'),imported(0x141e73026,'powf')],functions=functions,
        observations=observations,links=links,sources=list(sources.values()),
        findings=[
            'Selected ZoomLevelData.FieldOfView is read at +0x28; SP override +0x2c is conditional and negative values fall back. Selected MP values are 55 and 23.9.',
            'User scale getter 0x140b96e20 clamps its input to 0.8..2. Zoom scaling is gated by AllowFieldOfViewScaling and FieldOfViewScaleADS; hip scaling does not require ADS enabled. The zoom transition target uses max(scale,1) when entering a higher zoom index.',
            'The aiming transition request reaches camera-manager virtual+0x38, dispatches to the selected camera virtual+0x30, copies target/timing/curve values and captures the current unscaled FOV as transition start.',
            'Camera update 0x1409faec0 samples elapsed/duration before adding dt and linearly blends start/target degrees by curve weight, then adds the separate offset. Selected Smooth Shape2 in 0x1409f83a0 evaluates 3*t^2-2*t^3 with zero start delay/jump/end-early and no inversion.',
            'Camera frustum writer 0x145e17890 converts the effective getter degrees by pi/180. Builder 0x14024ada0 computes tanf(FOV/2), uses this for vertical planes and multiplies it by aspect for horizontal planes: the angle is vertical.',
            'Render preparation 0x140960d00 uses the same getter, adds a separate camera FOV offset, converts to radians and writes camera+0x1f18. 0x1409678e0 submits that radians value and aspect separately to the renderer view update.',
        ],
        limitations=[
            'Static native and serialized configuration evidence, not native runtime observation.',
            'Browser camera uses explicit userScale=1 by default; actual user settings are not read. Scene camera overrides, cinematics, additional FOV offsets, renderer postprocessing and view allocation are outside this helper.',
            'WeaponZoomLevelData.RenderFov is retained separately. Its first-person render-projection composition and attachment transforms are not established here.',
            'Native update samples old elapsed then increments; browser call ordering remains reconstruction. No claim about native frame rate is made.',
            'Aiming transition reversal can adjust native remaining timers; the browser helper captures the displayed current value and restarts the source duration. This interrupted-transition policy is explicit reconstruction.',
        ])
    evidence_path = HERE/'camera-fov-evidence.json'
    evidence_path.write_text(json.dumps(evidence,indent=2)+'\n')
    provenance = dict(evidenceId=evidence['evidenceId'],evidenceFile=evidence_path.relative_to(ROOT).as_posix(),
        evidenceSha256=hashlib.sha256(evidence_path.read_bytes()).hexdigest(),runtimeObserved=False,
        sourceDerived=['camera.fov','camera.aimFov','camera.fovAxis','camera.fovTransitionTime','camera.fovTransitionCurve'],
        reconstructed=['Browser scheduling','Default userScale=1','Interrupted transition restarts from displayed FOV'],
        limitations=evidence['limitations'])
    output = ROOT/'web/public/assets/camera-fov.json'
    output.write_text(json.dumps(dict(schemaVersion=1,weapons=weapons,axis='vertical',angleUnit='degrees',
        zoomLevels=zoom_levels,timing=timing,transition=transition_values,
        userScale=dict(min=.8,max=2,default=1,defaultIsReconstruction=True,adsSetting='FieldOfViewScaleADS'),
        provenance=provenance),indent=2)+'\n')
    print(json.dumps(dict(output=output.relative_to(ROOT).as_posix(),observations=len(observations),functions=len(functions))))


if __name__ == '__main__':
    build()
