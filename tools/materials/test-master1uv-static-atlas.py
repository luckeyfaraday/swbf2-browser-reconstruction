"""Focused symbolic regression and source routing checks; no GPU."""
import importlib.util
import json
from pathlib import Path
import unittest

PATH = Path(__file__).with_name('master1uv-static-atlas-parity.py')
SPEC = importlib.util.spec_from_file_location('parity', PATH)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class Master1UVStaticAtlasTests(unittest.TestCase):
    def test_original_material_outputs_match_for_arbitrary_symbolic_inputs(self):
        old = M.material(M.Machine(M.ROOT / 'exports/materials/master1uv-shader/6d0dd89b35.dxbc'), False)
        new = M.material(M.Machine(M.ROOT / 'exports/materials/master1uv-shader/965fbe264b.dxbc', 5), True)
        self.assertEqual(old, new)
        for value in new.values():
            M.assert_initialized(value)

    def test_original_atlas_instructions_match_floor_and_detect_smoothness_change(self):
        floor = M.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        master = M.Machine(M.ROOT / 'exports/materials/master1uv-shader/965fbe264b.dxbc')
        self.assertEqual(floor, M.atlas_kernel(master, True))
        changed = M.Machine(M.ROOT / 'exports/materials/master1uv-shader/965fbe264b.dxbc')
        changed.asm = changed.asm.replace('mov_sat r4.x, r1.w', 'mov r4.x, r1.w')
        self.assertNotEqual(floor, M.atlas_kernel(changed, True))

    def test_native_ao_multiplies_complete_atlas_rgb_exactly_once(self):
        machine = M.Machine(M.ROOT / 'exports/materials/master1uv-shader/965fbe264b.dxbc')
        prelighting = M.atlas_kernel(machine, True)
        machine.seed('r4.w', ['materialAO'])
        machine.run(['mul r0.xyz, r4.wwww, r0.xyzx'])
        self.assertEqual(machine.reg['r0'][:3], [M.node('mul', M.symbol('materialAO'), value) for value in prelighting])
        self.assertEqual(machine.asm.count('mul r0.xyz, r4.wwww, r0.xyzx'), 1)
        self.assertIn('mov o2.xz, l(0,0,0.500000,0)', machine.asm)
        self.assertIn('mov o0.w, l(0)', machine.asm)
        self.assertIn('mov o2.w, r0.w', machine.asm)

    def test_all_eight_rvm_instances_bind_the_same_source_atlas_and_material_roles(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 8)
        for instance in document['functionInstances']:
            bindings = instance['textureMapping']
            self.assertEqual([row['producer']['selector'] for row in bindings[:5]], [18, 19, 20, 21, 22])
            self.assertEqual([row['role'] for row in bindings[5:]], ['globalWear', 'wear', 'id', 'normalAO', 'grunge', 'anodized', 'rubber', 'metalCS', 'metalNormal', 'aluminium'])
            self.assertEqual([row['register'] for row in instance['constantMapping']], [f'cb1[{index}]' for index in range(9)])
            self.assertEqual(instance['atlasSampler']['sampler'], '9216198462')
            self.assertEqual(instance['pixelSelectionChain'][-1], document['pixelShader'])


if __name__ == '__main__':
    unittest.main()
