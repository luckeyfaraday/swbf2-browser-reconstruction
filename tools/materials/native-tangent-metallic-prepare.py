"""Select/prepare the metallic emissive32-byte subset with the common proof."""
import pathlib
import runpy
import sys

sys.argv += ['--family', 'metallic']
runpy.run_path(str(pathlib.Path(__file__).with_name('native-tangent-nonmetal-prepare.py')), run_name='__main__')
