"""Source instruction parity and negative controls for Master2UV atlas inputs."""
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('master2uv_parity', Path(__file__).with_name('master2uv-static-atlas-parity.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class Master2UVStaticAtlasTests(unittest.TestCase):
    def test_material_matches_for_arbitrary_independent_base_and_surface_uvs(self):
        ordinary = M.material(M.Machine(M.SHADERS / '2304f89b0d.dxbc'), False)
        atlas = M.material(M.Machine(M.SHADERS / 'cae11f0532.dxbc', 5), True)
        self.assertEqual(ordinary, atlas)
        for value in atlas.values():
            M.P.assert_initialized(value)
        swapped = M.Machine(M.SHADERS / 'cae11f0532.dxbc', 5)
        swapped.asm = swapped.asm.replace('r4.xz, v7.zwzz, t7', 'r4.xz, v7.xyxx, t7')
        changed = M.material(swapped, True)
        self.assertNotEqual(atlas['normal'], changed['normal'])
        self.assertEqual(atlas['albedo'], changed['albedo'])
        self.assertEqual(atlas['smoothness'], changed['smoothness'])

    def test_atlas_kernel_equals_validated_floor_and_detects_unsaturated_smoothness(self):
        floor = M.P.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        master = M.Machine(M.SHADERS / 'cae11f0532.dxbc')
        self.assertEqual(floor, M.atlas_kernel(master))
        changed = M.Machine(M.SHADERS / 'cae11f0532.dxbc')
        changed.asm = changed.asm.replace('mov_sat r5.w, r1.w', 'mov r5.w, r1.w')
        self.assertNotEqual(floor, M.atlas_kernel(changed))

    def test_source_ao_covers_entire_kernel_once_without_sky_visibility(self):
        machine = M.Machine(M.SHADERS / 'cae11f0532.dxbc')
        lighting = M.atlas_kernel(machine)
        machine.seed('r9.z', ['materialAO'])
        machine.seed('r0.w', ['skyVisibility'])
        machine.run(['mul r0.xyz, r9.zzzz, r0.xyzx'])
        self.assertEqual(machine.reg['r0'][:3], [M.P.node('mul', M.P.symbol('materialAO'), value) for value in lighting])
        self.assertEqual(machine.reg['r0'][3], M.P.symbol('skyVisibility'))
        self.assertEqual(machine.asm.count('mul r0.xyz, r9.zzzz, r0.xyzx'), 1)
        self.assertIn('mov o2.w, r0.w', machine.asm)
        self.assertIn('mov o0.w, l(0)', machine.asm)
        self.assertIn('mov o2.xz, l(0,0,0.500000,0)', machine.asm)

    def test_rvm_roles_constants_and_both_sampler_routes_match_source(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 1)
        instance = document['functionInstances'][0]
        self.assertEqual(instance['instance'], 'b1fa8a7b23')
        self.assertEqual(instance['pairedVertexShader'], '15a512d31f')
        self.assertEqual([row['producer']['selector'] for row in instance['textureMapping'][:5]], [18, 19, 20, 21, 22])
        self.assertEqual([row['role'] for row in instance['textureMapping'][5:]], ['baseNormal', 'globalWear', 'wear', 'id', 'normalAO', 'grunge', 'anodized', 'rubber', 'metalCS', 'metalNormal', 'aluminium'])
        self.assertEqual([row['register'] for row in instance['constantMapping']], [f'cb1[{index}]' for index in range(9)])
        self.assertEqual(instance['atlasSampler']['sampler'], '9216198462')
        self.assertEqual(instance['materialSampler']['sampler'], '5993a514cd')
        self.assertEqual(instance['materialSampler']['packedSamplerBytes16to19'], [85, 1, 1, 1])

    def test_original_vertex_routing_keeps_radiosity_and_both_material_streams_separate(self):
        vertex = (M.SHADERS / '15a512d31f.asm').read_text()
        pixel = (M.SHADERS / 'cae11f0532.asm').read_text()
        for instruction in ['mov o2.w, v4.x', 'mov o3.w, v4.y', 'mov o7.xyzw, v3.zwxy', 'mov o4.w, r2.x', 'mov o5.w, r2.y']:
            self.assertIn(instruction, vertex)
        for instruction in ['mad r2.x, v1.x, v2.w, v4.w', 'mad r2.y, v1.w, v3.w, v5.w', 'sample_indexable(texture2d)(float,float,float,float) r4.xz, v7.zwzz, t7.xzyw, s1', 'sample_indexable(texture2d)(float,float,float,float) r9.xyz, v7.xyxx, t11.xywz, s1']:
            self.assertIn(instruction, pixel)


if __name__ == '__main__':
    unittest.main()
