"""Select bounded original door constants without mutating the scene manifest."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / 'exports/map-initial/door-map-evidence.json'
raw = path.read_bytes()
evidence = json.loads(raw)
graphs = {graph['source']['fileGuid']: graph for graph in evidence['graphs']}
controller, core = evidence['graphs'][:2]

def fields(graph):
    interface = next(node for node in graph['nodes'] if node['$type'].endswith('InterfaceDescriptorData'))
    return {field['Id'] & 0xffffffff: field for field in interface['Fields']}

def value(field):
    if not field or not field['Value']:
        return None
    kind, text = field['Value'].split(' ', 1)
    if kind == 'Boolean':
        return text == 'True'
    if kind == 'Float32':
        return float(text)
    raise ValueError(field)

def matrix(transform):
    return [transform[column][axis] if row < 3 else (1 if col == 3 else 0)
            for col, column in enumerate(['right', 'up', 'forward', 'trans'])
            for row, axis in enumerate(['x', 'y', 'z', None])]

def multiply(a, b):
    return [sum(a[k*4+row] * b[col*4+k] for k in range(4)) for col in range(4) for row in range(4)]

defaults = {key: value(field) for key, field in fields(controller).items()}
defaults.update({key: value(field) for key, field in fields(core).items() if value(field) is not None})
rows = []
for placement in evidence['placements']:
    leaves = [leaf for leaf in placement['leaves'] if leaf['sceneMatch']]
    if not leaves:
        continue
    wrapper = graphs[placement['wrapperGuid']]
    wrapper_fields = fields(wrapper)
    box = next(node for node in wrapper['nodes'] if node['$type'].endswith('OBBData'))
    controllers = {}
    for leaf in leaves:
        controller_id = leaf['controller']
        if controller_id not in controllers:
            resolved = dict(defaults)
            selected = []
            for connection in wrapper['connections']:
                if connection['kind'] != 'PropertyConnections' or connection['target'] != controller_id or connection['sourceType'] != 'InterfaceDescriptorData':
                    continue
                source = wrapper_fields[connection['raw']['SourceFieldId'] & 0xffffffff]
                incoming = value(source)
                if incoming is not None:
                    resolved[connection['raw']['TargetFieldId'] & 0xffffffff] = incoming
                selected.append({'connectionIndex': connection['index'], 'sourceField': source,
                                 'targetField': connection['raw']['TargetField']})
            # Source CompareBool.OnTrue -> Select0/1/2, respectively X/Z/Y.
            axes = [axis for axis, field in [(0, 0xd3e84efd), (2, 0xcf3bdcbf), (1, 0xc8ab0e5c)] if resolved.get(field) is True]
            assert len(axes) == 1
            assert resolved[0x50840031] == .75
            assert resolved[0x0028a000] is True
            controllers[controller_id] = {'axis': axes[0], 'resolved': resolved, 'bindings': selected}
        config = controllers[controller_id]
        distance_field = {'0x1c5bae68': 0xc378230f, '0x014d2c13': 0xee495e74}.get(leaf['controllerLinkField'])
        assert distance_field is not None, leaf['controllerLinkField']
        distance = config['resolved'][distance_field]
        assert isinstance(distance, (int, float)) and distance != 0
        # TransformBuilder.IsWorldSpace=false; preserve each linked leaf basis.
        offset = [leaf['matrix'][config['axis']*4+i] * distance for i in range(3)]
        leaf['opening'] = {'axis': config['axis'], 'distance': distance, 'worldOffset': offset,
                           'distanceField': hex(distance_field), 'duration': .75,
                           'wrapperBindings': config['bindings']}
    rows.append({'id': placement['mapObjectId'], 'wrapperGuid': placement['wrapperGuid'],
                 'trigger': {'matrix': multiply(placement['matrix'], matrix(box['Transform'])),
                             'halfExtents': [box['HalfExtents'][axis] for axis in ['x', 'y', 'z']],
                             'sourceObject': box['$id']},
                 'leaves': leaves})

document = {'version': 1, 'evidenceId': 'BF2-DOOR-CONFIG-003', 'doors': rows,
            'provenance': {'evidenceFile': path.relative_to(ROOT).as_posix(),
                           'evidenceSha256': hashlib.sha256(raw).hexdigest(), 'runtimeObserved': False,
                           'observed': ['Exact map/wrapper/model transforms and all62 matched mesh placements.',
                                        'Wrapper distances,0.75 duration,Sine/EaseOut enum and source OBB half extents.',
                                        'Axis flags selectX for doubles andY for singles through CompareBool/SelectVec3 wiring.',
                                        'Controller StartOpen uses explicitfalse fallback. Core neutral TeamId0 selects the all-actors trigger when enabled.'],
                           'inferred': ['Browser uses alive actor capsule centers for OBB occupancy; native trigger inclusion/contact semantics are not executed.',
                                        'Sine/EaseOut is interpreted as sin(pi*t/2); transition reversal starts a fresh0.75-second segment.',
                                        'Original local translation is composed with each source leaf basis; native transform entity execution is not observed.',
                                        'Render-triangle collision translates with each leaf. Native moving rigid bodies, audio, indicators and crush response remain incomplete.']}}
assert len(rows) == 17 and sum(len(row['leaves']) for row in rows) == 62
output = ROOT / 'web/public/assets/source-doors.json'
output.write_text(json.dumps(document, indent=2), encoding='utf-8')
print(json.dumps({'output': str(output), 'doors': len(rows), 'leaves': 62}))
