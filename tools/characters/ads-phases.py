"""Recover bounded ADS transition blends and complete timeline-tag inheritance.

The common inventory exposes only the first inherited base. Re-read the deeper
source REF2-defined bases, preserving their exact fields and byte bounds. This
does not execute or assign a seconds clock to ANT's transition evaluator.
"""
import hashlib
import json
import struct
from pathlib import Path
from importlib.machinery import SourceFileLoader

ROOT = Path(__file__).resolve().parents[2]
selection = SourceFileLoader('ads_phase_select', str(ROOT / 'tools/characters/select-animation.py')).load_module()
bank = selection.AnimationBank('exports/characters/ant-common-bank')
classes = {c['hash']: c for c in bank.metadata['classes']}
sections = {s['object']['values']['__key']: s for s in bank.metadata['sections'] if 'object' in s}
records = {}


def integer(at, fmt='I'):
    return struct.unpack_from('<' + fmt, bank.data, at)[0]


def parse(header, begin, end, depth=0):
    assert depth < 12
    cls = classes[integer(header + 16)]
    base = header + integer(header + 28, 'H')
    assert begin <= base <= base + cls['size'] <= end
    values, arrays = {}, {}
    for field in cls['fields']:
        at, typ = base + field['offset'], field['type']
        if field['flags'] == 1 or typ == 'String':
            capacity, count = integer(at), integer(at + 4)
            offset = at + 8 + integer(at + 8, 'i')
            elem = classes[field['typeHash']]
            size = 1 if typ == 'String' else (elem['size'] + elem['alignment'] - 1) // elem['alignment'] * elem['alignment']
            assert count <= capacity and (not count or begin <= offset <= offset + count * size <= end)
            if typ == 'String':
                value = bank.data[offset:offset + count].rstrip(b'\0').decode()
            else:
                value = {'arrayOffset': offset, 'count': count, 'byteLength': count * size, 'elementType': typ}
                if typ in ['Key', 'Float', 'UInt8', 'UInt16', 'UInt32', 'Int16']:
                    arrays[field['name']] = bank.array(value)
        elif typ == 'DataRef':
            value = {'referenceOffset': at + integer(at, 'i') if integer(at, 'i') else None}
        elif typ == 'Key':
            value = f'{integer(at, "Q"):016x}'
        elif typ in ['Bool', 'Int8', 'UInt8', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Float', 'Double']:
            value = integer(at, {'Bool': '?', 'Int8': 'b', 'UInt8': 'B', 'Int16': 'h', 'UInt16': 'H',
                                 'Int32': 'i', 'UInt32': 'I', 'Float': 'f', 'Double': 'd'}[typ])
        else:
            value = {'unknownType': typ, 'offset': at, 'size': field['size']}
        values[field['name']] = value
    result = {'type': cls['name'], 'headerOffset': header, 'dataOffset': base, 'values': values, 'arrays': arrays}
    parent = values.get('__base', {}).get('referenceOffset')
    if parent:
        result['base'] = parse(parent, begin, end, depth + 1)
    return result


def levels(o):
    while o:
        yield o
        o = o.get('base')


def flat(o):
    result = {}
    for level in levels(o):
        for key, value in level['values'].items():
            if not key.startswith('__'):
                result.setdefault(key, value)
    return result


def keep(key, follow=False):
    if key in records or key not in sections:
        return records.get(key)
    s = sections[key]
    result = parse(s['offset'] + 12, s['offset'], s['offset'] + s['bytes'])
    result['sourceRange'] = {'offset': s['offset'], 'bytes': s['bytes'],
                            'sha256': hashlib.sha256(bank.data[s['offset']:s['offset'] + s['bytes']]).hexdigest()}
    records[key] = result
    if follow:
        # Tag sets/collections and tags may recurse; selectors and state nodes
        # are deliberately excluded from traversal to bound this export.
        fields = ['TagCollectionKeys', 'TagKeys', 'MonitoredTags', 'ConditionsRequiredTrue', 'ConditionsRequiredFalse']
        refs = ['TagCollectionSet', 'OverrideBlend', 'BlendAsset', 'BranchWindowTypeAsset',
                'BranchInWindowTypeAsset', 'BranchTypeAsset', 'ValueAsset', 'DestinationPhaseSignal']
        for level in levels(result):
            for field in fields:
                for child in level['arrays'].get(field, []):
                    keep(child, True)
            for field in refs:
                keep(level['values'].get(field), True)
    return result


def tags(controller):
    tag_set = flat(keep(controller)).get('TagCollectionSet')
    if not tag_set or tag_set not in sections:
        return []
    keep(tag_set, True)
    tag_ids = []
    for collection in records[tag_set]['arrays']['TagCollectionKeys']:
        for level in levels(records[collection]):
            tag_ids.extend(level['arrays'].get('TagKeys', []))
    result = []
    for key in tag_ids:
        row = records[key]
        fields = flat(row)
        for field in ['BlendAsset', 'BranchTypeAsset', 'ValueAsset']:
            target = fields.get(field)
            if target in records:
                fields[field + 'Name'] = records[target]['values']['__name']
        result.append({'key': key, 'type': row['type'], 'fields': fields,
                       'arrays': {k: v for level in levels(row) for k, v in level['arrays'].items()}})
    return result


def main():
    source = json.loads((ROOT / 'web/public/assets/firstperson-ads.json').read_text())
    nodes = {'enter': '4980525082f6f0ec', 'pose': 'b2734f5424fc5f4e', 'exit': '48055b5e2116b087'}
    transitions, incoming = [], []
    for role, key in nodes.items():
        node = keep(key, True)
        for child in node['arrays']['Transitions']:
            transition = keep(child, True)
            row = {'role': role, 'key': child, 'fields': flat(transition)}
            row['conditionsTrue'] = [records[k]['values']['__name'] for k in transition['arrays']['ConditionsRequiredTrue']]
            row['conditionsFalse'] = [records[k]['values']['__name'] for k in transition['arrays']['ConditionsRequiredFalse']]
            blend = transition['values']['OverrideBlend']
            if blend in records:
                row['blend'] = {'type': records[blend]['type'], 'fields': flat(records[blend]),
                                'samples': records[blend]['arrays'].get('Samples')}
            transitions.append(row)
    for key, o in bank.objects.items():
        values = o['values']
        if values.get('To') in nodes.values() and values.get('From') not in nodes.values():
            origin = bank.objects.get(values.get('From'), {}).get('values', {})
            if origin.get('StateFlowController') == 'fe03b295e4783abc':
                keep(key, True)
                incoming.append({'key': key, 'origin': origin['__name'], 'fields': flat(records[key])})
    clip_tags = {weapon: {role: tags(w['clips'][role]['controller']['__key']) for role in ['enter', 'exit']}
                 for weapon, w in source['weapons'].items()}
    node_tags = {role: tags(key) for role, key in nodes.items()}
    result = {'evidenceId': 'BF2-FIRSTPERSON-ADS-PHASE-001', 'sourceBankSha256': source['source']['sha256'],
              'runtimeObserved': False, 'records': records, 'transitions': transitions, 'incoming': incoming,
              'clipTags': clip_tags, 'nodeTags': node_tags,
              'limitations': ['Fields are decoded from complete source REF2 base chains with original bank byte ranges.',
                              'BlendTime and tag link offsets are retained in their source domain; ticks per second is unresolved.',
                              'BranchOutPointTag.Active=false is the serialized field; runtime tag activation semantics are not inferred from it.',
                              'LinkFlags and BranchInPhase numeric enums are retained; native evaluator semantics are not claimed.',
                              'Bezier Samples are original float arrays. Their exact interpolation/evaluation convention remains unresolved.',
                              'No additional pose offsets, curve fitting or playback changes are made.']}
    (ROOT / 'exports/firstperson-ads/phases.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({'records': len(records), 'transitions': len(transitions), 'incoming': len(incoming),
                      'output': 'exports/firstperson-ads/phases.json'}, indent=2))


if __name__ == '__main__':
    main()
