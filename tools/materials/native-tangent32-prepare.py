"""Prepare exact32-byte candidates with the common correspondence validator."""
import importlib.util
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('tangent_coverage_prepare', HERE / 'native-tangent-coverage-prepare.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.OUT = module.ROOT / 'exports/materials/native-tangent32'
module.STRIDE = 32
module.main()
