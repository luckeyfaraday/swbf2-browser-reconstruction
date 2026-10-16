"""Bind PropsPreset frame candidates to the selected original permutation graph."""
import collections
import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
read = lambda p: json.loads((ROOT / p).read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
source = read('exports/materials/propspreset-routing/routing-evidence.json')
graph = read('exports/materials/propspreset-shader/graph.json')
raw = (ROOT / 'exports/materials/rvm/0.res').read_bytes()
index = read('exports/materials/rvm/block-index.json')['blocks']
links = collections.defaultdict(list)
for edge in graph['edges']:
    links[edge['from']].append(edge)


def block(key):
    row = index[key]
    return raw[row['offset']:row['offset'] + row['size']]


def route(start, target, limit=16):
    queue = collections.deque([(start, [])])
    visited = set()
    while queue:
        node, path = queue.popleft()
        if node == target:
            for edge in path:
                value = struct.unpack_from('<Q', block(edge['from']), edge['offset'])[0]
                assert value == int(edge['encoded']) and value & 0xffffffffff == int(edge['to'], 16)
            return path
        if node in visited or len(path) >= limit:
            continue
        visited.add(node)
        for edge in links[node]:
            queue.append((edge['to'], path + [edge]))
    return None


scene = read('web/public/assets/map.scene.json')
assets = {a['id']: a for a in scene['assets']}
counts = collections.Counter(i['assetId'] for i in scene['instances'])
lods = read('web/public/assets/source-lods.json')['assets']
retained = {(r['assetId'], r['sourceLod'], r['sourceMaterialId']): r
            for r in read('exports/lighting/static-atlas-all-uv/manifest.json')['records']}
targets = []
section_routes = []
for section in source['sections']:
    selected = []
    for ps in [section['ordinaryPixelShader']] + section['atlasPixelShaders']:
        matches = []
        for instance in source['shaders'][ps]['instances']:
            paths = [route(p, instance['instance']) for p in section['permutationBlocks']]
            paths = [p for p in paths if p is not None]
            if paths:
                assert len(paths) == 1
                vs = instance['pairedVertexShader']
                vertex_object = next(k for k, r in graph['blocks'].items()
                                     if r['type'].endswith('Dx11VsShader') and any(e['to'] == vs for e in links[k]))
                layout = next(e['to'] for e in links[vertex_object] if e['offset'] == 48)
                pixel_path = route(instance['instance'], ps)
                vertex_path = route(instance['instance'], vs)
                assert pixel_path and vertex_path
                matches.append(dict(vertex=vs, pixel=ps, atlas=ps != section['ordinaryPixelShader'],
                                    instance=instance['instance'], function=instance['function'],
                                    vertexObject=vertex_object, inputLayoutBlock=layout,
                                    paths=dict(permutation=paths[0], vertex=vertex_path, pixel=pixel_path,
                                               layout=route(vertex_object, layout))))
        assert len(matches) == 1, (section['assetId'], ps, matches)
        selected.extend(matches)
    route_record = dict(assetId=section['assetId'], sourceMaterialId=section['materialId'],
                        sourceEntry=section['sourceEntry'], sourceSection=section['sourceSection'],
                        sourcePermutationIndices=section['permutationIndices'],
                        sourcePermutationBlocks=section['permutationBlocks'], shaders=selected)
    section_routes.append(route_record)
    asset = assets[section['assetId']]
    base = dict(assetId=asset['id'], name=asset['name'], sourceLod=0,
                sourceMaterialId=section['materialId'], lod0MaterialId=section['materialId'],
                family='propspreset', sourceShader=source['sourceShader'],
                glbPath='web/public/assets/' + asset['url'], placementCount=counts[asset['id']],
                selectedShaderRoute=route_record)
    targets.append(base)
    for a in lods:
        if a['assetId'] != asset['id']:
            continue
        for lod in a['lods']:
            for s in lod['sections']:
                if s['lod0MaterialId'] == section['materialId']:
                    assert s['materialParametersEqualLod0'] and s['sharedParameterRoot']
                    targets.append(dict(base, sourceLod=lod['level'], sourceMaterialId=s['sourceMaterialId'],
                                        glbPath='web/public' + lod['url'], lodSourceMaterial=s))

for stride, previous, layout in [(32, 'native-tangent32', 'ad2dd1141c'),
                                 (36, 'native-tangent-coverage', '07a62c2c96')]:
    out = ROOT / f'exports/materials/native-tangent-propspreset{stride}'
    out.mkdir(parents=True, exist_ok=True)
    identity = f'BF2-NATIVE-TANGENT-PROPSPRESET{stride}-001'
    prior = next(r for r in read(f'exports/materials/{previous}/manifest.json')['records']
                 if r['exactPreparedLayout'] and r['rigidSource'])
    pattern = [(f['usage'], f['format']) for f in prior['fields']]
    selected, excluded = [], []
    for target in targets:
        retained_layout = retained.get((target['assetId'], target['sourceLod'], target['sourceMaterialId']))
        shaders = target['selectedShaderRoute']['shaders']
        layout_agrees = all(s['inputLayoutBlock'] == layout for s in shaders)
        declared_agrees = retained_layout and retained_layout['strides'][0] == stride and \
            [(e['usage'], e['format']) for e in retained_layout['elements']] == pattern
        (selected if layout_agrees and (declared_agrees or retained_layout is None) else excluded).append(target)
    selection = dict(evidenceId=identity, targets=selected, excluded=excluded,
                     sourceRoutingSha256=sha((ROOT / 'exports/materials/propspreset-routing/routing-evidence.json').read_bytes()),
                     sourceMaterialsSha256=sha((ROOT / 'web/public/assets/recovered-propspreset-materials.json').read_bytes()))
    (out / 'selection.json').write_text(json.dumps(selection, indent=2) + '\n')
    (out / 'names.txt').write_text('\n'.join(f"{r['name']}|{r['sourceLod']}|{r['sourceMaterialId']}" for r in selected) + '\n')
    shaders = { (s['vertex'], s['pixel']): s for t in selected for s in t['selectedShaderRoute']['shaders'] }
    for shader in shaders.values():
        for label in ['vertex', 'pixel']:
            name = shader[label]
            dxbc = (ROOT / f'exports/materials/propspreset-shader/{name}.dxbc').read_bytes()
            encoded = block(name); start = encoded.index(b'DXBC')
            assert dxbc == encoded[start:start + struct.unpack_from('<I', encoded, start + 24)[0]]
            shader[label + 'Sha256'] = sha(dxbc)
        decoded = []
        for string, semantic, fmt, slot, offset, kind, step in struct.iter_unpack('<Q6I', block(layout)):
            assert block(f'{string & 0xffffffffff:010x}') == b'TEXCOORD\0'
            decoded.append(dict(semantic='TEXCOORD', index=semantic, dxgiFormat=fmt,
                                inputSlot=slot, offset=offset, classification=kind, step=step))
        shader.update(inputLayoutOffset=index[layout]['offset'], inputLayoutSha256=sha(block(layout)), inputLayout=decoded,
                      frameOutputRegisters=[3, 4, 5] if shader['atlas'] else [2, 3, 4], separateNormalOutput=False)
    routing = dict(evidenceId=identity, sourceRvmSha256=sha(raw), sourceStride=stride,
                   sourceSectionRoutingSha256=selection['sourceRoutingSha256'],
                   shaders=list(shaders.values()), sectionRoutes=section_routes,
                   frameEquation='N=normalize(M*Nsource); T=normalize(M*(-Tsource)); B=normalize(M*(-cross(Nsource,Tsource)*sourceSign)).',
                   limitations=['Exact selected section permutation paths and their ordinary/atlas pairs only.',
                                'Native lower LODs require identical material roots and the same verified source input layout.',
                                'Only rigid32/36 layouts are candidates; colored, composite and other declarations excluded.',
                                'Source-only candidate; native dispatch is not captured and runtime remains unchanged.'])
    (out / 'shader-routing.json').write_text(json.dumps(routing, indent=2) + '\n')
    print(json.dumps(dict(stride=stride, sections=len(selected),
                          baseSectionInstances=sum(r['placementCount'] for r in selected if r['sourceLod'] == 0))))
