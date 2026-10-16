"""Bounded source ADS recovery: selected ANT graphs, poses and DCT samples.

Only new ads-* outputs are written. No playback seconds or pose offsets are
invented. DCT arithmetic is cross-checked against the retained upstream decoder.
"""
import hashlib
import json
from pathlib import Path
from importlib.machinery import SourceFileLoader
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
pose = SourceFileLoader('ads_pose', str(ROOT / 'tools/characters/firstperson-decode-poses.py')).load_module()
dct = SourceFileLoader('ads_dct', str(ROOT / 'tools/characters/firstperson-decode-dct.py')).load_module()
bank = pose.bank
OUT = ROOT / 'exports/firstperson-ads'
PUBLIC = ROOT / 'web/public/assets/firstperson-ads.json'
SELECTORS = {'pose': '5b687ee1ea1c74d4', 'enter': '25b9759699a52653', 'exit': 'eb2c91f8d16d37eb'}
NODES = {'pose': 'b2734f5424fc5f4e', 'enter': '4980525082f6f0ec', 'exit': '48055b5e2116b087'}
LAYERS = {'pose': 'd23cc178d65727ef', 'enter': 'd81a5b5b45b96bba', 'exit': '3c6a0ca68b1ea4fc'}
used = set()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def obj(key):
    used.add(key)
    return bank.objects[key]


def expanded(key):
    o = obj(key)
    return {**o, 'arrays': {k: bank.array(v) for k, v in o['values'].items()
                           if isinstance(v, dict) and 'arrayOffset' in v
                           and v['elementType'] in ['Key', 'Float', 'UInt32', 'UInt16', 'Int16', 'UInt8', 'LayoutEntry']}}


def decode(controller_key):
    controller = obj(controller_key)
    animation = obj(controller['values']['Anim'])
    name = controller['values']['__name']
    base = animation['base']['values']
    assert not base['Additive']
    for key in [base['ChannelToDofAsset'], base['DofSetList']]:
        obj(key)
    if animation['type'] == 'FrameAnimationAsset':
        result = pose.decode(name)
        result['sourceKind'] = animation['type']
        result['animationBase'] = base
        return result
    assert animation['type'] == 'DctAnimationAsset'
    values = {k: bank.array(v) if isinstance(v, dict) and 'arrayOffset' in v else v
              for k, v in animation['values'].items()}
    samples, validation = dct.decompress(values)
    mapping, _, _ = bank.channels(animation)
    assert len(mapping) == values['NumQuats'] + values['NumVec3']
    assert np.isfinite(samples).all()
    tracks, unmapped = [], []
    for channel, dofid in enumerate(mapping):
        prop = 'rotation' if channel < values['NumQuats'] else 'translation'
        slot = pose.dofs.get(dofid)
        if slot is None:
            unmapped.append({'channel': channel, 'dofId': dofid, 'property': prop,
                             'rawVec4': samples[:, channel].tolist()})
            continue
        assert slot['type'] == (14 if prop == 'rotation' else 2049856663)
        tracks.append({'bone': slot['name'].rsplit('.', 1)[0], 'property': prop,
                       'sourceChannelIndex': channel, 'sourceDofId': dofid, 'sourceSlot': slot,
                       'values': samples[:, channel, :4 if prop == 'rotation' else 3].tolist()})
    source_path = OUT / (name + '.source.json')
    source_path.write_text(json.dumps({'controller': controller, 'animation': animation, 'arrayValues': values}, indent=2))
    samples.tofile(OUT / (name + '.python.f32'))
    reference = ROOT / 'tools/characters/firstperson-dct-reference/bin/Release/net8.0/firstperson-dct-reference.dll'
    reference_path = OUT / (name + '.reference.f32')
    subprocess.run(['dotnet', str(reference), str(source_path), str(reference_path)], check=True, capture_output=True)
    assert samples.tobytes() == reference_path.read_bytes(), name
    validation.update({'floatCount': int(samples.size), 'exactIndependentReferenceBytes': True,
                       'decodedSha256': sha(samples.tobytes()), 'referenceAssemblySha256': sha(reference.read_bytes()),
                       'rawQuaternionNormMin': float(np.linalg.norm(samples[:, :values['NumQuats']], axis=2).min()),
                       'rawQuaternionNormMax': float(np.linalg.norm(samples[:, :values['NumQuats']], axis=2).max())})
    assert .99 < validation['rawQuaternionNormMin'] <= validation['rawQuaternionNormMax'] < 1.01
    return {'name': name, 'sourceName': name, 'sourceAnimationKey': animation['values']['__key'],
            'sourceKind': animation['type'], 'controller': controller['values'], 'animationBase': base,
            'sourceKeyTimes': values['KeyTimes'], 'tracks': tracks, 'unmapped': unmapped,
            'sourceCounts': [values['NumQuats'], values['NumVec3'], values['NumFloat']],
            'additive': False, 'validation': validation}


def main():
    OUT.mkdir(exist_ok=True)
    assert sha(bank.data) == bank.metadata['sha256']
    enum = obj('ae246dda461c1791')['values']
    enum_state = obj('a4126ad0a5adbce4')['values']
    assert enum['ZeroBasedSequential'] and enum_state['EnumerationAsset'] == enum['__key']
    enum_values = bank.array(enum['EnumerationValues'])
    graph = {'stateFlow': expanded('fe03b295e4783abc'), 'enum': expanded(enum['__key']),
             'enumState': expanded(enum_state['__key']), 'selectors': {}, 'nodes': {}, 'layers': {}, 'records': {}}
    for role, key in SELECTORS.items():
        selector = expanded(key)
        assert selector['values']['IndexAsset'] == enum_state['__key']
        graph['selectors'][role] = selector
        graph['nodes'][role] = expanded(NODES[role])
        graph['layers'][role] = expanded(LAYERS[role])
        assert graph['nodes'][role]['values']['SubjectController'] == LAYERS[role]
        assert graph['nodes'][role]['values']['StateFlowController'] == 'fe03b295e4783abc'
        # Retain all conditions and transition metadata for these three nodes.
        for field in ['EntryConditionsRequiredTrue', 'EntryConditionsRequiredFalse', 'Transitions', 'AllTransitionConditions']:
            for child in graph['nodes'][role]['arrays'][field]:
                graph['records'][child] = expanded(child)
        for child in graph['layers'][role]['arrays']['ControllerAssets']:
            graph['records'][child] = expanded(child)
    for key in ['ac142f23ca6ebac7', 'f97ee0018ba490ec', '810e7e7b2001fab6', '800b38e95d3a6ca6',
                '821e86611d4eb659', 'bf9702ac174010c6', '2dca38a46182004c']:
        graph['records'][key] = expanded(key)
    slots = graph['records']['2dca38a46182004c']['arrays']['Slots']
    weights = graph['records']['bf9702ac174010c6']['arrays']['Values']
    assert len(slots) == len(weights)
    mask = [{'slot': s['name'], 'weight': w} for s, w in zip(slots, weights) if w != 0]
    assert all(x['weight'] == 1 and x['slot'].startswith('Wep_Bipod') for x in mask)
    weapons = {}
    for weapon, index, source_pattern in [
        ('e11', 17, 'tools/gameplay-recovery/e11-root/ebx/*W_BlasterRifle_E11*.json'),
        ('a280', 28, 'exports/faction-rebel-weapon/ebx/*W_BlasterRifle_A280*.json')]:
        enumerator = obj(enum_values[index])
        assert enumerator['values']['__name'].lower() == weapon and enumerator['values']['Value'] == index
        graph['records'][enum_values[index]] = expanded(enum_values[index])
        clips = {role: decode(graph['selectors'][role]['arrays']['ChoiceAssetList'][index]) for role in SELECTORS}
        path, = ROOT.glob(source_pattern)
        raw = path.read_bytes()
        source = json.loads(raw.decode('utf-8-sig'))
        data = next(o for o in source['asset']['objects'] if o['$type'] == 'FrostySdk.Ebx.SoldierWeaponData')
        zooms = [next(o for o in source['asset']['objects'] if o['$id'] == r['$ref']) for r in data['ZoomLevels']]
        assert data['AnimBaseSet']['name'] == 'wabsRif'
        idle = pose.decode('P_1p_' + weapon.upper() + '_IdlePose')
        obj(idle['controller']['__key'])
        obj(idle['sourceAnimationKey'])
        masked_slots = {m['slot'] for m in mask}
        idle_overrides = [t for t in idle['tracks'] if t['sourceSlot']['name'] in masked_slots]
        assert len(idle_overrides) == 6
        weapons[weapon] = {'weaponId': 'primary' if weapon == 'e11' else 'rebel-a280',
                           'specificWeaponEnum': index, 'enumeratorKey': enum_values[index], 'clips': clips,
                           'sourceWeapon': {'file': path.relative_to(ROOT).as_posix(), 'sha256': sha(raw),
                                            'guid': source['entry']['guid'], 'objectId': data['$id'],
                                            'animBaseSet': data['AnimBaseSet'], 'weaponAntRef': data['WeaponStates'][0]['Weapon'],
                                            'orderedZoomAnimationSettings': [z['AnimationSettings'] for z in zooms]},
                           'idleOverrideMask': mask, 'idleOverrideTracks': idle_overrides}
    ranges = []
    for s in bank.metadata['sections']:
        if s.get('object', {}).get('values', {}).get('__key') in used:
            ranges.append({'key': s['object']['values']['__key'], 'type': s['object']['type'],
                           'name': s['object']['values']['__name'], 'offset': s['offset'], 'bytes': s['bytes'],
                           'sha256': sha(bank.data[s['offset']:s['offset'] + s['bytes']])})
    evidence = {'evidenceId': 'BF2-FIRSTPERSON-ADS-001', 'runtimeObserved': False,
                'source': {'file': 'exports/characters/ant-common-bank/0.res', 'sha256': sha(bank.data),
                           'bytes': len(bank.data), 'ranges': ranges}, 'graph': graph,
                'rigKey': pose.rig_key, 'rigName': pose.rig['__name'], 'weapons': weapons,
                'known': ['SpecificWeapon.Enum E11=17 and A280=28 select the exact source ZoomPose, ZoomIn and ZoomOut controllers.',
                          '1P.Actions.SF has ZoomIn, IronSight and ZoomOut nodes routing through the recovered master layers.',
                          'IronSight entry requires Game.Character.Zoom.Bool. ZoomOut entry requires it false.',
                          'Master layers preserve six idle pose channels for Wep_Bipod1/2/3 only.',
                          'All selected clips are non-additive. Frame poses preserve source floats; DCT samples exactly match the independently compiled upstream decoder.'],
                'limitations': ['The weapon-specific ANT assembler referenced by WeaponStates[0].Weapon is absent from the common bank; its runtime write to SpecificWeapon.EnumGS is not observed.',
                                'Full ANT state transitions, tag branches, procedural spring/IK and camera composition are not executed here.',
                                'FPS, TimeScale, TrimOffset and TrimmedDuration are source fields, not a proven seconds equation. Normalized sample phase is suitable for an explicitly reconstructed timing policy.',
                                'A280 unlabelled Vec3 DOFs are retained separately. Quaternion normalization is a renderer conversion, not a modification to the raw evidence.',
                                'Use the existing source camera conversion without guessed translation offsets; changing CameraJoint needs separate camera composition evidence.']}
    (OUT / 'evidence.json').write_text(json.dumps(evidence, indent=2))
    public = {k: evidence[k] for k in ['evidenceId', 'runtimeObserved', 'rigKey', 'rigName', 'weapons', 'known', 'limitations']}
    public['source'] = {k: evidence['source'][k] for k in ['file', 'sha256', 'bytes']}
    public['evidenceFile'] = 'exports/firstperson-ads/evidence.json'
    public['evidenceSha256'] = sha((OUT / 'evidence.json').read_bytes())
    PUBLIC.write_text(json.dumps(public, separators=(',', ':')))
    print(json.dumps({'output': str(PUBLIC), 'bytes': PUBLIC.stat().st_size,
                      'weapons': {k: {r: {'name': c['name'], 'tracks': len(c['tracks']), 'samples': len(c.get('sourceKeyTimes', [0]))}
                                      for r, c in w['clips'].items()} for k, w in weapons.items()}}, indent=2))


if __name__ == '__main__':
    main()
