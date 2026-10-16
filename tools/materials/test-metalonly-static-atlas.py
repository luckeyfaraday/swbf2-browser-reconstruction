"""MetalOnly source shader parity, routing, and negative controls; CPU only."""
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('metalonly_parity', Path(__file__).with_name('metalonly-static-atlas-parity.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class MetalOnlyStaticAtlasTests(unittest.TestCase):
    def test_arbitrary_material_inputs_match_and_detail_blend_saturation_matters(self):
        ordinary = M.material(M.Machine(M.SHADERS / '85476b5805.dxbc'), False)
        atlas = M.material(M.Machine(M.SHADERS / '2db6de846b.dxbc', 5), True)
        self.assertEqual(ordinary, atlas)
        for value in atlas.values():
            M.P.assert_initialized(value)
        changed = M.Machine(M.SHADERS / '2db6de846b.dxbc', 5)
        changed.asm = changed.asm.replace('add_sat r3.z, r5.y, r5.x', 'add r3.z, r5.y, r5.x')
        mutation = M.material(changed, True)
        self.assertNotEqual(atlas['normal'], mutation['normal'])
        self.assertEqual(atlas['smoothness'], mutation['smoothness'])
        self.assertEqual(atlas['albedo'], mutation['albedo'])

    def test_atlas_kernel_equals_validated_floor_and_detects_smoothness_change(self):
        floor = M.P.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        master = M.Machine(M.SHADERS / '2db6de846b.dxbc')
        self.assertEqual(floor, M.atlas_kernel(master))
        changed = M.Machine(M.SHADERS / '2db6de846b.dxbc')
        changed.asm = changed.asm.replace('mov_sat r4.x, r1.w', 'mov r4.x, r1.w')
        self.assertNotEqual(floor, M.atlas_kernel(changed))

    def test_native_ao_survives_kernel_then_multiplies_complete_rgb_before_exposure(self):
        machine = M.Machine(M.SHADERS / '2db6de846b.dxbc')
        machine.seed('r4.w', ['materialAO'])
        lighting = M.atlas_kernel(machine)
        self.assertEqual(machine.reg['r4'][3], M.P.symbol('materialAO'))
        machine.seed('r0.w', ['skyVisibility'])
        machine.seed('cb2[40].x', ['frameExposure'])
        tail = M.P.section(machine, 'mul r0.xyz, r4.wwww', 'ge r0.xy, |r3.zzzz|')
        self.assertEqual(tail, ['mul r0.xyz, r4.wwww, r0.xyzx', 'mul o3.xyz, r0.xyzx, cb2[40].xxxx'])
        machine.run(tail)
        expected = [M.P.node('mul', M.P.node('mul', M.P.symbol('materialAO'), value), M.P.symbol('frameExposure')) for value in lighting]
        self.assertEqual(machine.reg['o3'][:3], expected)
        self.assertEqual(machine.reg['r0'][3], M.P.symbol('skyVisibility'))
        self.assertEqual(machine.asm.count('mul r0.xyz, r4.wwww, r0.xyzx'), 1)
        for instruction in ['mov o2.w, r0.w', 'mov o0.w, l(0)', 'mov o2.xz, l(0,0,0.500000,0)']:
            self.assertIn(instruction, machine.asm)

    def test_all_four_rvm_instances_preserve_roles_constants_and_material_sampler(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 4)
        self.assertEqual(document['ordinaryMaterialSampler']['sampler'], '5993a514cd')
        for instance in document['functionInstances']:
            self.assertEqual([row['producer']['selector'] for row in instance['textureMapping'][:5]], [18, 19, 20, 21, 22])
            self.assertEqual([row['role'] for row in instance['textureMapping'][5:]], ['globalWear', 'wear', 'normalAO', 'grunge', 'metalCS', 'metalNormal', 'aluminium'])
            self.assertEqual([row['register'] for row in instance['constantMapping']], [f'cb1[{index}]' for index in range(5)])
            self.assertEqual(instance['atlasSampler']['sampler'], '9216198462')
            self.assertEqual(instance['materialSampler']['samplerBytes'], document['ordinaryMaterialSampler']['samplerBytes'])
            self.assertEqual(instance['materialSampler']['packedSamplerBytes16to19'], [85, 1, 1, 1])
            self.assertEqual(instance['pixelSelectionChain'][-1], document['pixelShader'])

    def test_source_atlas_uv_and_final_normal_are_distinct_from_material_grunge(self):
        pixel = (M.SHADERS / '2db6de846b.asm').read_text()
        for instruction in ['mad r2.x, v1.x, v2.w, v7.z', 'mad r2.y, v1.w, v3.w, v7.w', 'mov_sat r6.xy, -v3.xyxx', 'mov_sat r6.zw, v3.xxxy', 'dp3 r2.x, r3.xyzx, r3.xyzx', 'rsq r2.x, r2.x', 'mul r3.xyz, r2.xxxx, r3.xyzx']:
            self.assertIn(instruction, pixel)
        vertex = (M.SHADERS / '007bb70865.asm').read_text()
        for instruction in ['mov o2.w, v4.x', 'mov o3.w, v4.y', 'mov o7.xy, v3.xyxx', 'mov o7.zw, r2.xxxy']:
            self.assertIn(instruction, vertex)
        self.assertIn('mul r0.xyz, r0.wwww, r0.xyzx\nmov o3.xyz, r0.xyzx', vertex)


if __name__ == '__main__':
    unittest.main()
