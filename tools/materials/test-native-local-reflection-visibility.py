"""Original shader-slice, authored-map and conditional visibility checks."""
import importlib.util
import json
from pathlib import Path
import unittest

PATH = Path(__file__).with_name('native-local-reflection-visibility.py')
SPEC = importlib.util.spec_from_file_location('local_visibility', PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LocalReflectionVisibilityTests(unittest.TestCase):
    def test_original_sphere_and_box_instruction_slices_agree(self):
        report = MODULE.recover()
        retained = json.loads((MODULE.OUT / 'local-reflection-visibility.json').read_text())
        self.assertEqual(retained, report)
        self.assertEqual(report['validation']['casesPerBranch'], 1200)
        self.assertLess(report['validation']['maximumAbsoluteError'], 1e-12)
        self.assertEqual(report['selectedMapAudit']['count'], 88)
        self.assertEqual(len(set(report['selectedMapAudit']['volumeIds'])), 88)

    def test_skipping_sky_controls_preserves_screen_occlusion(self):
        # Native runtime skip flags1 make atlas sky irrelevant. They do not
        # disable the independent screen-space diffuse occlusion input.
        for screen in [0, .2, .7, 1]:
            for roughness in [0, .1, .5, 1]:
                results = [MODULE.evaluate(sky, 11, -5, 1, 1, screen, .3, roughness)
                           for sky in [-1, 0, .1, .5, .9, 1, 2]]
                self.assertEqual({r['skyMask'] for r in results}, {1})
                self.assertEqual({r['occlusionInput'] for r in results}, {screen})
                self.assertEqual(len({r['specularOcclusion'] for r in results}), 1)
                if screen == 1:
                    self.assertEqual(results[0]['specularOcclusion'], 1)
                if screen == 0:
                    self.assertEqual(results[0]['specularOcclusion'], 0)

    def test_sky_ao_and_sky_mask_are_opposite_independent_controls(self):
        # With both enabled, open sky can fully occlude this LOCAL volume's
        # coverage while removing sky-derived AO. They are not one multiplier.
        dark = MODULE.evaluate(0, 1, 0, 0, 0, 1, .5, .5)
        sky = MODULE.evaluate(1, 1, 0, 0, 0, 1, .5, .5)
        self.assertEqual((dark['specularOcclusion'], dark['skyMask']), (0, 1))
        self.assertEqual((sky['specularOcclusion'], sky['skyMask']), (1, 0))
        self.assertEqual(MODULE.evaluate(0, 1, 0, 1, 0, 1, .5, .5)['specularOcclusion'], 1)
        self.assertEqual(MODULE.evaluate(1, 1, 0, 0, 1, 1, .5, .5)['skyMask'], 1)


if __name__ == '__main__':
    unittest.main()
