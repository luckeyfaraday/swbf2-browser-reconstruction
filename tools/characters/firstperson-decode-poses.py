"""Decode retained BF2 FrameAnimationAsset first-person poses without invented keys."""
import hashlib
import json
import math
from pathlib import Path
from importlib.machinery import SourceFileLoader

ROOT = Path(__file__).resolve().parents[2]
select = SourceFileLoader('firstperson_select', str(ROOT / 'tools/characters/select-animation.py')).load_module()
bank = select.AnimationBank('exports/characters/ant-common-bank')
rig_key = 'ce0e5ba5ab202d65'
rig = bank.objects[rig_key]['values']
ids = bank.array(rig['DofIds'])
dofs = {}
for key, offset in zip(bank.array(rig['RigDofSets']), bank.array(rig['DofSetIdIndices'])):
    layout = bank.objects[key]['values']
    if 'Slots' not in layout:
        continue
    for n, slot in enumerate(bank.array(layout['Slots'])):
        dofs[ids[offset + n]] = {**slot, 'layout': layout['__name'], 'layoutKey': key}


def decode(name):
    controllers = [o['values'] for o in bank.objects.values()
                   if o['type'] == 'ClipControllerAsset' and o['values']['__name'] == name]
    assert len(controllers) == 1, (name, len(controllers))
    controller = controllers[0]
    anim = bank.objects[controller['Anim']]
    v = anim['values']
    assert anim['type'] == 'FrameAnimationAsset'
    assert not anim['base']['values']['Additive']
    mapping, _, _ = bank.channels(anim)
    q, t, f = (v[k] for k in ('QuatCount', 'Vec3Count', 'FloatCount'))
    data = bank.array(v['Data'])
    assert len(mapping) == q + t + f
    assert len(data) == q * 4 + t * 4 + f
    tracks, unmapped, errors = [], [], []
    # FrameAnimationAsset contains no channel permutation: the source DOF table
    # itself is ordered quaternion/vec3/scalar. Verify EVERY mapped slot type.
    for index, dofid in enumerate(mapping):
        if index < q:
            offset, size, prop, typ = index * 4, 4, 'rotation', 14
        elif index < q + t:
            offset, size, prop, typ = q * 4 + (index - q) * 4, 3, 'translation', 2049856663
        else:
            offset, size, prop, typ = q * 4 + t * 4 + index - q - t, 1, 'scalar', 10
        values = data[offset:offset + size]
        assert all(math.isfinite(x) for x in values)
        if prop == 'rotation':
            errors.append(abs(sum(x * x for x in values) - 1))
        slot = dofs.get(dofid)
        if not slot:
            unmapped.append({'dofId': dofid, 'property': prop, 'values': values})
            continue
        assert slot['type'] == typ, (name, index, prop, slot)
        tracks.append({'bone': slot['name'].rsplit('.', 1)[0], 'property': prop,
                       'sourceChannelIndex': index, 'sourceFloatOffset': offset,
                       'sourceDofId': dofid, 'sourceSlot': slot, 'constant': True, 'values': [values]})
    assert max(errors, default=0) < 0.0001
    return {'name': name, 'sourceName': name, 'sourceAnimationKey': controller['Anim'],
            'controller': controller, 'sourceByteRange': v['Data'], 'additive': False,
            'duration': 0, 'times': [0], 'tracks': tracks, 'unmapped': unmapped,
            'rawCounts': [q, t, f], 'maxQuaternionNormError': max(errors, default=0)}


if __name__ == '__main__':
    clips = [decode(f'P_1p_{weapon}_{pose}Pose') for weapon in ('E11', 'A280') for pose in ('Idle', 'Sprint')]
    out = {'evidenceId': 'BF2-FIRSTPERSON-POSE-001', 'sourceBank': bank.metadata['source'],
           'sourceSha256': bank.metadata['sha256'], 'sourceRig': rig['__name'], 'sourceRigKey': rig_key,
           'clips': clips, 'limitations': [
               'These are observed single-frame non-additive source poses, not reconstructed moving clips.',
               'All decoded channel slot types, float bounds and quaternion norms are checked. Native blend graph execution is unobserved.',
               'DCT firing, deploy, zoom, procedural IK and camera motion are not decoded or reconstructed here.']}
    path = ROOT / 'exports/firstperson-animation/poses.json'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, separators=(',', ':')))
    print(json.dumps({'path': str(path), 'clips': [
        {k: c[k] for k in ('name', 'sourceAnimationKey', 'rawCounts', 'unmapped', 'maxQuaternionNormError')}
        for c in clips]}, indent=2))
