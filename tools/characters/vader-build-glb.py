"""Build skeleton-only animation GLBs from exports/characters/vader-animation/clips.json.

Outputs (new files only):
  web/public/assets/characters/vader-animations.glb   Vader clips
  web/public/assets/characters/hm-hero-reactions.glb  HM victim clips (choke / saber / push)

Each GLB holds only the Walrus_HumanMale joint hierarchy copied from stormtrooper.glb
(skin 0: names, rest TRS, sourceBoneIndex extras) plus glTF animations named by short id.
Conventions follow attach-animations.mjs: AITrajectory translation removed (kept as a compact
root-motion curve in the animation extras), AITrajectory rotation retained, duplicate source DOFs
deduplicated after an equality check, quaternions normalized and hemisphere-continuous, scalar
channels and unmapped DOFs skipped. Times are seconds on the trimmed clip timeline (60 ticks/s,
inferred). Additive clips keep their source delta values and are flagged in extras.
"""
import json
import math
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CLIPS = ROOT / 'exports/characters/vader-animation/clips.json'
TROOPER = ROOT / 'web/public/assets/characters/stormtrooper.glb'
OUT_VADER = ROOT / 'web/public/assets/characters/vader-animations.glb'
OUT_VICTIM = ROOT / 'web/public/assets/characters/hm-hero-reactions.glb'
DUPLICATE_TOLERANCE = 2e-3  # DCT duplicates are quantized independently


def read_glb(path):
    data = path.read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + length])


def skeleton_nodes():
    doc = read_glb(TROOPER)
    joints = doc['skins'][0]['joints']
    index = {old: new for new, old in enumerate(joints)}
    nodes = []
    for old in joints:
        n = doc['nodes'][old]
        node = {'name': n['name']}
        for k in ('translation', 'rotation', 'scale'):
            if k in n:
                node[k] = n[k]
        children = [index[c] for c in n.get('children', []) if c in index]
        missing = [c for c in n.get('children', []) if c not in index]
        if missing:
            raise ValueError(f'Joint {n["name"]} has non-joint children {missing}')
        if children:
            node['children'] = children
        node['extras'] = {k: v for k, v in (n.get('extras') or {}).items()}
        nodes.append(node)
    child = {c for n in nodes for c in n.get('children', [])}
    roots = [i for i in range(len(nodes)) if i not in child]
    if [nodes[i]['name'] for i in roots] != ['Reference']:
        raise ValueError(f'Unexpected skeleton roots {roots}')
    names = [n['name'] for n in nodes]
    if len(set(names)) != len(names):
        raise ValueError('Duplicate joint names')
    return nodes, doc['skins'][0].get('name')


def slerp(a, b, alpha):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        r = a + (b - a) * alpha
        return r / np.linalg.norm(r)
    th = math.acos(min(1.0, d))
    return (math.sin((1 - alpha) * th) * a + math.sin(alpha * th) * b) / math.sin(th)


def materialize(track, source_frames, sample_frames):
    vals = np.array(track['values'], dtype=np.float64)
    rot = track['property'] == 'rotation'
    if rot:
        vals = vals / np.linalg.norm(vals, axis=1, keepdims=True)
    if len(vals) == 1:
        return vals[:1], True
    out = []
    for f in sample_frames:
        i = int(np.searchsorted(source_frames, f))
        if i <= 0:
            out.append(vals[0])
        elif i >= len(source_frames):
            out.append(vals[-1])
        elif source_frames[i] == f:
            out.append(vals[i])
        else:
            lo, hi = i - 1, i
            alpha = (f - source_frames[lo]) / (source_frames[hi] - source_frames[lo])
            out.append(slerp(vals[lo], vals[hi], alpha) if rot else vals[lo] + (vals[hi] - vals[lo]) * alpha)
    out = np.array(out)
    if rot:
        for k in range(1, len(out)):
            if np.dot(out[k], out[k - 1]) < 0:
                out[k] = -out[k]
    constant = bool(np.max(np.abs(out - out[0])) < 1e-7)
    return (out[:1] if constant else out), constant


def r4(x):
    return round(float(x), 4)


def compact_root(root):
    if not root:
        return None
    moving = any(abs(c) > 1e-4 for p in root['translation'] for c in p)
    turning = root['yaw'] is not None and any(abs(y) > 1e-4 for y in root['yaw'])
    out = {'space': 'source model space: +Y up, +Z forward, +X character left; p is relative to t=0, origin is the absolute AITrajectory translation at t=0 (e.g. choke lift)',
           'origin': root['origin'], 'end': root['end'], 'yawEnd': root['yaw'][-1] if root['yaw'] else 0.0,
           'pathLength': root['horizontalPathLength'], 'sourceDistance': root['sourceControllerDistance']}
    if moving or turning:
        out['t'] = [r4(t) for t in root['times']]
        out['p'] = [[r4(c) for c in p] for p in root['translation']]
        if turning:
            out['yaw'] = [r4(y) for y in root['yaw']]
    return out


def loop_hint(clip):
    name = clip['sourceName']
    return name.startswith(('L_', 'C_')) or '_Loop_' in name or name.endswith('_Loop_01') or 'Loop_PhysCtrl' in name


class Builder:
    def __init__(self, nodes, skin_name):
        self.nodes = nodes
        self.by_name = {n['name']: i for i, n in enumerate(nodes)}
        self.chunks = []
        self.length = 0
        self.views = []
        self.accessors = []
        self.animations = []
        self.skin_name = skin_name
        self.dedupe = {}
        self.shared = 0

    def accessor(self, values, kind, minmax=False):
        # All samples live in one bufferView (float32 only, so offsets stay 4-byte aligned);
        # byte-identical accessors are shared, which is lossless.
        arr = np.ascontiguousarray(np.asarray(values, dtype='<f4'))
        data = arr.tobytes()
        key = (kind, minmax, data)
        if key in self.dedupe:
            self.shared += 1
            return self.dedupe[key]
        offset = self.length
        self.chunks.append(data)
        self.length += len(data)
        acc = {'bufferView': 0, 'byteOffset': offset, 'componentType': 5126, 'count': arr.shape[0], 'type': kind}
        if minmax:
            acc['min'] = [float(arr.min())]
            acc['max'] = [float(arr.max())]
        self.accessors.append(acc)
        self.dedupe[key] = len(self.accessors) - 1
        return len(self.accessors) - 1

    def add_clip(self, clip):
        timing = clip['timing']
        frames = np.array(timing['sourceKeyFrames'], dtype=np.float64)
        sample_frames = np.array(timing['materializedFrames'], dtype=np.float64)
        times = np.array(timing['times'], dtype=np.float64)
        duration = timing['duration']
        times[-1] = duration
        time_acc = self.accessor(times, 'SCALAR', minmax=True)
        const_acc = None
        retained, skipped, duplicates, dup_diff = {}, [], [], 0.0
        for track in clip['tracks']:
            key = (track['bone'], track['property'])
            label = f'{track["bone"]}.{track["property"]}'
            if track['property'].startswith('scalar') or track['bone'] not in self.by_name or key == ('AITrajectory', 'translation'):
                skipped.append(label)
                continue
            if key in retained:
                a = np.array(retained[key]['values'], dtype=np.float64)
                b = np.array(track['values'], dtype=np.float64)
                if track['property'] == 'rotation':
                    a = a / np.linalg.norm(a, axis=1, keepdims=True)
                    b = b / np.linalg.norm(b, axis=1, keepdims=True)
                    sign = np.sign(np.sum(a * b, axis=1, keepdims=True)) if a.shape == b.shape else 1
                    b = b * sign
                if a.shape != b.shape:
                    if a.shape[0] == 1 or b.shape[0] == 1:
                        d = float(np.max(np.abs(a - b)))
                    else:
                        raise ValueError(f'{clip["id"]}: duplicate DOF shapes differ for {label}')
                else:
                    d = float(np.max(np.abs(a - b)))
                if d > DUPLICATE_TOLERANCE:
                    raise ValueError(f'{clip["id"]}: conflicting duplicate DOF {label} ({d})')
                dup_diff = max(dup_diff, d)
                duplicates.append(label)
                continue
            retained[key] = track
        anim = {'name': clip['id'], 'samplers': [], 'channels': []}
        constant_tracks = 0
        for (bone, prop), track in retained.items():
            values, constant = materialize(track, frames, sample_frames)
            size = 4 if prop == 'rotation' else 3
            if constant:
                if const_acc is None:
                    const_acc = self.accessor([0.0, duration], 'SCALAR', minmax=True)
                values = np.vstack([values[0], values[0]])
                input_acc = const_acc
                constant_tracks += 1
            else:
                input_acc = time_acc
            out = self.accessor(values.reshape(-1, size), 'VEC4' if size == 4 else 'VEC3')
            anim['samplers'].append({'input': input_acc, 'output': out, 'interpolation': 'LINEAR'})
            anim['channels'].append({'sampler': len(anim['samplers']) - 1,
                                     'target': {'node': self.by_name[bone], 'path': prop}})
        windows = clip.get('windows') or {}
        extras = {
            'source': clip['sourceName'], 'sourceControllerKey': clip['sourceControllerKey'],
            'sourceAnimationKey': clip['sourceAnimationKey'], 'codec': clip['codec'], 'dofSetList': clip['dofSetList'],
            'fps': clip['controller']['FPS'], 'timeScale': clip['controller']['TimeScale'],
            'trimOffset': clip['animationBase']['TrimOffset'], 'trimmedDuration': clip['animationBase']['TrimmedDuration'],
            'duration': duration, 'ticksPerSecondAssumed': timing['ticksPerSecondAssumed'],
            'additive': clip['additive'], 'loop': loop_hint(clip),
            'rootMotionRemoved': True, 'aiTrajectoryRotationRetained': True,
            'rootMotion': compact_root(clip['rootMotion']),
            'skippedChannels': sorted(set(skipped)), 'deduplicatedChannels': duplicates,
            'maxDuplicateDifference': dup_diff, 'unmappedSourceDofs': len(clip['unmapped']),
        }
        if clip['additive']:
            extras['additiveNote'] = 'Source additive deltas (local). Native composition order is unverified; do not play as an absolute pose.'
        if windows.get('hitWindows'):
            extras['hitWindow'] = windows['hitWindows'][0]
            extras['hitWindows'] = windows['hitWindows']
            extras['hitWindowSource'] = windows['hitWindowSource']
            extras['hitWindowTicks'] = windows['hitWindowTicks']
        for key in ('branchWindows', 'transitions', 'unstaggerable', 'triggerAffectorEnum', 'currentAbility',
                    'heroMelee_Attack_StrikeIndex', 'dodgeDirection', 'sequence', 'graphController', 'graphNodes', 'timeline'):
            if key in windows:
                extras[key] = windows[key]
        ant = [t for t in clip.get('antTags', []) if t['type'] in ('BranchOutPointTag', 'BranchInWindowTag', 'BoolGameStateTag', 'FloatGameStateTag')]
        if ant:
            extras['antTags'] = [{k: t[k] for k in ('type', 'branchTypeAsset', 'valueAsset', 'value', 'start', 'end', 'blendTicks') if t.get(k) is not None}
                                 for t in ant]
        anim['extras'] = extras
        self.animations.append(anim)
        return {'id': clip['id'], 'source': clip['sourceName'], 'duration': duration, 'tracks': len(retained),
                'constantTracks': constant_tracks, 'skipped': len(skipped), 'duplicates': len(duplicates)}

    def write(self, path, extras):
        pad = (-self.length) % 4
        if pad:
            self.chunks.append(b'\0' * pad)
            self.length += pad
        doc = {
            'asset': {'version': '2.0', 'generator': 'tools/characters/vader-build-glb.py'},
            'scene': 0,
            'scenes': [{'name': 'skeleton', 'nodes': [self.by_name['Reference']]}],
            'nodes': self.nodes,
            'animations': self.animations,
            'accessors': self.accessors,
            'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': self.length}],
            'buffers': [{'byteLength': self.length}],
            'extras': extras,
        }
        js = json.dumps(doc, separators=(',', ':')).encode()
        js += b' ' * ((-len(js)) % 4)
        binary = b''.join(self.chunks)
        total = 12 + 8 + len(js) + 8 + len(binary)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack('<II', len(binary), 0x004E4942))
            f.write(binary)
        return total


def main():
    data = json.loads(CLIPS.read_text())
    nodes, skin_name = skeleton_nodes()
    report = {}
    for key, out, label in (('clips', OUT_VADER, 'Darth Vader third-person clips'),
                            ('victimClips', OUT_VICTIM, 'Human-male (trooper) hero-reaction clips')):
        builder = Builder(json.loads(json.dumps(nodes)), skin_name)
        rows = [builder.add_clip(c) for c in data[key]]
        extras = {
            'description': label, 'evidenceId': data['evidenceId'], 'clipsJson': 'exports/characters/vader-animation/clips.json',
            'skeleton': skin_name, 'skeletonSource': 'web/public/assets/characters/stormtrooper.glb skin 0 (names and rest TRS)',
            'sourceBankSha256': data['sourceBankSha256'], 'sourceRig': data['sourceRig'],
            'conventions': data['conventions'],
            'unsupported': [u for u in data['unsupported'] if (u['group'] == 'vader') == (key == 'clips')],
            'missing': [m for m in data['missing'] if (m['group'] == 'vader') == (key == 'clips')],
            'limitations': [
                'Clip seconds assume 60 graph ticks per second (ClipInfo Length = TrimmedDuration / TimeScale; FPS=30, TimeScale=0.5 => 30 source frames per second). The tick rate itself is inferred.',
                'Native blend trees, sync groups, IK, procedural rig ops, warping and additive composition are not reproduced.',
                'AITrajectory translation is removed from tracks; apply extras.rootMotion through the movement controller if desired.',
                'Hit/branch windows come from the DefaultSoldierStateMachine EBX tags for the first graph usage of each clip.',
            ],
        }
        size = builder.write(out, extras)
        report[out.name] = {'bytes': size, 'animations': len(rows), 'accessors': len(builder.accessors),
                            'sharedAccessorReuses': builder.shared, 'rows': rows}
        print(out, size, 'bytes', len(rows), 'animations', len(builder.accessors), 'accessors', builder.shared, 'reused')
    (ROOT / 'exports/characters/vader-animation/glb-build-report.json').write_text(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
