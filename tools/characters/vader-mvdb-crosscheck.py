"""Cross-check the shader-block material plan against Vader's own MeshVariationDb_Win32.

The trooper planner (tools/materials/plan-materials.py) reads the map variation database,
so Vader bindings come from exact split shader entries. This independent check compares
them with the VUR bundle's default-variation TextureParameters (BaseColor/CS/Normal).
Usage (workspace root): python tools/characters/vader-mvdb-crosscheck.py
Output: exports/characters/vader-materials/mvdb-crosscheck.json (exit 1 on disagreement)
"""
import json, glob, pathlib, sys
root = pathlib.Path(__file__).resolve().parents[2]
mvf = glob.glob(str(root / 'exports/characters/vader-ebx/d1/ebx/characters_hero_darthvader_darthvader_01_vur_darthvader_01_bpb_MeshVariationDb_Win32__*.json'))[0]
mv = json.loads(pathlib.Path(mvf).read_text()); entries = mv['asset']['objects'][0]['Entries']
plan = json.loads((root / 'exports/characters/vader-materials/vader-material-plan.json').read_text())
role = {'basecolor': 'baseColor', 'cs': 'baseColor', 'normal': 'normal'}
rows = []; ok = True
for pm in plan['meshes']:
    for e in (x for x in entries if x['Mesh'].get('$external') == pm['guid']):
        for mat in e['Materials']:
            pmat = next(x for x in pm['materials'] if x['classGuid'] == mat['Material']['classGuid'])
            mvdb = {role[t['ParameterName'].lower()]: t['Value']['name'] for t in mat['TextureParameters'] if t['ParameterName'].lower() in role}
            chosen = {k: v['texture']['name'] for k, v in pmat['chosen'].items()}
            agree = all(chosen.get(k, '').lower() == v.lower() for k, v in mvdb.items())
            ok &= agree
            rows.append({'mesh': pm['name'], 'material': pmat['index'], 'variationAssetNameHash': e.get('VariationAssetNameHash', 0), 'mvdb': mvdb,
                         'otherMvdbParameters': [t['ParameterName'] for t in mat['TextureParameters'] if t['ParameterName'].lower() not in role],
                         'plan': chosen, 'agree': agree})
out = {'evidenceId': 'VADER-MVDB-CROSSCHECK-001', 'source': json.loads(pathlib.Path(mvf).read_text())['entry']['name'], 'allAgree': ok, 'rows': rows}
(root / 'exports/characters/vader-materials/mvdb-crosscheck.json').write_text(json.dumps(out, indent=1))
print(json.dumps({'materials': len(rows), 'allAgree': ok})); sys.exit(0 if ok else 1)
