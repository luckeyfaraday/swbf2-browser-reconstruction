"""Cross-check the published runtime scale against original data and native code."""
import importlib.util
import json
from pathlib import Path
import runpy
import struct
import unittest

PATH = Path(__file__).with_name('native-static-atlas-preexposure.py')
SPEC = importlib.util.spec_from_file_location('atlas_preexposure', PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AtlasPreExposureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = MODULE.recover()

    def test_published_value_matches_original_database_and_native_selector(self):
        public = MODULE.ROOT / 'web/public/assets/lighting/static-atlas-preexposure.json'
        self.assertEqual(json.loads(public.read_text()), self.report)
        self.assertEqual(self.report['value'], 1.0)
        self.assertEqual(self.report['nativeVector'], [1.0] * 4)
        self.assertEqual(self.report['sourceBitsLittleEndian'], '0000803f')
        self.assertEqual(self.report['selector'], 28)
        self.assertEqual(self.report['sourceCommonBlockByteOffset'], 0xa0)

    def test_original_global_rvm_records_read_same_common_input(self):
        binding = runpy.run_path(str(MODULE.ROOT / 'tools/materials/native-static-atlas-binding.py'))
        witnesses = []
        for key in ['7979d8e16a', 'dccc0367a5', '4c0d1096fc', 'fb897f53e5']:
            raw = binding['raw'](key)
            for offset in range(0, len(raw), 20):
                if struct.unpack_from('<H', raw, offset + 16)[0] == 28:
                    witnesses.append(struct.unpack_from('<HH', raw, offset))
        self.assertEqual(witnesses, [(0, 5)] * 4)
        native = (MODULE.OUT / 'dfg-native-functions/1415d7710.c').read_text()
        self.assertIn('case 0x1c:', native)
        self.assertIn('FUN_1415d44c0(param_2,puVar1', native)

    def test_separate_frame_exposure_is_not_baked_into_scale(self):
        shader = (MODULE.ROOT / 'exports/materials/floor-shader/f789fdaafa.asm').read_text()
        self.assertIn('cb2[41].y', shader)
        self.assertIn('cb2[40].x', shader)
        self.assertEqual(len(self.report['nativeMachineCodeAnchors']), 2)
        for value in [0.0, float('nan'), float('inf')]:
            with self.assertRaises(ValueError):
                MODULE.exposure_vector(value)


if __name__ == '__main__':
    unittest.main()
