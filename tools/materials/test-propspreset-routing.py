"""Source tree, predicate, source binding and arithmetic regression tests."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


R = load('routing', 'propspreset-routing.py')
P = load('parity', 'propspreset-parity.py')
E = load('equations', 'propspreset-equations.py')


class PropsPresetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tree, cls.named, cls.rows = R.source_rows()
        cls.report = json.loads((ROOT / 'exports/materials/propspreset-routing/routing-evidence.json').read_text())

    def test_native_tree_coverage_and_backward_references(self):
        tree = self.tree
        self.assertEqual((tree['wordCount'], len(tree['nodes']), len(tree['backreferences'])), (2471, 716, 371))
        self.assertEqual(len(R.t.candidates(tree, {})), 172)
        self.assertTrue(all(target < offset for offset, target in tree['backreferences'].items()))
        for malformed in [R.t.WORDS[:-1], R.t.WORDS + [0], [0], [0xc001, len(R.t.VALUES), 0]]:
            with self.assertRaises(AssertionError):
                R.t.decode(malformed)

    def test_native_tag_default_and_explicit_leaf_semantics(self):
        tree = R.t.decode([0x4001, 0, 1, 2])
        self.assertEqual(R.t.candidates(tree, {}), {1, 2})
        key = R.t.KEYS[0]
        self.assertEqual(R.t.candidates(tree, {key: R.t.VALUES[0]}), {1})
        self.assertEqual(R.t.candidates(tree, {key: -1}), {2})
        tree = R.t.decode([0xc001, 0, 1])
        self.assertEqual(R.t.candidates(tree, {key: -1}), set())

    def test_selected_authored_conditions_and_coverage(self):
        self.assertEqual(len(self.named), 6)
        self.assertEqual(len(self.rows), 27)
        self.assertEqual(sum(row['placementCount'] for row in self.rows), 474)
        self.assertEqual(sorted({row['ordinaryPixelShader'] for row in self.rows}), ['3352783e34', '34120bd05e', '93681d7ffd', 'c13680b516'])
        self.assertTrue(all(row['authoredCorroborations'] for row in self.rows))
        for row in self.rows:
            for proof in row['authoredCorroborations']:
                value = row['conditionValues'][proof['keyBlock']]
                self.assertEqual(value['rawHex'], bytes([proof['ordinal']]).hex())
                self.assertIn(int(value['hash']), R.t.VALUES)

    def test_color_variation_mutation_cannot_silently_select_plain_material(self):
        row = next(row for row in self.rows if 'deathstar_2pipes_s1024_01_mesh' in row['meshName'])
        hashes = {key: int(value['hash']) for key, value in row['conditionValues'].items()}
        original = R.t.candidates(self.tree, hashes)
        hashes['3452305ee4'] = R.t.hash_value('3452305ee4', b'\x03')
        changed = R.t.candidates(self.tree, hashes)
        self.assertTrue(changed)
        self.assertNotEqual(original, changed)
        changed_pixels = {pixel for index in changed for pixel in R.b.reachable(R.t.PERMUTATIONS[index]) & R.PS}
        self.assertIn('a299d407d9', changed_pixels)
        self.assertNotIn('c13680b516', changed_pixels)

    def test_exact_five_atlas_bindings_exclude_secondary_and_single_direction(self):
        atlas = {key: row for key, row in self.report['shaders'].items() if row['classification'] == 'deferred-native-five-atlas'}
        self.assertEqual(set(atlas), {'b5b53e93ab', '2561af268e', 'd390b460db'})
        for shader in atlas.values():
            for instance in shader['instances']:
                mapping = instance['textureMapping']
                self.assertEqual([x['producer']['selector'] for x in mapping[:5]], [18, 19, 20, 21, 22])
                self.assertEqual([x['parameterHash'] for x in mapping[5:]], [2596658578, 3454255561, 26739661])
                self.assertEqual([(x['register'], x['payloadBlock']) for x in instance['samplerMapping']], [('s0', '9216198462'), ('s1', '5993a514cd')])
        self.assertEqual(sum(not x['atlasPixelShaders'] for x in self.report['sections']), 5)

    def test_all_three_materials_match_atlas_including_source_emission_stage(self):
        reference = P.P.atlas_kernel(P.P.Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        for ordinary, atlas, family in P.PAIRS:
            self.assertEqual(P.material(ordinary, False, family)[0], P.material(atlas, True, family)[0])
            self.assertEqual(P.kernel(atlas), reference)

    def test_emission_survives_zero_prelighting_and_uses_separate_uv(self):
        cb = [[.7, .2, .9, 0], [3, 0, 0, 0], [.4, 0, 0, 0], [2, 4, 0, 0], [.5, .5, .5, 0]]
        args = ('emissiveTwoUV', [-2.2, 3.4], [.23, .81], cb, [[1.2, .3, 0], [0, .8, .1], [.2, 0, 1.1]], [0, 0, 0])
        result = E.equations(*args)
        native = E.original(*args)
        self.assertGreater(max(result[8:]), 0)
        for left, right in zip(result, native):
            self.assertAlmostEqual(left, right, places=12)
        cb[1][0] = 0
        self.assertEqual(E.equations(*args)[8:], [0, 0, 0])

    def test_source_artifact_integrity_and_numeric_mutations(self):
        for row in self.report['shaders'].values():
            path = ROOT / 'exports/materials/propspreset-shader' / (row['pixelShader'] + '.dxbc')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), row['sha256'])
        validation = json.loads((ROOT / 'exports/materials/propspreset-routing/equation-validation.json').read_text())
        self.assertEqual(validation['cases'], 4000)
        self.assertLess(validation['maximumAbsoluteError'], 1e-10)
        self.assertGreater(validation['normalClampMutationsDetected'], 500)
        self.assertEqual(validation['twoUvCollapsedMutationsDetected'], 1000)


if __name__ == '__main__':
    unittest.main()
