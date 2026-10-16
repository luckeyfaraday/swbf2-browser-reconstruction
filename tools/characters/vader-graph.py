"""Extract the Darth Vader (and HM force-choke victim) gameplay graph evidence.

Read-only. Source: the retained decoded EBX of
Gameplay/SoldierStateMachine/DefaultSoldierStateMachine (CharacterStateOwnerData),
plus the retained common ANT bank for ClipControllerAsset names.

For every CharacterState clip controller whose ClipInfos reference a selected ANT
ClipControllerAsset, this records the clip schedule (ClipInfos), the controller's
own keyframed channel tags, the AITrajectory/joint transform tracks, and the
structural parents (state-flow nodes, warp/clip-from-input controllers) with
their tags and resolved transitions. Times are graph ticks exactly as authored.
Output: exports/characters/vader-animation/graph.json
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EBX = ROOT / 'tools/gameplay-recovery/state/ebx/Gameplay_SoldierStateMachine_DefaultSoldierStateMachine__c2db59aa-7a78-11e6-8a92-99973984d771.json'
INVENTORY = ROOT / 'exports/characters/ant-common-bank/bank-inventory.json'
OUT = ROOT / 'exports/characters/vader-animation/graph.json'

# Selection rule for ANT controllers whose graph usage is extracted.
SELECT = re.compile(r'Vader|^A_HM_Rifle_Stunned_ForceChoke|^A_HM_Rifle_Stand_ChokeDeath|^A_HM_Death_Stand_(LightSaber|ForcePush)')
DAMAGE_CHANNELS = ('CharacterState.LightSaberDmg.Given.Dir.EnumGS', 'ExecuteKill')


def ant_key(guid):
    a, b, c = guid.split('-')[:3]
    return c + b + a


def main():
    ebx_bytes = EBX.read_bytes()
    doc = json.loads(ebx_bytes)
    objects = doc['asset']['objects']
    ids = {o['$id']: o for o in objects}
    inventory = json.loads(INVENTORY.read_text())
    ant = {s['object']['values'].get('__key'): s['object'] for s in inventory['sections'] if 'object' in s}
    selected = {k: o['values']['__name'] for k, o in ant.items()
                if o['type'] == 'ClipControllerAsset' and SELECT.search(o['values'].get('__name', ''))}

    parents = {}

    def collect(value, path, owner):
        if isinstance(value, dict):
            if '$ref' in value:
                parents.setdefault(value['$ref'], []).append((owner, path))
            for k, v in value.items():
                if k != '$ref':
                    collect(v, path + '/' + k, owner)
        elif isinstance(value, list):
            for i, v in enumerate(value):
                collect(v, path + '/' + str(i), owner)
    for o in objects:
        collect(o, '', o['$id'])

    def ref_name(ref):
        if not isinstance(ref, dict) or '$ref' not in ref:
            return None
        target = ids.get(ref['$ref'])
        if target is None:
            return {'unresolved': ref['$ref']}
        return target.get('Name') or target.get('JointName') or target.get('__Id')

    def ant_ref(ref):
        if not isinstance(ref, dict) or 'AssetGuid' not in ref or ref['AssetGuid'].startswith('00000000-0000-0000'):
            return None
        key = ant_key(ref['AssetGuid'])
        found = ant.get(key)
        return {'key': key, 'type': found['type'] if found else None,
                'name': found['values'].get('__name') if found else None}

    def keyframed(ref):
        if not isinstance(ref, dict) or '$ref' not in ref:
            return []
        c = ids[ref['$ref']]
        kind = c['$type'].split('.')[-1]
        if kind == 'CharacterStateKeyframedChannelControllerData':
            out = []
            for field in ('BoolChannelController', 'IntChannelController', 'FloatChannelController', 'Vec3ChannelController'):
                if c.get(field):
                    out += keyframed(c[field])
            return out
        tags = []
        for channel, track in zip(c.get('Channels', []), c.get('Tracks', [])):
            name = ref_name(channel)
            if kind == 'CharacterStateKeyframedFloatChannelControllerData':
                for tag in track.get('FloatTags', []):
                    keys = tag.get('Keyframes', [])
                    tags.append({'channel': name, 'type': 'float', 'time': tag.get('Time', keys[0]['Time'] if keys else 0),
                                 'length': tag.get('Duration'), 'resetValue': tag.get('ResetValue'),
                                 'resetMode': (tag.get('ResetMode') or {}).get('name'),
                                 'copyFrom': ref_name(tag.get('CopyFrom')),
                                 'curve': [[k['Time'], k['Value']] for k in keys if k.get('On', True)]})
                continue
            if kind == 'CharacterStateKeyframedVec3ChannelControllerData':
                tags.append({'channel': name, 'type': 'vec3', 'raw': track})
                continue
            for kf in track.get('Keyframes', []):
                tags.append({'channel': name, 'type': 'bool' if 'Bool' in kind else 'int', 'time': kf['Time'],
                             'length': kf['Length'], 'value': kf['Value'], 'resetValue': kf.get('ResetValue'),
                             'mode': (kf.get('Mode') or {}).get('name'), 'resetMode': (kf.get('ResetMode') or {}).get('name'),
                             'copyFrom': ref_name(kf.get('CopyFrom'))})
        return tags

    def transform_tracks(ref):
        if not isinstance(ref, dict) or '$ref' not in ref:
            return []
        c = ids[ref['$ref']]
        out = []
        for channel, track in zip(c.get('Channels', []), c.get('Tracks', [])):
            ch = ids.get(channel['$ref'], {})
            keys = track.get('Keyframes', [])
            out.append({'joint': ch.get('JointName'), 'isDelta': ch.get('IsDeltaChannel'),
                        'ticks': [k['Time'] for k in keys],
                        'translation': [[k['Value']['trans'][a] for a in 'xyz'] for k in keys],
                        'forward': [[k['Value']['forward'][a] for a in 'xyz'] for k in keys]})
        return out

    def condition(t):
        kind = (t.get('ConditionType') or {}).get('name')
        d = {'type': kind, 'startTick': t.get('StartTick'), 'length': t.get('Length'),
             'alwaysActive': t.get('AlwaysActive'), 'invert': t.get('Invert'),
             'target': ref_name(t.get('Target')), 'blend': ref_name(t.get('Blend'))}
        if kind and 'Int' in kind:
            d.update(channel=ref_name(t.get('IntChannel')), value=t.get('IntValue'), compare=(t.get('NumericCompareMode') or {}).get('name'))
        elif kind and 'Float' in kind:
            d.update(channel=ref_name(t.get('FloatChannel')), value=t.get('FloatValue'), compare=(t.get('NumericCompareMode') or {}).get('name'))
        elif kind and 'Bool' in kind:
            d.update(channel=ref_name(t.get('BoolChannel1')), channel2=ref_name(t.get('BoolChannel2')),
                     compare=(t.get('BoolCompareMode') or {}).get('name'))
        if t.get('ChildConditions'):
            d['children'] = [condition(c) for c in t['ChildConditions']]
        return d

    def scalars(o):
        keep = {}
        for k, v in o.items():
            if k in ('$type', '$id', '__Id', '__InstanceGuid', 'Transitions', 'ClipInfos', 'Subjects', 'ChannelControllers',
                     'ChannelController', 'TransformChannelController', 'ChildControllerExtractedInfo', 'LayerInfos'):
                continue
            if isinstance(v, (int, float, str, bool)) or v is None:
                keep[k] = v
            elif isinstance(v, dict) and '$ref' in v:
                keep[k] = ref_name(v)
            elif isinstance(v, dict) and v.get('$type') == 'FrostySdk.Ebx.AntRef':
                keep[k] = ant_ref(v)
            elif isinstance(v, dict) and v.get('$type') == 'FrostySdk.Ebx.Vec3':
                keep[k] = [v['x'], v['y'], v['z']]
            elif isinstance(v, dict) and '$enum' in v:
                keep[k] = v['name']
            elif isinstance(v, dict):
                keep[k] = {kk: vv for kk, vv in v.items() if kk != '$type' and not isinstance(vv, (dict, list))} or None
        return keep

    def node_record(o):
        rec = {'id': o['$id'], 'type': o['$type'].split('.')[-1], 'name': o.get('Name'), 'fields': scalars(o)}
        tags = []
        for r in o.get('ChannelControllers') or []:
            tags += keyframed(r)
        if o.get('ChannelController'):
            tags += keyframed(o['ChannelController'])
        if tags:
            rec['tags'] = tags
        if o.get('Transitions'):
            rec['transitions'] = [condition(t) for t in o['Transitions']]
        if o.get('Subjects'):
            rec['subjects'] = [ref_name(s) for s in o['Subjects']]
        return rec

    def structural_parents(i):
        return [p for p, path in parents.get(i, []) if not path.startswith('/AllControllerDatas') and '/Transitions/' not in path]

    usages = []
    for o in objects:
        infos = o.get('ClipInfos') or []
        hits = []
        for index, ci in enumerate(infos):
            r = ant_ref(ci.get('Controller'))
            if r and r['key'] in selected:
                hits.append(index)
        if not hits:
            continue
        rec = node_record(o)
        rec['controller'] = ant_ref(o.get('Controller'))
        rec['clipInfos'] = []
        for index, ci in enumerate(infos):
            item = {k: v for k, v in ci.items() if k not in ('$type', 'Controller')}
            item['ant'] = ant_ref(ci.get('Controller'))
            item['index'] = index
            rec['clipInfos'].append(item)
        rec['transformTracks'] = transform_tracks(o.get('TransformChannelController'))
        chain, frontier, seen = [], [o['$id']], {o['$id']}
        for depth in range(2):
            nxt = []
            for i in frontier:
                for p in structural_parents(i):
                    if p in seen:
                        continue
                    seen.add(p)
                    pr = node_record(ids[p])
                    pr['depth'] = depth + 1
                    chain.append(pr)
                    # Only climb through single-purpose wrappers; shared hubs fan out widely.
                    if pr['type'] in ('CharacterStateWarpClipControllerData', 'CharacterStateClipFromInputControllerData',
                                      'CharacterStateStateFlowControllerData') or (pr['name'] or '').startswith('HeroMelee.Vader'):
                        nxt.append(p)
            frontier = nxt
        rec['parents'] = chain
        usages.append(rec)

    vader_named = [node_record(o) for o in objects if 'Vader' in (o.get('Name') or '')
                   and o['$type'].split('.')[-1] not in ('CharacterStateClipControllerData',)]
    # Victim choke nodes (state-flow nodes owning the HM ForceChoke PhysCtrl clips) are captured through usages.
    damage = []
    for u in usages:
        nodes = [u] + [p for p in u['parents'] if p['type'] == 'CharacterStateStateFlowNodeControllerData']
        for n in nodes:
            for t in n.get('tags', []):
                if t['channel'] in DAMAGE_CHANNELS:
                    damage.append({'usage': u['id'], 'node': n['name'], 'channel': t['channel'], 'startTick': t['time'],
                                   'lengthTicks': t['length'], 'value': t.get('value')})
    report = {
        'evidenceId': 'BF2-VADER-GRAPH-001',
        'source': {'file': str(EBX.relative_to(ROOT)).replace('\\', '/'), 'name': doc['entry']['name'],
                   'sha1': doc['entry'].get('sha1'), 'jsonSha256': hashlib.sha256(ebx_bytes).hexdigest()},
        'antInventory': str(INVENTORY.relative_to(ROOT)).replace('\\', '/'),
        'selection': SELECT.pattern,
        'timeUnit': 'graph ticks as authored (StartTick/Length/Time). Seconds are not stored in this asset.',
        'usages': usages,
        'vaderNamedObjects': vader_named,
        'damageTagSummary': damage,
        'limitations': [
            'Decoded installed EBX fields only; native graph evaluation, blend math and tick rate were not observed.',
            'Parents are climbed two levels through wrappers only; shared hub controllers are not expanded.',
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, separators=(',', ':')))
    print(json.dumps({'output': str(OUT), 'bytes': OUT.stat().st_size, 'usages': len(usages),
                      'vaderNamedObjects': len(vader_named), 'damageTags': len(damage)}, indent=2))


if __name__ == '__main__':
    main()
