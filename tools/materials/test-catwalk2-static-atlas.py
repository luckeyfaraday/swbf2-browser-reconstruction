"""Catwalk2 exact original atlas regression and mutation controls; CPU only."""
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('catwalk2_parity', Path(__file__).with_name('catwalk2-static-atlas-parity.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class Catwalk2StaticAtlasTests(unittest.TestCase):
    def test_arbitrary_material_inputs_and_both_normal_stages_match(self):
        ordinary = M.material(M.Machine(M.SHADERS / '2b6d233517.dxbc'), False)
        atlas = M.material(M.Machine(M.SHADERS / 'b1dedf865d.dxbc', 5), True)
        self.assertEqual(ordinary, atlas)
        for value in atlas.values():
            M.P.assert_initialized(value)
        changed = M.Machine(M.SHADERS / 'b1dedf865d.dxbc', 5)
        changed.asm = changed.asm.replace('mul r2.xyw, r2.xxxx, r4.xyxz', 'mov r2.xyw, r4.xyxz')
        mutation = M.material(changed, True)
        self.assertNotEqual(atlas['normal'], mutation['normal'])
        self.assertEqual(atlas['tangentNormal'], mutation['tangentNormal'])
        self.assertEqual(atlas['smoothness'], mutation['smoothness'])
        self.assertEqual(atlas['albedo'], mutation['albedo'])

    def test_atlas_kernel_matches_floor_and_detects_missing_smoothness_saturation(self):
        floor = M.P.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        master = M.Machine(M.SHADERS / 'b1dedf865d.dxbc')
        self.assertEqual(floor, M.atlas_kernel(master))
        changed = M.Machine(M.SHADERS / 'b1dedf865d.dxbc')
        changed.asm = changed.asm.replace('mov_sat r3.w, r1.w', 'mov r3.w, r1.w')
        self.assertNotEqual(floor, M.atlas_kernel(changed))

    def test_complete_composition_has_no_ao_emission_or_sky_modification(self):
        machine = M.Machine(M.SHADERS / 'b1dedf865d.dxbc')
        machine.seed('r2.z', ['baseBlue'])
        machine.seed('r3.xyz', ['grunge.' + c for c in 'rgb'])
        lighting = M.atlas_kernel(machine)
        # The actual kernel must preserve the material color inputs, too.
        self.assertEqual(machine.reg['r2'][2], M.P.symbol('baseBlue'))
        self.assertEqual(machine.reg['r3'][:3], [M.P.symbol('grunge.' + c) for c in 'rgb'])
        machine.seed('r0.w', ['skyVisibility'])
        machine.seed('cb2[40].x', ['frameExposure'])
        tail = M.P.section(machine, 'mul o1.xyz, r2.zzzz', 'ge r0.xy, |r2.wwww|')
        self.assertEqual(tail, ['mul o1.xyz, r2.zzzz, r3.xyzx', 'mul o3.xyz, r0.xyzx, cb2[40].xxxx'])
        machine.run(tail)
        self.assertEqual(machine.reg['o3'][:3], [M.P.node('mul', value, M.P.symbol('frameExposure')) for value in lighting])
        self.assertEqual(machine.reg['r0'][3], M.P.symbol('skyVisibility'))
        for instruction in ['mov o2.w, r0.w', 'mov o0.w, l(0)', 'mov o2.xyz, l(0,0,0.500000,0)']:
            self.assertIn(instruction, machine.asm)

    def test_two_rvm_routes_use_original_material_sampler_and_correct_pixel_constant_table(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 2)
        for instance in document['functionInstances']:
            self.assertEqual([row['producer']['selector'] for row in instance['textureMapping'][:5]], [18, 19, 20, 21, 22])
            self.assertEqual([row['role'] for row in instance['textureMapping'][5:]], ['base', 'detail', 'grunge'])
            self.assertEqual(instance['constantMapping'][0]['register'], 'cb1[0]')
            self.assertEqual(instance['constantMapping'][0]['parameterKeyBlock'], '03271e4aab')
            self.assertEqual(instance['constantTableRouting']['pixelOutputSlot'], 37)
            self.assertEqual(instance['constantTableRouting']['vertexOutputSlot'], 38)
            applies = {(row['stage'], row['register'], row['slot']) for row in instance['constantTableRouting']['apply']}
            self.assertEqual(applies, {('pixel', 1, 37), ('vertex', 0, 38)})
            self.assertEqual(instance['atlasSampler']['sampler'], '9216198462')
            self.assertEqual(instance['materialSampler']['samplerBytes'], document['ordinaryMaterialSampler']['samplerBytes'])

    def test_both_converted_vertex_layouts_forward_material_and_radiosity_uvs_separately(self):
        pixel = (M.SHADERS / 'b1dedf865d.asm').read_text()
        for instruction in ['mad r4.x, v1.x, v2.w, v6.z', 'mad r4.y, v1.w, v3.w, v6.w']:
            self.assertIn(instruction, pixel)
        for shader, radiosity_ops in [('13f25cb3dd', ['mov o2.w, v3.z', 'mov o3.w, v3.w']),
                                      ('6fee6b97a3', ['mov o2.w, v4.x', 'mov o3.w, v4.y'])]:
            vertex = (M.SHADERS / (shader + '.asm')).read_text()
            for instruction in radiosity_ops + ['mov o6.xy, v3.xyxx', 'mov o6.zw, r2.xxxy']:
                self.assertIn(instruction, vertex)


if __name__ == '__main__':
    unittest.main()
