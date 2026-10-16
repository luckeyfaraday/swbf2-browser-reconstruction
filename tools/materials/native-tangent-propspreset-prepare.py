import importlib.util
import pathlib
import json
import subprocess
import sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('propspreset_tangent_prepare',ROOT/'tools/materials/native-tangent-coverage-prepare.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
for stride in [32,36]:
    module.OUT=ROOT/f'exports/materials/native-tangent-propspreset{stride}';module.STRIDE=stride;module.main()
    selection=json.loads((module.OUT/'selection.json').read_text())
    routes={(r['assetId'],r['sourceLod'],r['sourceMaterialId']):r['selectedShaderRoute'] for r in selection['targets']}
    for filename in ['native-tangent-witness.json','evidence.json']:
        document=json.loads((module.OUT/filename).read_text())
        for row in document['records']:
            row['selectedShaderRoute']=routes[(row['assetId'],row['sourceLod'],row['sourceMaterialId'])]
        (module.OUT/filename).write_text(json.dumps(document,indent=2)+'\n')
