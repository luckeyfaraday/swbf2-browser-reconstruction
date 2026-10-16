"""Bounded source-frame proof for the exact nonmetal emissive wall family."""
import argparse
import collections
import hashlib
import importlib.util
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
read = lambda path: json.loads((ROOT / path).read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
parser = argparse.ArgumentParser()
parser.add_argument('stage', choices=['select', 'prepare'])
parser.add_argument('--family', choices=['nonmetal', 'metallic'], default='nonmetal')
args = parser.parse_args()
metallic = args.family == 'metallic'
family = 'master1uv-emissive' if metallic else 'master1uv-emissive-nonmetal'
evidence_id = 'BF2-NATIVE-TANGENT-METALLIC-001' if metallic else 'BF2-NATIVE-TANGENT-NONMETAL-001'
OUT = ROOT / ('exports/materials/native-tangent-metallic' if metallic else 'exports/materials/native-tangent-nonmetal')
if args.stage == 'prepare':
    spec = importlib.util.spec_from_file_location('tangent_prepare', ROOT / 'tools/materials/native-tangent-coverage-prepare.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.OUT, module.STRIDE = OUT, 32
    module.main()
    raise SystemExit()

materials = read(f'web/public/assets/recovered-{family}-materials.json')['materials']
scene = read('web/public/assets/map.scene.json')
assets = {a['id']: a for a in scene['assets']}
counts = collections.Counter(i['assetId'] for i in scene['instances'])
target = []
for material in materials:
    asset = assets[material['assetId']]
    target.append(dict(assetId=asset['id'], name=asset['name'], sourceLod=0, sourceMaterialId=material['materialId'],
                       lod0MaterialId=material['materialId'], family=family, sourceShader=material['sourceShader'],
                       glbPath='web/public/assets/' + asset['url'], placementCount=counts[asset['id']]))
    for lod_asset in read('web/public/assets/source-lods.json')['assets']:
        if lod_asset['assetId'] != asset['id']:
            continue
        for lod in lod_asset['lods']:
            for section in lod['sections']:
                if section['lod0MaterialId'] != material['materialId']:
                    continue
                assert section['materialParametersEqualLod0'] and section['sharedParameterRoot']
                target.append(dict(target[-1], sourceLod=lod['level'], sourceMaterialId=section['sourceMaterialId'],
                                   glbPath='web/public' + lod['url'], lodSourceMaterial=section))
assert len(target) == (18 if metallic else 2)
excluded=[]
if metallic:
    retained={(r['assetId'],r['sourceLod'],r['sourceMaterialId']):r for r in read('exports/lighting/static-atlas-all-uv/manifest.json')['records']}
    expected=[('Pos','Half3'),('BinormalSign','Half'),('Normal','Half4'),('Tangent','Half4'),('TexCoord0','Half2'),('RadiosityTexCoord','Half2')]
    exact=[]
    for row in target:
        source=retained[(row['assetId'],row['sourceLod'],row['sourceMaterialId'])]
        if [(e['usage'],e['format']) for e in source['elements']]==expected and source['strides'][0]==32:
            exact.append(row)
        else:
            excluded.append(dict(row,sourceLayout=source['elements'],sourceStride=source['strides'][0]))
    target=exact
    assert len(target)==13 and len(excluded)==5
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'selection.json').write_text(json.dumps(dict(evidenceId=evidence_id, targets=target, excluded=excluded), indent=2) + '\n')
(OUT / 'names.txt').write_text('\n'.join(f"{r['name']}|{r['sourceLod']}|{r['sourceMaterialId']}" for r in target) + '\n')

graph = read(f'exports/materials/{family}-shader/graph.json')
base = read('exports/materials/native-tangent32/shader-routing.json')
index = read('exports/materials/rvm/block-index.json')['blocks']
raw = (ROOT / 'exports/materials/rvm/0.res').read_bytes()
assert sha(raw) == base['sourceRvmSha256']
edges, parents = collections.defaultdict(list), collections.defaultdict(list)
for edge in graph['edges']:
    edges[edge['from']].append(edge)
    parents[edge['to']].append(edge)

def block(key):
    entry = index[key]
    return raw[entry['offset']:entry['offset'] + entry['size']]

def route(start, target, depth=4):
    if start == target:
        return []
    if not depth:
        return None
    for edge in edges[start]:
        rest = route(edge['to'], target, depth - 1)
        if rest is not None:
            value = struct.unpack_from('<Q', block(start), edge['offset'])[0]
            assert value == int(edge['encoded']) and value & 0xffffffffff == int(edge['to'], 16)
            return [edge] + rest
    return None

shaders = []
for base_shader, pixel, defaults in zip(base['shaders'], ['5ffbbd02c2','d1092739db'] if metallic else ['17069bc692', '90de297532'], ['3bbeeae035','2b9c597634'] if metallic else ['9b939c5c7d', '3a234a858e']):
    vertex = base_shader['vertex']
    parameter = next(e['from'] for e in parents[defaults] if graph['blocks'][e['from']]['type'].endswith('SerializedParameterBlock'))
    paths = dict(vertex=route(parameter, vertex), pixel=route(parameter, pixel), layout=route(base_shader['vertexObject'], base_shader['inputLayoutBlock']))
    assert all(paths.values())
    bytecode = (ROOT / f'exports/materials/{family}-shader/{vertex}.dxbc').read_bytes()
    assert sha(bytecode) == base_shader['vertexSha256']
    shaders.append(dict(base_shader, family=family, pixel=pixel, parameterBlock=parameter,
                        paths=paths, pixelSha256=sha((ROOT / f'exports/materials/{family}-shader/{pixel}.dxbc').read_bytes())))
document = dict(base, evidenceId=evidence_id, shaders=shaders,
                family=family, sourceFamilyShader='SS_DSI_Master_1UV_Emissive' if metallic else 'SS_DSI_Master_1UV_Emissive_NonMetal_01',
                nativePixelFrame='Original ordinary PS uses interpolated rows v3/v4/v5, atlas PS uses v4/v5/v6. Both normalize only the final mapped world normal; geometric grunge normal remains interpolated.',
                sourceAtlasBindingPath=f'exports/materials/{family}-static-atlas/binding-evidence.json',
                sourceAtlasBindingSha256=sha((ROOT / f'exports/materials/{family}-static-atlas/binding-evidence.json').read_bytes()),
                limits=base['limits'] + ['This source proof builder does not activate a material hook.'])
(OUT / 'shader-routing.json').write_text(json.dumps(document, indent=2) + '\n')
print(json.dumps(dict(records=len(target), baseSectionInstances=sum(row['placementCount'] for row in target if row['sourceLod']==0), excluded=len(excluded), shaders=len(shaders))))
