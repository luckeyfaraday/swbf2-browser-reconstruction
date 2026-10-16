"""Bounded static door graph and exact existing scene-placement correspondence."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/map-initial/door-map-evidence.json'

def read(path):
    raw = path.read_bytes()
    doc = json.loads(raw)
    return doc, {'file': path.relative_to(ROOT).as_posix(),
                 'jsonSha256': hashlib.sha256(raw).hexdigest(),
                 'fileGuid': doc['asset']['fileGuid'], 'name': doc['entry']['name']}

def field_hash(name):
    value = 5381
    for char in name:
        value = ((value * 33) ^ ord(char)) & 0xffffffff
    return value

def m4(transform):
    if transform is None:
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    return [transform[column][axis] if row < 3 else (1 if col == 3 else 0)
            for col, column in enumerate(['right', 'up', 'forward', 'trans'])
            for row, axis in enumerate(['x', 'y', 'z', None])]

def multiply(a, b):
    return [sum(a[k*4+row] * b[col*4+k] for k in range(4))
            for col in range(4) for row in range(4)]

paths = [next((ROOT / 'exports/map-initial/spatial-extra4/ebx').glob('*PF_AutomaticDoor_Controller*')),
         next((ROOT / 'exports/map-initial/spatial-extra3/ebx').glob('*PF_AutomaticDoor_Core*'))]
paths += [next((ROOT / 'exports/map-initial/spatial-extra2/ebx').glob(pattern)) for pattern in
          ['*AutomaticSingleDoor*', '*AutomaticDoubleDoor_Large*', '*automaticdoubledoor_small*']]
map_path = next((ROOT / 'tools/gameplay-recovery/map/ebx').glob('*TeamDeathmatch_Global*'))
map_doc, map_source = read(map_path)
documents = [read(path) for path in paths]
manifest_bytes = (ROOT / 'web/public/assets/map.scene.json').read_bytes()
manifest = json.loads(manifest_bytes)
labels = set('In Out InValue Value DefaultValue StartOpen IsOpen Input Output InputSelect BlendValue BlendValue2 Trans X Y Z Transform WorldTransform Duration Result OnTrue OnFalse'.split())
labels.update(f'In{i}' for i in range(9))
labels.update(f'Select{i}' for i in range(3))
for doc, _ in documents:
    for obj in doc['asset']['objects']:
        labels.update(key for key in obj if not key.startswith('$') and not key.startswith('__'))
known = {field_hash(name): name for name in labels}

def graph(doc, source):
    objects = doc['asset']['objects']
    root = objects[0]
    nodes = {o['$id']: o for o in objects}
    rows = []
    for kind in ['PropertyConnections', 'EventConnections', 'LinkConnections']:
        for index, connection in enumerate(root.get(kind, [])):
            row = {'kind': kind, 'index': index, 'source': connection['Source'].get('$ref'),
                   'target': connection['Target'].get('$ref'), 'raw': connection}
            for endpoint in ['Source', 'Target']:
                node = nodes.get(connection[endpoint].get('$ref'), {})
                row[endpoint.lower()+'Type'] = node.get('$type', '').split('.')[-1]
                value = connection.get(endpoint+'FieldId', connection.get(endpoint+'Event', {}).get('Id'))
                if value is not None:
                    row[endpoint.lower()+'Label'] = known.get(value & 0xffffffff, hex(value & 0xffffffff))
            rows.append(row)
    return {'source': source, 'nodes': [{k: v for k, v in o.items() if not k.startswith('__')}
                                      for o in objects[1:]], 'connections': rows}

wrappers = {doc['asset']['fileGuid']: (doc, source) for doc, source in documents[2:]}
placed = []
model_sources = {}
for index, obj in enumerate(map_doc['asset']['objects']):
    guid = obj.get('Blueprint', {}).get('$external')
    if guid not in wrappers:
        continue
    assert obj['Excluded'] is False and obj['ObjectVariation'] is None
    wrapper, source = wrappers[guid]
    root = wrapper['asset']['objects'][0]
    nodes = {o['$id']: o for o in wrapper['asset']['objects']}
    leaves = []
    for connection in root.get('LinkConnections', []):
        leaf = nodes.get(connection['Target'].get('$ref'), {})
        name = leaf.get('Blueprint', {}).get('name', '')
        if '/DSI_Door_' not in name:
            continue
        model_guid = leaf['Blueprint']['$external']
        model_path = next((ROOT / 'exports/map-initial/spatial-extra3/ebx').glob(f'*__{model_guid}.json'))
        model, model_source = read(model_path)
        model_sources[model_guid] = model_source
        static = next(o for o in model['asset']['objects'] if o['$type'].endswith('StaticModelEntityData'))
        mesh_guid = static['Mesh']['$external']
        transform = multiply(multiply(m4(obj['BlueprintTransform']), m4(leaf.get('BlueprintTransform'))), m4(static.get('Transform')))
        matches = [{'index': i, 'source': instance['source'],
                    'maximumMatrixError': max(abs(a-b) for a, b in zip(transform, instance['matrix']))}
                   for i, instance in enumerate(manifest['instances']) if instance['assetId'] == mesh_guid
                   and max(abs(a-b) for a, b in zip(transform, instance['matrix'])) < .0001]
        assert len(matches) <= 1, (obj['$id'], leaf['$id'], mesh_guid, len(matches))
        leaves.append({'wrapperObject': leaf['$id'], 'controller': connection['Source']['$ref'],
                       'controllerLinkField': connection['SourceField'],
                       'meshGuid': mesh_guid, 'matrix': transform, 'sceneMatch': matches[0] if matches else None})
    assert leaves
    placed.append({'mapObjectIndex': index, 'mapObjectId': obj['$id'], 'wrapperGuid': guid,
                   'wrapperSource': source, 'matrix': m4(obj['BlueprintTransform']), 'leaves': leaves})

root = map_doc['asset']['objects'][0]
report = {'evidenceId': 'BF2-DOOR-MAP-002', 'runtimeObserved': False,
          'mapSource': map_source, 'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
          'mapConnections': {kind: root.get(kind, []) for kind in ['PropertyConnections', 'EventConnections', 'LinkConnections']},
          'mapInterface': root.get('Interface'), 'placements': placed,
          'modelSources': list(model_sources.values()), 'graphs': [graph(doc, source) for doc, source in documents],
          'hashLabels': [{'name': name, 'hash': hex(field_hash(name))} for name in sorted(labels)],
          'observations': ['All selected map door references are included with no object variation.',
                           'Matched controller-linked leaves correspond to exactly one browser scene placement within 0.0001 world matrix element tolerance. Unmatched leaves are retained explicitly; the browser scene has a selected-region filter.',
                           'Controller StartOpen feeds a PropertyDefaultValueEntityData whose DefaultValue is wired from an explicit Boolean False interface field. Empty map/wrapper values and native dynamic-port semantics still need separate interpretation.'],
          'unknowns': ['Native default-value port evaluation and event initialization order.',
                       'Trigger activation and blend direction/axis precedence.',
                       'No runtime motion/collision is changed by this audit.']}
assert len(placed) == 18
assert all(not report['mapConnections'][kind] for kind in report['mapConnections'])
OUT.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'output': str(OUT), 'doors': len(placed), 'leaves': sum(len(p['leaves']) for p in placed),
                  'matchedLeaves': sum(bool(leaf['sceneMatch']) for p in placed for leaf in p['leaves']),
                  'graphs': len(report['graphs']), 'runtimeObserved': False}))
