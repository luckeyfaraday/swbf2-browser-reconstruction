# SPDX-License-Identifier: GPL-3.0-or-later
# DCT sample decoding is delegated, unmodified, to firstperson-decode-dct.py, whose
# algorithm is adapted from marv7000/AssetBankPlugin (GPL-3.0); see assetbank-reference/.
"""Decode Darth Vader third-person clips and HM hero-victim clips from the retained ANT bank.

Read-only with respect to every existing file. Reuses:
  * decode-animation.py: retained bank, Walrus_HM_Rig DOF table (3P), raw decoder (regression oracle)
  * firstperson-decode-dct.py: the byte-verified DCT coefficient decoder, called unmodified

Generalizations (new code, verified against the reused code where both apply):
  * raw clips whose per-key record is padded to a multiple of four floats
  * DCT clips with packed scalar (NumFloatVec) channels: the codec treats every channel as a
    Vec4, so float-vec channels are decoded as extra Vec4 channels and unpacked four per vector.

Writes exports/characters/vader-animation/clips.json (source samples + timing + root motion +
graph events). GLBs are written by vader-build-glb.py.
"""
import hashlib
import json
import math
import struct
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path

import numpy as np

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
dec = SourceFileLoader('vader_raw_decoder', str(BASE / 'decode-animation.py')).load_module()
fpdct = SourceFileLoader('vader_fp_dct', str(BASE / 'firstperson-decode-dct.py')).load_module()
bank = dec.bank
OUT = ROOT / 'exports/characters/vader-animation'
GRAPH = OUT / 'graph.json'
TICKS_PER_SECOND = 60.0  # inference, see VADER-ANIMATION.md

ROTATION, TRANSLATION, SCALAR = 14, 2049856663, 10


def _dirs(prefix, source, suffix='_01', left_right=('Left1', 'Left2', 'Right1', 'Right2')):
    names = {'fwd': 'Fwd', 'fwdleft': 'FwdLeft', 'fwdright': 'FwdRight', 'bwd': 'Bwd', 'bwdleft': 'BwdLeft', 'bwdright': 'BwdRight'}
    for lr in left_right:
        names[lr.lower()] = lr
    return [(f'{prefix}-{k}', f'{source}{v}{suffix}') for k, v in names.items()]


VADER = [
    ('idle', 'L_Vader_Stand_IdleLoop_01'),
    ('idle-fidget-1', 'L_Vader_Stand_Idle_Fidget_01'), ('idle-fidget-2', 'L_Vader_Stand_Idle_Fidget_02'),
    ('idle-fidget-3', 'L_Vader_Stand_Idle_Fidget_03'),
    *_dirs('walk', 'C_Vader_Stand_Walk_'),
    *[(i, s if i != 'run-fwd' else 'C_Vader_Stand_Run_Fwd_03') for i, s in _dirs('run', 'C_Vader_Stand_Run_')],
    ('sprint', 'C_Vader_Stand_Sprint_Fwd_03'),
    ('turn-left', 'C_Vader_StandTurn_Left_01'), ('turn-right', 'C_Vader_StandTurn_Right_01'),
    ('run-stop', 'T_Vader_RunFwdToStop_01'), ('tiny-steps', 'C_Vader_Stand_TinySteps_01'),
    ('block-idle', 'L_Vader_Stand_Idle_Block_01'), ('block-idle-left', 'L_Vader_Stand_Idle_Block_Left_01'),
    ('block-idle-right', 'L_Vader_Stand_Idle_Block_Right_01'),
    *_dirs('block-walk', 'C_Vader_Stand_Walk_Blocking_'),
    ('block-tiny-steps', 'C_Vader_Stand_TinySteps_Blocking_01'), ('block-run-stop', 'T_Vader_RunFwdToStop_Blocking_01'),
    *[(f'block-stagger-{n}', f'A_Vader_Block_Stagger_0{n}') for n in (1, 2, 3)],
    *[(f'block-swing-left-{n}', f'A_Vader_Stand_Block_SwingLeft_0{n}') for n in (1, 2, 3, 4)],
    *[(f'block-swing-right-{n}', f'A_Vader_Stand_Block_SwingRight_0{n}') for n in (1, 2, 4)],
    ('antispam-loop', 'C_Vader_AntispamLoop_01'), ('antispam-loop-block', 'C_Vader_AntispamLoop_Blocking_01'),
    *[item for n in range(1, 7) for item in (
        (f'strike{n}', f'A_Vader_AttackLoop_Strike{n}'), (f'strike{n}-v2', f'A_Vader_AttackLoop_Strike{n}_V2'),
        (f'strike{n}-end', f'A_Vader_AttackLoop_Strike{n}_BackToIdle'),
        (f'strike{n}-v2-end', f'A_Vader_AttackLoop_Strike{n}_V2_BackToIdle'))],
    ('closer1', 'A_Vader_Idle_Closer_To_AttackPose1_To_Idle'),
    ('closer2', 'A_Vader_AttackPose1_Closer_To_AttackPose2_To_Idle'),
    ('closer3', 'A_Vader_AttackPose2_Closer_To_AttackPose3_To_Idle'),
    ('strike-to-idle', 'Vader_Strike_To_IdleHelper'),
    ('air-attack', 'A_Vader_Jump_SaberAttack_Light_FH_01'),
    *[(f'attack-blocked-{n}', f'A_Vader_LightAttack_Blocked_0{n}') for n in range(1, 7)],
    ('choke-enter', 'A_Vader_ForceChoke_Enter_01'), ('choke-loop', 'A_Vader_ForceChoke_Loop_01'),
    ('throw-fwd', 'A_Vader_Stand_ThrowSaber_FwdFacing_02'), ('throw-up', 'A_Vader_Stand_ThrowSaber_UpFacing_02'),
    ('throw-down', 'A_Vader_Stand_ThrowSaber_DwnFacing_02'), ('catch', 'A_Vader_Stand_CatchSaber_02'),
    ('rage', 'A_Vader_RagePowerUp_01'),
    *[(f'dodge-{d.lower()}', f'A_Vader_Dodge_{d}_01') for d in ('Front', 'Back', 'Left', 'Right')],
    ('jump-fwd', 'A_Vader_Jump_Fwd_01'), ('jump-loop', 'L_Vader_Jump_Fwd_02'), ('in-air', 'L_Vader_InAir_Low_01'),
    ('add-land-run', 'Add_Vader_JumpLanding_Run_01'), ('add-land-stand-1', 'Add_Vader_JumpLanding_Stand_01'),
    ('add-land-stand-2', 'Add_Vader_JumpLanding_Stand_02'),
    *[(f'add-hit-{d.lower()}', f'A_Vader_Stand_HitReact_{d}1') for d in ('Front', 'Back', 'Left', 'Right')],
    ('stagger-fwd', 'A_Vader_Stagger_Fwd_01'), ('stagger-fwd-2', 'A_Vader_Stagger_Fwd_02'), ('stagger-fwd-3', 'A_Vader_Stagger_Fwd_03'),
    ('stagger-bwd', 'A_Vader_Stagger_Bwd_01'), ('stagger-bwd-2', 'A_Vader_Stagger_Bwd_02'), ('stagger-bwd-3', 'A_Vader_Stagger_Bwd_03'),
    ('death', 'A_Vader_Defeated_01'), ('death-in-air', 'L_Vader_DefeatedInAir_Low_01'),
    ('intro', 'Battle_Hero_Intro_Vader_MP'),
    ('emote-1', 'E_Vader_01'), ('emote-1-apology', 'E_Vader_01_Apology'), ('emote-2', 'E_Vader_02'),
    ('emote-2-hide', 'E_Vader_02_Hide'), ('emote-3', 'E_Vader_03'), ('emote-3-clumsy', 'E_Vader_03_Clumsy'),
    ('emote-4-disturbing', 'E_Vader_04_Disturbing'),
    ('add-idle', 'Add_Vader_StandIdle_Loop_01'),
]
VICTIM = [
    # Force choke as used by the shipped graph (ChokeEnter/ChokeLoop nodes reference the PhysCtrl variants).
    ('choke-enter', 'A_HM_Rifle_Stunned_ForceChoke_Enter_PhysCtrl_01_new'),
    *[(f'choke-enter-{n}', f'A_HM_Rifle_Stunned_ForceChoke_Enter_PhysCtrl_0{n}') for n in (2, 3, 4)],
    ('choke-loop', 'A_HM_Rifle_Stunned_ForceChoke_Loop_PhysCtrl_01'),
    *[(f'choke-loop-{n}', f'A_HM_Rifle_Stunned_ForceChoke_Loop_PhysCtrl_0{n}') for n in (2, 3, 4)],
    # Non-PhysCtrl variants: AITrajectory stays at y=0 and the ~1 m lift is baked into the Hips track.
    ('choke-enter-hipslift', 'A_HM_Rifle_Stunned_ForceChoke_Enter_01'),
    ('choke-loop-hipslift', 'A_HM_Rifle_Stunned_ForceChoke_Loop_01'),
    ('choke-exit-alive', 'A_HM_Rifle_Stunned_ForceChoke_ExitAlive_01'),
    ('choke-death', 'A_HM_Rifle_Stand_ChokeDeath_Still_01'),
    *[(f'choke-death-{n}', f'A_HM_Rifle_Stand_ChokeDeath_Still_0{n}') for n in (2, 3, 4)],
    *[(f'saber-death-fwd{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_LightSaber_Fwd_0{n}') for n in range(1, 6)],
    *[(f'saber-death-bwd{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_LightSaber_Bwd_0{n}') for n in (1, 2)],
    *[(f'saber-death-left{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_LightSaber_Left_0{n}') for n in (1, 2)],
    *[(f'saber-death-right{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_LightSaber_Right_0{n}') for n in (1, 2)],
    *[(f'push-death-fwd{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_ForcePush_Fwd_0{n}') for n in range(1, 8)],
    *[(f'push-death-bwd{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_ForcePush_Bwd_0{n}') for n in (1, 2, 3)],
    *[(f'push-death-left{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_ForcePush_Left_0{n}') for n in (1, 2)],
    *[(f'push-death-right{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_ForcePush_Right_0{n}') for n in (1, 2)],
    # Ordinary deaths (blaster hits by side, deaths while running, melee) and the lying pose.
    *[(f'blaster-death-{d.lower()}{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_{d}_Upperbody_BlasterFire_0{n}')
      for d, count in (('Front', 4), ('Back', 3), ('Left', 3), ('Right', 3)) for n in range(1, count + 1)],
    *[(f'run-death-{d.lower()}{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_Run_{d}_0{n}') for d in ('Fwd', 'Left', 'Right') for n in (1, 2, 3)],
    *[(f'melee-death-{d.lower()}{"" if n == 1 else "-" + str(n)}', f'A_HM_Death_Stand_{d}_Melee_0{n}')
      for d, count in (('Front', 2), ('Back', 2), ('Left', 1), ('Right', 2)) for n in range(1, count + 1)],
    ('death-pose', 'P_HM_DeathPose_01'),
]


class Unsupported(Exception):
    pass


def controllers_by_name():
    out = {}
    for o in bank.objects.values():
        if o['type'] == 'ClipControllerAsset':
            out.setdefault(o['values']['__name'], []).append(o)
    return out


def arrays(values):
    return {k: bank.array(v) if isinstance(v, dict) and 'arrayOffset' in v else v for k, v in values.items()}


def raw_channels(animation):
    """Generalized raw decode (per-key record may be padded to a multiple of 4 floats)."""
    v = animation['values']
    mapping, _, _ = bank.channels(animation)
    indices, reverse = bank.array(v['MappingIndices']), bank.array(v['ChannelIndices'])
    if sorted(indices) != list(range(len(mapping))) or any(reverse[indices[i]] != i for i in range(len(indices))):
        raise ValueError('Unexpected channel permutation')
    q, t, f, cq, ct, cf = [v[k] for k in ['QuatCount', 'Vec3Count', 'FloatCount', 'ConstQuatCount', 'ConstVec3Count', 'ConstFloatCount']]
    if q + t + f + cq + ct + cf != len(mapping):
        raise ValueError('Channel counts disagree with ChannelToDofAsset')
    raw = np.array(bank.array(v['Data']), dtype=np.float32)
    const = np.array(bank.array(v['ConstData']), dtype=np.float32)
    keys = v['NumKeys']
    exact = q * 4 + t * 4 + f
    padded = (exact + 3) // 4 * 4
    if len(raw) == exact * keys:
        stride = exact
    elif len(raw) == padded * keys:
        stride = padded
    else:
        raise ValueError(f'Raw sample size {len(raw)} matches neither {exact}x{keys} nor padded {padded}x{keys}')
    if len(const) != cq * 4 + ct * 4 + cf:
        raise ValueError('Constant record size disagrees')
    channels = []
    for source_index, dof in enumerate(mapping):
        index = reverse[source_index]
        is_const = index >= q + t + f
        if is_const:
            index -= q + t + f
            qs, ts, data = cq, ct, const[None, :]
        else:
            qs, ts, data = q, t, raw.reshape(keys, stride)
        if index < qs:
            offset, size, kind = index * 4, 4, 'rotation'
        elif index < qs + ts:
            offset, size, kind = qs * 4 + (index - qs) * 4, 3, 'translation'
        else:
            offset, size, kind = qs * 4 + ts * 4 + (index - qs - ts), 1, 'scalar'
        channels.append({'dof': dof, 'property': kind, 'constant': is_const, 'values': data[:, offset:offset + size].copy(),
                         'sourceChannelIndex': source_index})
    return channels, {'counts': [q, t, f, cq, ct, cf], 'stride': stride, 'stridePadding': stride - exact}


def dct_channels(animation):
    """DCT decode through the unmodified verified decoder; float-vec channels are extra Vec4 channels."""
    values = arrays(animation['values'])
    q, t, fv, nf = values['NumQuats'], values['NumVec3'], values['NumFloatVec'], values['NumFloat']
    if fv != (nf + 3) // 4:
        raise ValueError(f'NumFloatVec {fv} does not pack NumFloat {nf}')
    relabeled = dict(values, NumVec3=t + fv, NumFloatVec=0, NumFloat=0)
    samples, details = fpdct.decompress(relabeled)
    mapping, _, _ = bank.channels(animation)
    if len(mapping) != q + t + nf:
        raise ValueError('DCT mapping length disagrees with NumQuats+NumVec3+NumFloat')
    channels = []
    for i, dof in enumerate(mapping):
        if i < q:
            vals, kind = samples[:, i, :4], 'rotation'
        elif i < q + t:
            vals, kind = samples[:, i, :3], 'translation'
        else:
            j = i - q - t
            vals, kind = samples[:, q + t + j // 4, j % 4:j % 4 + 1], 'scalar'
        channels.append({'dof': dof, 'property': kind, 'constant': False, 'values': vals.copy(), 'sourceChannelIndex': i})
    details.update(rawSamplesSha256=hashlib.sha256(samples.tobytes()).hexdigest(), shape=list(samples.shape))
    # Block-boundary continuity: mean rotation step across 8-key DCT block edges vs inside blocks.
    quats = samples[:, :q, :].astype(np.float64)
    quats /= np.linalg.norm(quats, axis=2, keepdims=True)
    steps = 2 * np.arccos(np.clip(np.abs(np.sum(quats[1:] * quats[:-1], axis=2)), 0, 1))
    edge = np.array([(k + 1) % 8 == 0 for k in range(len(steps))])
    if edge.any() and (~edge).any():
        details['blockBoundaryStepRatio'] = round(float(steps[edge].mean() / max(steps[~edge].mean(), 1e-12)), 4)
    return channels, details, samples, values


def slerp(a, b, alpha):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        r = a + (b - a) * alpha
        return r / np.linalg.norm(r)
    th = math.acos(d)
    return (math.sin((1 - alpha) * th) * a + math.sin(alpha * th) * b) / math.sin(th)


def sample(track_values, kind, frames, frame):
    if len(track_values) == 1:
        return track_values[0].astype(np.float64)
    i = int(np.searchsorted(frames, frame))
    if i <= 0:
        return track_values[0].astype(np.float64)
    if i >= len(frames):
        return track_values[-1].astype(np.float64)
    lo, hi = i - 1, i
    alpha = (frame - frames[lo]) / (frames[hi] - frames[lo])
    a, b = track_values[lo].astype(np.float64), track_values[hi].astype(np.float64)
    if kind == 'rotation':
        return slerp(a, b, alpha)
    return a + (b - a) * alpha


def yaw_of(q):
    x, y, z, w = q
    # Rotation about +Y of the quaternion's forward (+Z) axis.
    fx = 2 * (x * z + w * y)
    fz = 1 - 2 * (x * x + y * y)
    return math.atan2(fx, fz)


def r7(x):
    return float(np.float32(x))


_CLASS_BY_HASH = None


def ant_chain(key):
    """Full REF2 base-class chain of a DAT2 object (the retained inventory stores one base level)."""
    global _CLASS_BY_HASH
    if _CLASS_BY_HASH is None:
        _CLASS_BY_HASH = {c['hash']: c for c in bank.metadata['classes']}
    b = bank.data
    u32 = lambda p: struct.unpack_from('<I', b, p)[0]
    rel = lambda p: struct.unpack_from('<i', b, p)[0]
    fmt = {'Bool': '?', 'Int8': 'b', 'UInt8': 'B', 'Int16': 'h', 'UInt16': 'H', 'Int32': 'i', 'UInt32': 'I', 'Float': 'f'}
    header, merged = bank.objects[key]['headerOffset'], {}
    while header:
        cl = _CLASS_BY_HASH[u32(header + 16)]
        base = header + struct.unpack_from('<H', b, header + 28)[0]
        nxt = None
        for f in cl['fields']:
            at = base + f['offset']
            if f['name'] == '__base':
                nxt = at + rel(at) if rel(at) else None
            elif f['flags'] == 1 or f['type'] == 'String':
                if f['type'] == 'Key':
                    count, off = u32(at + 4), at + 8 + rel(at + 8)
                    merged.setdefault(f['name'], [f'{x:016x}' for x in struct.unpack_from('<' + 'Q' * count, b, off)])
            elif f['type'] == 'Key':
                merged.setdefault(f['name'], f'{struct.unpack_from("<Q", b, at)[0]:016x}')
            elif f['type'] in fmt:
                merged.setdefault(f['name'], struct.unpack_from('<' + fmt[f['type']], b, at)[0])
        header = nxt
    return merged


def ant_tags(controller, scale):
    """Clip-local ANT tags (TagCollectionSet -> collections -> tags). Ticks are graph ticks."""
    key = controller['base']['values'].get('TagCollectionSet')
    if not key or key == '0' * 16:
        return []

    def name(k):
        o = bank.objects.get(k)
        return o['values'].get('__name') if o else None
    out = []
    for collection in ant_chain(key).get('TagCollectionKeys', []):
        col = ant_chain(collection)
        for tag_key in col.get('TagKeys', []) + col.get('MonitoredTags', []):
            t = ant_chain(tag_key)
            start, length = t.get('StartLinkOffset'), t.get('EndLinkOffset')
            item = {'type': bank.objects[tag_key]['type'], 'collection': bank.objects[collection]['type'],
                    'startTick': start, 'lengthTicks': length, 'linkFlags': t.get('LinkFlags'),
                    'start': round(start / TICKS_PER_SECOND, 5) if start is not None else None,
                    'end': round((start + length) / TICKS_PER_SECOND, 5) if start is not None and length is not None else None}
            for field in ('ValueAsset', 'BranchTypeAsset', 'BlendAsset', 'TagEnable'):
                if t.get(field) and t[field] != '0' * 16:
                    item[field[0].lower() + field[1:]] = name(t[field])
            if t.get('BlendAsset') and t['BlendAsset'] in bank.objects:
                blend = ant_chain(t['BlendAsset'])
                if 'BlendTime' in blend:
                    item['blendTicks'] = blend['BlendTime']
            for field in ('Value', 'Mode', 'Active', 'DestinationPhase'):
                if field in t:
                    item[field[0].lower() + field[1:]] = t[field]
            if item not in out:
                out.append(item)
    return out


def graph_index():
    graph = json.loads(GRAPH.read_text())
    by_key = {}
    for usage in graph['usages']:
        for info in usage['clipInfos']:
            if info.get('ant'):
                by_key.setdefault(info['ant']['key'], []).append(usage)
    return graph, by_key


def clip_events(controller_key, usages):
    """Map graph-tick tags onto this clip's local timeline (clip tick = sequence tick - StartTime)."""
    out = []
    for usage in usages:
        segments = [c for c in usage['clipInfos'] if c.get('ant') and c['ant']['key'] == controller_key]
        nodes = [usage] + [p for p in usage['parents'] if p['type'] == 'CharacterStateStateFlowNodeControllerData' and p['depth'] == 1]
        record = {'graphController': usage['name'], 'graphControllerId': usage['id'],
                  'graphNodes': [n['name'] for n in nodes[1:]],
                  'segments': [{k: s.get(k) for k in ('index', 'StartTime', 'StartInTime', 'EndInTime', 'Length', 'BlendTime', 'Looping', 'Scale', 'ClipOffset')} for s in segments],
                  'sequenceClips': [{'index': c['index'], 'ant': c['ant']['name'] if c.get('ant') else None, 'startTime': c['StartTime'],
                                     'startInTime': c.get('StartInTime'), 'endInTime': c.get('EndInTime'), 'length': c['Length'],
                                     'blendTime': c['BlendTime'], 'looping': c['Looping']} for c in usage['clipInfos']],
                  'sequenceLength': usage['fields'].get('Length'), 'tags': [], 'transitions': []}
        for n in nodes:
            for tag in n.get('tags', []):
                if tag['type'] == 'vec3':
                    continue
                start, length = tag['time'], tag['length'] or 0
                seg = next((s for s in segments if s['StartTime'] + s.get('StartInTime', 0) <= start <= s['StartTime'] + s.get('EndInTime', s['Length'])), None)
                if seg is None and segments and segments[0]['index'] == 0:
                    # The sequence's lead clip carries the node's whole timeline (tick 0 = its StartTime).
                    seg = segments[0]
                item = {'source': n['name'], 'channel': tag['channel'], 'type': tag['type'], 'startTick': start, 'lengthTicks': length}
                if tag['type'] == 'float':
                    item['curve'] = tag['curve']
                else:
                    item['value'] = tag.get('value')
                    item['resetValue'] = tag.get('resetValue')
                if seg is not None:
                    item['clipStartTick'] = start - seg['StartTime']
                    item['clipStart'] = round((start - seg['StartTime']) / TICKS_PER_SECOND, 5)
                    item['clipEnd'] = round((start + length - seg['StartTime']) / TICKS_PER_SECOND, 5)
                record['tags'].append(item)
            for tr in n.get('transitions', []):
                record['transitions'].append({'from': n['name'], **tr})
        if usage.get('transformTracks'):
            # Full per-tick transform tracks stay in graph.json (usages[].transformTracks); summarize here.
            record['graphTrajectory'] = [{'joint': tt['joint'], 'ticks': [tt['ticks'][0], tt['ticks'][-1]] if tt['ticks'] else [],
                                          'endTranslation': [round(c, 5) for c in tt['translation'][-1]] if tt['translation'] else None,
                                          'see': 'graph.json usages[id=graphControllerId].transformTracks'} for tt in usage['transformTracks']]
        out.append(record)
    return out


def summarize_windows(events):
    """Gameplay windows on the clip's own timeline, from the first graph usage that schedules it at t=0."""
    if not events:
        return {}
    primary = next((e for e in events if e['segments'] and e['segments'][0]['index'] == 0), events[0])
    lead = bool(primary['segments']) and primary['segments'][0]['index'] == 0
    res = {'graphController': primary['graphController'], 'graphNodes': primary['graphNodes'],
           'timeline': 'sequence (clip is the lead ClipInfo; windows may extend past the clip into its follow-up clips)' if lead
                       else 'clip segment (only tags inside the scheduled segment of this clip)'}
    dmg = [t for t in primary['tags'] if t['channel'] == 'CharacterState.LightSaberDmg.Given.Dir.EnumGS' and 'clipStart' in t]
    kill = [t for t in primary['tags'] if t['channel'] == 'ExecuteKill' and 'clipStart' in t]
    if dmg or kill:
        src = dmg or kill
        res['hitWindows'] = [[t['clipStart'], t['clipEnd']] for t in src]
        res['hitWindowTicks'] = [[t['startTick'], t['startTick'] + t['lengthTicks']] for t in src]
        res['hitWindowSource'] = src[0]['channel']
    branches = {}
    for t in primary['tags']:
        if t['type'] == 'bool' and t['channel'].endswith('Branch') and t.get('value') and 'clipStart' in t:
            key = t['channel'].replace('CharacterState.', '').replace('.Branch', '')
            branches[key] = [t['clipStart'], t['clipEnd']]
    if branches:
        res['branchWindows'] = branches
    for name in ('Unstaggerable', 'TriggerAffectorEnum', 'CurrentAbility', 'HeroMelee_Attack_StrikeIndex', 'DodgeDirection'):
        found = [t for t in primary['tags'] if t['channel'] == name and 'clipStart' in t]
        if found:
            res[name[0].lower() + name[1:]] = [{'window': [t['clipStart'], t['clipEnd']], 'value': t.get('value')} for t in found]
    combos = []
    seg0 = primary['segments'][0]['StartTime'] if primary['segments'] else 0
    for tr in primary['transitions']:
        target = tr.get('target') or ','.join(c.get('target') or '' for c in tr.get('children', []) if c.get('target'))
        if tr.get('startTick') is None:
            continue
        item = {'ticks': [tr['startTick'], tr['startTick'] + tr['length']], 'alwaysActive': tr.get('alwaysActive'),
                'channel': tr.get('channel'), 'value': tr.get('value'), 'invert': tr.get('invert'),
                'target': target or None, 'condition': [c.get('channel') for c in tr.get('children', [])] or None}
        if tr['length'] and not tr.get('alwaysActive'):
            item['window'] = [round((tr['startTick'] - seg0) / TICKS_PER_SECOND, 5), round((tr['startTick'] + tr['length'] - seg0) / TICKS_PER_SECOND, 5)]
        combos.append(item)
    if combos:
        res['transitions'] = combos
    seq = primary['sequenceClips']
    if len(seq) > 1:
        res['sequence'] = [{'ant': c['ant'], 'startSec': round(c['startTime'] / TICKS_PER_SECOND, 5),
                            'blendSec': round(c['blendTime'] / TICKS_PER_SECOND, 5),
                            'clipInSec': round((c['startInTime'] or 0) / TICKS_PER_SECOND, 5),
                            'clipOutSec': round((c['endInTime'] or c['length']) / TICKS_PER_SECOND, 5), 'looping': c['looping']} for c in seq]
    return res


def decode_clip(clip_id, source_name, ctrls, graph_by_key):
    found = ctrls.get(source_name)
    if not found:
        raise LookupError(f'No ClipControllerAsset named {source_name}')
    if len(found) != 1:
        raise LookupError(f'Ambiguous controller name {source_name}')
    controller = found[0]
    cv = controller['values']
    animation = bank.objects[cv['Anim']]
    base = animation['base']['values']
    codec = animation['type']
    details = {}
    if codec == 'RawAnimationAsset':
        channels, details = raw_channels(animation)
        frames = np.array(bank.array(animation['values']['KeyTimes']), dtype=np.float64)
    elif codec == 'DctAnimationAsset':
        channels, details, _, values = dct_channels(animation)
        frames = np.array(values['KeyTimes'], dtype=np.float64)
    else:
        raise Unsupported(f'{codec} is not decoded (VBR bitstream semantics unverified)')
    if len(frames) != animation['values']['NumKeys'] or np.any(np.diff(frames) <= 0):
        raise ValueError('Key times not strictly increasing')
    fps, scale = cv['FPS'], cv['TimeScale']
    trim, trimmed = base['TrimOffset'], base['TrimmedDuration']
    duration = trimmed / scale / TICKS_PER_SECOND
    start_frame, end_frame = trim, trim + trimmed
    # Source keys within 1e-3 frames of a trim boundary are represented by that boundary sample.
    inner = [f for f in frames if start_frame + 1e-3 < f < end_frame - 1e-3]
    sample_frames = np.array([start_frame, *inner, end_frame], dtype=np.float64)
    times = (sample_frames - trim) / scale / TICKS_PER_SECOND
    tracks, unmapped, norm_errors = [], [], []
    root = {}
    for ch in channels:
        slot = dec.dofs.get(ch['dof'])
        vals = ch['values']
        if not np.isfinite(vals).all():
            raise ValueError('Nonfinite sample')
        if ch['property'] == 'rotation':
            norm_errors.append(float(np.max(np.abs(np.linalg.norm(vals.astype(np.float64), axis=1) - 1))))
        if slot is None:
            unmapped.append({'dofId': ch['dof'], 'property': ch['property'], 'sourceChannelIndex': ch['sourceChannelIndex'],
                             'constant': ch['constant'], 'values': [[r7(x) for x in row] for row in vals]})
            continue
        expected = {'rotation': ROTATION, 'translation': TRANSLATION, 'scalar': SCALAR}[ch['property']]
        if slot['type'] != expected:
            raise ValueError(f'Unexpected slot type {slot}')
        bone, suffix = slot['name'].rsplit('.', 1)
        track = {'bone': bone, 'property': ch['property'] if ch['property'] != 'scalar' else 'scalar:' + suffix,
                 'sourceDofId': ch['dof'], 'sourceSlot': slot['name'], 'layout': slot['layout'],
                 'sourceChannelIndex': ch['sourceChannelIndex'], 'constant': ch['constant'],
                 'values': [[r7(x) for x in row] for row in vals]}
        tracks.append(track)
        if bone == 'AITrajectory':
            root[ch['property']] = vals
    max_norm = max(norm_errors, default=0.0)
    if max_norm > 0.002:
        raise ValueError(f'Quaternion norm error {max_norm}')
    # Root motion curve on the materialized (trimmed, seconds) timeline, relative to t=0.
    root_motion = None
    if 'translation' in root:
        tv = root['translation']
        rv = root.get('rotation')
        pos = np.array([sample(tv, 'translation', frames, f) for f in sample_frames])
        origin = pos[0].copy()
        pos -= origin
        yaw = None
        if rv is not None:
            raw_yaw = [yaw_of(sample(rv, 'rotation', frames, f)) for f in sample_frames]
            unwrapped = np.unwrap(np.array(raw_yaw))
            yaw = (unwrapped - unwrapped[0]).tolist()
        step = np.linalg.norm(np.diff(pos[:, [0, 2]], axis=0), axis=1)
        root_motion = {'origin': [round(float(c), 5) for c in origin],
                       'times': [round(float(t), 5) for t in times],
                       'translation': [[round(float(c), 5) for c in p] for p in pos],
                       'yaw': [round(float(y), 5) for y in yaw] if yaw is not None else None,
                       'end': [round(float(c), 5) for c in pos[-1]],
                       'horizontalPathLength': round(float(step.sum()), 5),
                       'maxHorizontalSpeed': round(float(np.max(step / np.maximum(np.diff(times), 1e-9))) if len(step) else 0.0, 4),
                       'sourceControllerDistance': cv.get('Distance')}
    events = clip_events(cv['__key'], graph_by_key.get(cv['__key'], []))
    clip = {
        'id': clip_id, 'sourceName': source_name, 'sourceControllerKey': cv['__key'], 'sourceAnimationKey': animation['values']['__key'],
        'codec': codec, 'dofSetList': bank.objects[base['DofSetList']]['values']['__name'],
        'additive': bool(base.get('Additive')), 'cycle': animation['values'].get('Cycle'),
        'controller': {k: cv[k] for k in ('FPS', 'TimeScale', 'TickOffset', 'Distance', 'Modes')},
        'animationBase': {k: base[k] for k in ('CodecType', 'AnimId', 'TrimOffset', 'TrimmedDuration', 'EndFrame')},
        'timing': {'sourceKeyFrames': frames.tolist(), 'materializedFrames': [round(float(f), 5) for f in sample_frames],
                   'times': [round(float(t), 6) for t in times], 'duration': round(duration, 6),
                   'ticksPerSecondAssumed': TICKS_PER_SECOND,
                   'formula': 'seconds = (frame - TrimOffset) / TimeScale / 60; duration = TrimmedDuration / TimeScale / 60',
                   'source': 'FPS, TimeScale, TrimOffset, TrimmedDuration, EndFrame and KeyTimes are source fields; the 60 ticks/s graph clock is inferred'},
        'tracks': tracks, 'unmapped': unmapped, 'maxQuaternionNormError': max_norm, 'codecDetails': details,
        'rootMotion': root_motion, 'graph': events, 'windows': summarize_windows(events),
        'antTags': ant_tags(controller, scale),
    }
    return clip


def regression_checks(ctrls):
    """The generalized paths must reproduce the reused decoders exactly where both apply."""
    report = {'raw': [], 'dct1p': []}
    for name in ['A_Vader_AttackLoop_Strike1', 'C_Vader_Stand_Run_Fwd_03', 'A_Vader_Dodge_Left_01', 'C_HM_Rifle_Run_Fwd_01']:
        controller = ctrls[name][0]
        anim_key = controller['values']['Anim']
        reference = dec.decode(anim_key, name)
        channels, _ = raw_channels(bank.objects[anim_key])
        mapped = [c for c in channels if c['dof'] in dec.dofs]
        if len(mapped) != len(reference['tracks']):
            raise AssertionError(f'{name}: track count differs from decode-animation.py')
        diff = 0.0
        for a, b in zip(mapped, reference['tracks']):
            if a['dof'] != b['sourceDofId'] or a['constant'] != b['constant']:
                raise AssertionError(f'{name}: channel order differs')
            diff = max(diff, float(np.max(np.abs(a['values'] - np.array(b['values'], dtype=np.float32)))))
        if diff != 0.0:
            raise AssertionError(f'{name}: raw values differ by {diff}')
        report['raw'].append({'clip': name, 'tracks': len(mapped), 'maxAbsDifference': diff})
    folder = ROOT / 'exports/characters/firstperson-dct'
    for name in ['Add_1p_E11_SingleFire01', 'Add_1p_A280_SingleFire_02', 'Add_1p_A280_SingleFire_03']:
        stored = folder / f'{name}.python.f32'
        if not stored.exists():
            continue
        animation = bank.objects[ctrls[name][0]['values']['Anim']]
        values = arrays(animation['values'])
        relabeled = dict(values, NumVec3=values['NumVec3'] + values['NumFloatVec'], NumFloatVec=0, NumFloat=0)
        samples, _ = fpdct.decompress(relabeled)
        same = samples.tobytes() == stored.read_bytes()
        if not same:
            raise AssertionError(f'{name}: 1P DCT output changed')
        report['dct1p'].append({'clip': name, 'byteIdenticalToRetained1pOutput': same, 'floats': int(samples.size)})
    return report


def main():
    if bank.metadata['sha256'] != hashlib.sha256(bank.data).hexdigest():
        raise ValueError('Retained ANT bank differs from inventory hash')
    ctrls = controllers_by_name()
    regression = regression_checks(ctrls)
    graph, graph_by_key = graph_index()
    groups = {'vader': [], 'victim': []}
    missing, unsupported = [], []
    for group, table in (('vader', VADER), ('victim', VICTIM)):
        seen = set()
        for clip_id, source in table:
            if clip_id in seen:
                raise ValueError(f'Duplicate id {clip_id}')
            seen.add(clip_id)
            try:
                groups[group].append(decode_clip(clip_id, source, ctrls, graph_by_key))
            except LookupError as e:
                missing.append({'group': group, 'id': clip_id, 'sourceName': source, 'reason': str(e)})
            except Unsupported as e:
                c = ctrls[source][0]
                unsupported.append({'group': group, 'id': clip_id, 'sourceName': source, 'sourceControllerKey': c['values']['__key'],
                                    'codec': bank.objects[c['values']['Anim']]['type'], 'reason': str(e)})
    out = {
        'evidenceId': 'BF2-VADER-ANIM-001',
        'sourceBank': str(bank.metadata['source']).replace('\\', '/'), 'sourceBankSha256': bank.metadata['sha256'],
        'sourceRig': dec.rig['__name'], 'sourceRigKey': '4df8f37fade10ee2',
        'graphEvidence': {'file': 'exports/characters/vader-animation/graph.json', 'evidenceId': graph['evidenceId'],
                          'source': graph['source']},
        'decoders': {f: hashlib.sha256((BASE / f).read_bytes()).hexdigest() for f in
                     ('decode-animation.py', 'firstperson-decode-dct.py', 'vader-decode.py', 'select-animation.py')},
        'conventions': {
            'space': 'Source model space: +Y up, +Z character forward, +X character left (rig faces +Z in bind space).',
            'quaternions': 'x,y,z,w as decoded; DCT quaternions are unnormalized source samples (normalize before use).',
            'rootMotion': 'AITrajectory translation (and yaw of its rotation) sampled on the materialized timeline, relative to t=0. '
                          'glTF tracks keep the AITrajectory rotation (constant -90deg yaw in all decoded clips) and drop its translation.',
            'time': 'timing.times are seconds on the trimmed clip timeline assuming 60 graph ticks per second; tracks hold source samples at timing.sourceKeyFrames.',
            'graphEvents': 'graph[].tags carry authored ticks; clipStart/clipEnd map them onto this clip (clip tick = sequence tick - ClipInfo.StartTime).',
        },
        'regression': regression,
        'clips': groups['vader'], 'victimClips': groups['victim'],
        'missing': missing, 'unsupported': unsupported,
    }
    path = OUT / 'clips.json'
    path.write_text(json.dumps(out, separators=(',', ':')))
    summary = {'output': str(path), 'bytes': path.stat().st_size, 'vader': len(groups['vader']), 'victim': len(groups['victim']),
               'missing': missing, 'unsupported': [u['sourceName'] for u in unsupported], 'regression': regression}
    print(json.dumps(summary, indent=1))
    for g in ('vader', 'victim'):
        for c in groups[g]:
            w = c['windows']
            rm = c['rootMotion']
            print(f"{g:6} {c['id']:22} {c['codec'][:4]} keys={len(c['timing']['sourceKeyFrames']):3} dur={c['timing']['duration']:.3f}s add={int(c['additive'])} "
                  f"norm={c['maxQuaternionNormError']:.1e} unm={len(c['unmapped'])} root={rm['end'] if rm else None} hit={w.get('hitWindows')}")


if __name__ == '__main__':
    sys.setrecursionlimit(10000)
    main()
