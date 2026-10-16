"""Bound candidate reads to exact retained layouts and unaudited Master assets."""
import collections
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/native-tangent-coverage'
read = lambda path: json.loads((ROOT / path).read_text())
sha = lambda path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
DIRECT = [('Pos', 'Half3'), ('BinormalSign', 'Half'), ('Normal', 'Half4'),
          ('Tangent', 'Half4'), ('TexCoord0', 'Half2'), ('TexCoord1', 'Half2'),
          ('RadiosityTexCoord', 'Half2')]


def main():
    scene = read('web/public/assets/map.scene.json')
    assets = {a['id']: a for a in scene['assets']}
    placements = collections.Counter(i['assetId'] for i in scene['instances'])
    materials = {(m['assetId'], m['materialId']): (family, m)
                 for family in ['master1uv', 'master2uv']
                 for m in read(f'web/public/assets/recovered-{family}-materials.json')['materials']}
    lods = read('web/public/assets/source-lods.json')['assets']
    retained = {(r['assetId'], r['sourceLod'], r['sourceMaterialId']): r
                for r in read('exports/lighting/static-atlas-all-uv/manifest.json')['records']}
    target = []
    for (asset_id, material_id), (family, material) in materials.items():
        asset = assets[asset_id]
        target.append(dict(assetId=asset_id, name=asset['name'], sourceLod=0,
                           sourceMaterialId=material_id, lod0MaterialId=material_id,
                           family=family, sourceShader=material['sourceShader'],
                           glbPath='web/public/assets/' + asset['url'],
                           placementCount=placements[asset_id]))
    for asset in lods:
        for lod in asset['lods']:
            for section in lod['sections']:
                route = materials.get((asset['assetId'], section['lod0MaterialId']))
                if not route:
                    continue
                assert section['materialParametersEqualLod0'] and section['sharedParameterRoot']
                family, material = route
                target.append(dict(assetId=asset['assetId'], name=asset['name'], sourceLod=lod['level'],
                                   sourceMaterialId=section['sourceMaterialId'], lod0MaterialId=section['lod0MaterialId'],
                                   family=family, sourceShader=material['sourceShader'],
                                   glbPath='web/public' + lod['url'], placementCount=placements[asset['assetId']],
                                   lodSourceMaterial=section))
    selected = collections.defaultdict(list)
    for row in target:
        witness = retained.get((row['assetId'], row['sourceLod'], row['sourceMaterialId']))
        row['retainedLayout'] = witness and dict(elements=witness['elements'], strides=witness['strides'],
                                               vertexCount=witness['vertexCount'], sourceSectionIndex=witness['sourceSectionIndex'])
        candidate = witness is None or ([(e['usage'], e['format']) for e in witness['elements']] == DIRECT
                                       and witness['strides'][0] == 36
                                       and all(e['stream'] == 0 for e in witness['elements']))
        row['nativeReadSelected'] = candidate
        if candidate:
            selected[(row['name'], row['sourceLod'])].append(row['sourceMaterialId'])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'names.txt').write_text('\n'.join(f'{name}|{level}|' + ','.join(map(str, sorted(ids)))
                                           for (name, level), ids in sorted(selected.items())) + '\n')
    document = dict(evidenceId='BF2-NATIVE-TANGENT-COVERAGE-001', targets=target,
                    scope='Only current Master1UV/Master2UV source recipes and their already published native LODs. Native reads limited to retained exact-layout candidates and missing declaration records.',
                    sourceManifestSha256={p: sha(p) for p in ['web/public/assets/map.scene.json', 'web/public/assets/source-lods.json',
                       'web/public/assets/recovered-master1uv-materials.json', 'web/public/assets/recovered-master2uv-materials.json',
                       'exports/lighting/static-atlas-all-uv/manifest.json']})
    (OUT / 'selection.json').write_text(json.dumps(document, indent=2) + '\n')
    print(json.dumps(dict(targetSections=len(target), nativeReadAssetLods=len(selected),
                          nativeReadSections=sum(map(len, selected.values())),
                          retainedExactLayout=sum(r['nativeReadSelected'] and r['retainedLayout'] is not None for r in target),
                          missingDeclarations=sum(r['retainedLayout'] is None for r in target))))


if __name__ == '__main__':
    main()
