"""Exact selected rigid32 ExteriorNoScale routes; unknown pass inputs stay free."""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/native-tangent-exterior32'
OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('routing', Path(__file__).with_name('propspreset-routing.py'))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
T, B = R.t, R.b
read = lambda p: json.loads((ROOT / p).read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
graph = read('exports/materials/exterior-noscale-shader/graph.json')
B.EDGES, R.REVERSE = collections.defaultdict(list), collections.defaultdict(list)
for edge in graph['edges']:
    B.EDGES[edge['from']].append(edge)
    R.REVERSE[edge['to']].append(edge['from'])


def path(start, target):
    queue, seen = collections.deque([(start, [])]), set()
    while queue:
        key, route = queue.popleft()
        if key == target:
            for edge in route:
                n = struct.unpack_from('<Q', T.raw(edge['from']), edge['offset'])[0]
                assert n == int(edge['encoded']) and B.ref(n) == edge['to']
            return route
        if key in seen:
            continue
        seen.add(key)
        queue.extend((edge['to'], route + [edge]) for edge in B.EDGES[key])
    return None


assert graph['rootBlocks'] == ['3f3868dbc7']
root = T.raw(graph['rootBlocks'][0])
refs = {offset: B.ref(struct.unpack_from('<Q', root, offset)[0]) for offset in [16, 24, 32, 40]}
T.KEYS, T.PERMUTATIONS = T.refs(refs[40]), T.refs(refs[24])
T.VALUES = [v[0] for v in struct.iter_unpack('<Q', T.raw(refs[32]))]
words = [v[0] for v in struct.iter_unpack('<H', T.raw(refs[16]))]
tree = T.decode(words)
keys = {str(int(T.META[k]['values'][0]['hash']) & 0xffffffffffff): k for k in T.KEYS}
scene = read('web/public/assets/map.scene.json')
assets = {a['id']: a for a in scene['assets']}
lods = read('web/public/assets/source-lods.json')['assets']
selected_assets = {'557f9d2e-bba7-63a8-3c76-90bd3ebad68f', '1b862ea2-ae23-dfc4-47b0-ce224ede539e', '2bfcbed2-5e34-e383-9d31-14b160cb586f'}
all_instances = {ps: R.instance_bindings(ps) for ps in ['87f18d3646', 'b584a44bc0']}
targets, routes, shaders = [], [], {}
for row in read('exports/materials/exterior-noscale-shader/material-analysis.json')['materials']:
    if row['assetId'] not in selected_assets:
        continue
    section = R.BLOCKS[row['sourceEntry']]['children'][row['sourceSection']]
    supplied = {}
    for block, param in R.params_under(section):
        if param['packedFlags'] in keys:
            key = keys[param['packedFlags']]
            supplied[key] = dict(rawHex=param['rawHex'], valueHash=str(T.hash_value(key, bytes.fromhex(param['rawHex']))),
                                 sourceBlock=block['source']['rid'], sourceOffset=param['offset'], sourceBlockSha256=block['sha256'])
    selected = sorted(T.candidates(tree, {k: int(v['valueHash']) for k, v in supplied.items()}))
    reachable = set().union(*(B.reachable(T.PERMUTATIONS[i]) for i in selected))
    selected_shaders = []
    for ps, expected_vs in [('87f18d3646', 'dfb8f760fb'), ('b584a44bc0', '13f25cb3dd')]:
        matches = [i for i in all_instances[ps] if i['instance'] in reachable]
        assert len(matches) == 1 and matches[0]['pairedVertexShader'] == expected_vs
        instance = matches[0]['instance']
        permutation_paths = [path(T.PERMUTATIONS[i], instance) for i in selected]
        permutation_paths = [p for p in permutation_paths if p is not None]
        assert len(permutation_paths) == 1
        vertex_object = next(k for k, v in graph['blocks'].items() if v['type'].endswith('Dx11VsShader') and any(e['to'] == expected_vs for e in B.EDGES[k]))
        layout = next(e['to'] for e in B.EDGES[vertex_object] if e['offset'] == 48)
        assert layout == 'ad2dd1141c'
        shader = dict(vertex=expected_vs, pixel=ps, atlas=ps == 'b584a44bc0', instance=instance,
                      inputLayoutBlock=layout, inputLayoutSha256=sha(T.raw(layout)),
                      paths=dict(permutation=permutation_paths[0], vertex=path(instance, expected_vs), pixel=path(instance, ps), layout=path(vertex_object, layout)))
        for label in ['vertex', 'pixel']:
            dxbc = (ROOT / f'exports/materials/exterior-noscale-shader/{shader[label]}.dxbc').read_bytes()
            raw = T.raw(shader[label]); start = raw.index(b'DXBC')
            assert dxbc == raw[start:start + struct.unpack_from('<I', raw, start + 24)[0]]
            shader[label + 'Sha256'] = sha(dxbc)
        shader['inputLayout'] = [dict(semanticIndex=i, dxgiFormat=fmt, slot=slot, offset=offset, classification=kind, step=step)
                                for _, i, fmt, slot, offset, kind, step in struct.iter_unpack('<Q6I', T.raw(layout))]
        shaders[(expected_vs, ps)] = shader
        selected_shaders.append(shader)
    route = dict(assetId=row['assetId'], sourceMaterialId=row['materialId'], sourceEntry=row['sourceEntry'], sourceSection=row['sourceSection'],
                 variationHash=0, treeInputs=supplied, permutationIndices=selected,
                 permutationBlocks=[T.PERMUTATIONS[i] for i in selected], shaders=selected_shaders)
    routes.append(route)
    a = assets[row['assetId']]
    base = dict(assetId=a['id'], name=a['name'], sourceLod=0, sourceMaterialId=row['materialId'], lod0MaterialId=row['materialId'],
                family='exterior-noscale', sourceShader=row['sourceShader'], glbPath='web/public/assets/' + a['url'],
                placementCount=row['placementCount'], selectedShaderRoute=route)
    targets.append(base)
    for asset in lods:
        if asset['assetId'] != a['id']:
            continue
        for lod in asset['lods']:
            for section in lod['sections']:
                if section['lod0MaterialId'] == row['materialId']:
                    assert section['materialParametersEqualLod0'] and section['sharedParameterRoot']
                    targets.append(dict(base, sourceLod=lod['level'], sourceMaterialId=section['sourceMaterialId'], glbPath='web/public' + lod['url'], lodSourceMaterial=section))
assert sum(r['placementCount'] for r in targets if r['sourceLod'] == 0) == 82
identity = 'BF2-NATIVE-TANGENT-EXTERIOR32-001'
selection = dict(evidenceId=identity, targets=targets, excluded=[], sourceMaterialsSha256=sha((ROOT / 'web/public/assets/recovered-exterior-noscale-materials.json').read_bytes()))
(OUT / 'selection.json').write_text(json.dumps(selection, indent=2) + '\n')
(OUT / 'names.txt').write_text('\n'.join(f"{r['name']}|{r['sourceLod']}|{r['sourceMaterialId']}" for r in targets) + '\n')
routing = dict(evidenceId=identity, sourceRvmSha256=sha(T.DATA), sourceStride=32, shaders=list(shaders.values()), sectionRoutes=routes,
               tree=dict(root=graph['rootBlocks'][0], references=refs, words=len(words), nodes=len(tree['nodes']), backreferences=len(tree['backreferences']), completeByteCoverage=True),
               frameEquation='Original signed32 forward-transform frame, independent source BinormalSign.',
               limitations=['Unknown pass inputs remain free. Ordinary and atlas paired VS are uniquely selected by exact compiled section inputs.',
                            'Rigid source declarations only. No live native dispatch captured.',
                            'Candidate remains outside public assets; exact GLB mapping and original VS execution are independently required.'])
(OUT / 'shader-routing.json').write_text(json.dumps(routing, indent=2) + '\n')
print(json.dumps(dict(records=len(targets), baseInstances=82, shaders=list(shaders))))
