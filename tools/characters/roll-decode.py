"""Decode only the four source-selected rifle roll clips; preserve source clocks.

Run roll-recover.mjs first. No character GLB or shared runtime is modified.
"""
import hashlib
import json
import pathlib
from importlib.machinery import SourceFileLoader

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[1]
decoder = SourceFileLoader('roll_raw_decoder', str(BASE / 'decode-animation.py')).load_module()
bank = decoder.bank


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    graph_path = ROOT / 'web/public/assets/roll-graph.json'
    graph_bytes = graph_path.read_bytes()
    graph = json.loads(graph_bytes)
    actual_bank_hash = digest(bank.data)
    if actual_bank_hash != bank.metadata['sha256']:
        raise ValueError('Retained ANT bank differs from decoded inventory')
    selected_keys = set()
    sections = {s['object']['values'].get('__key'): s for s in bank.metadata['sections'] if 'object' in s}

    def source_object(key):
        selected_keys.add(key)
        return bank.objects[key]

    clips = []
    for source in graph['clips']:
        controller = source_object(source['controllerKey'])
        if controller['type'] != 'ClipControllerAsset':
            raise ValueError('Roll graph did not select an ANT clip controller')
        animation_key = controller['values']['Anim']
        animation = source_object(animation_key)
        clip = decoder.decode(animation_key, 'rifle-roll-' + source['direction'])
        if clip['controller']['__key'] != source['controllerKey']:
            raise ValueError('Decoder selected a different controller for reused animation')
        if clip['unmapped'] or clip['additive'] or clip['cycle']:
            raise ValueError('Unexpected unsupported roll clip shape')
        base = animation['base']['values']
        scale = controller['values']['TimeScale']
        computed_length = base['TrimmedDuration'] / scale
        if abs(computed_length - source['lengthTicks']) > 0.00002:
            raise ValueError('Graph length and ANT trim/scale no longer agree')
        clip.pop('times')
        clip.pop('duration')
        clip['direction'] = source['direction']
        clip['lengthTicks'] = source['lengthTicks']
        clip['sampleFrames'] = bank.array(animation['values']['KeyTimes'])
        clip['timeDomain'] = 'source-animation-key-time'
        clip['sourceTimeMapping'] = {
            'trimOffset': base['TrimOffset'],
            'trimmedDuration': base['TrimmedDuration'],
            'endFrame': base['EndFrame'],
            'timeScale': scale,
            'fps': controller['values']['FPS'],
            'graphTicksPerSecond': None,
            'inferredSampleFrameFormula': 'trimOffset + graphTick * timeScale',
            'support': 'TrimmedDuration / TimeScale matches selected EBX Length for all four clips.',
            'runtimeObserved': False,
        }
        clip['trajectory'] = source['trajectory']
        clip['channelTags'] = source['channelTags']
        clip['sourceClipId'] = source['clipId']
        clips.append(clip)
        for key in [base['ChannelToDofAsset'], base['DofSetList']]:
            source_object(key)
        hierarchy = bank.objects[base['DofSetList']]['values']
        for key in bank.array(hierarchy['LayoutAssets']):
            source_object(key)

    rig_key = '4df8f37fade10ee2'
    rig = source_object(rig_key)
    for key in bank.array(rig['values']['RigDofSets']):
        source_object(key)
    enum_key = '75ea42fc6184cad4'
    rig_enum = source_object(enum_key)
    enum_asset = source_object(rig_enum['values']['EnumerationAsset'])
    enum_values = [source_object(k)['values'] for k in bank.array(enum_asset['values']['EnumerationValues'])]
    rig_selection = {'enumKey': enum_key, 'name': rig_enum['values']['__name'], 'default': rig_enum['values']['Default'],
                     'values': [{'value': v['Value'], 'name': v['__name']} for v in enum_values],
                     'interpretation': 'Base clips use 3P (1). AI (2) overrides select the same body animation. 1P (0) uses a different clip and is not emitted.'}
    ranges = []
    for key in sorted(selected_keys):
        s = sections[key]
        start, size = s['offset'], s['bytes']
        ranges.append({'key': key, 'type': s['object']['type'], 'name': s['object']['values']['__name'],
                       'offset': start, 'length': size, 'sha256': digest(bank.data[start:start + size])})
    report = {
        'evidenceId': 'EV-ROLL-ANIM-20261015-01',
        'evidenceType': 'decoded-installed-ANT-raw-animation', 'runtimeObserved': False,
        'sourceBank': str(bank.metadata['source']).replace('\\', '/'), 'sourceSha256': actual_bank_hash,
        'sourceInventory': 'exports/characters/ant-common-bank/bank-inventory.json',
        'sourceInventorySha256': digest((bank.folder / 'bank-inventory.json').read_bytes()),
        'sourceGraph': 'web/public/assets/roll-graph.json', 'sourceGraphSha256': digest(graph_bytes),
        'sourceRig': rig['values']['__name'], 'sourceRigKey': rig_key,
        'rigSelection': rig_selection, 'selectedObjectRanges': ranges,
        'decoder': {'file': 'tools/characters/decode-animation.py', 'sha256': digest((BASE / 'decode-animation.py').read_bytes())},
        'clips': clips,
        'limitations': [
            'Raw sample dimensions, rig DOF mapping, finite values, and quaternion norms are checked. Static decoding does not observe native execution.',
            'The native graph tick rate is unknown. No seconds-based duration is emitted; runtime playback requires an explicit caller choice.',
            'The trim/scale sample-clock mapping is a corroborated inference from four independent clip lengths, not native evaluator code.',
            'Root trajectory translation is preserved in the data for collision-aware integration. Body playback must remove AITrajectory translation to avoid applying movement twice.',
            'Non-bone scalar channels, procedural rig features, IK, first-person arm clips, and native direction/steering formulas are not implemented.',
        ],
    }
    output = ROOT / 'web/public/assets/roll-clips.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf8')
    print(json.dumps({'output': str(output), 'bytes': output.stat().st_size, 'clips': [
        {'direction': c['direction'], 'tracks': len(c['tracks']), 'samples': len(c['sampleFrames']),
         'maxQuaternionNormError': c['maxQuaternionNormError']} for c in clips]}))


if __name__ == '__main__':
    main()
