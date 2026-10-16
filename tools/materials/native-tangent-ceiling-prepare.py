import importlib.util
import pathlib
import subprocess
import sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('ceiling_tangent_prepare',ROOT/'tools/materials/native-tangent-coverage-prepare.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
for stride in [32]:
    module.OUT=ROOT/f'exports/materials/native-tangent-ceiling{stride}';module.STRIDE=stride;module.main()
subprocess.run([sys.executable,str(ROOT/'tools/materials/native-tangent44-prepare.py'),'--directory','exports/materials/native-tangent-ceiling44'],cwd=ROOT,check=True)
