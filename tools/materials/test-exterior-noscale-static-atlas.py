"""ExteriorNoScale original atlas and unequal SH/atlas normal regression."""
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('exterior_parity', Path(__file__).with_name('exterior-noscale-static-atlas-parity.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class ExteriorStaticAtlasTests(unittest.TestCase):
    def test_material_parity_preserves_both_component_normalizations_and_world_mask(self):
        ordinary = M.material(M.material_machine(False), False)
        atlas = M.material(M.material_machine(True), True)
        self.assertEqual(ordinary, atlas)
        for value in atlas.values():
            M.P.assert_initialized(value)
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('mad r2.xyz, r2.xyzx, l(1.000000, 1.000000, 0.000000, 0.000000), r4.yzwy',
            'mad r2.xyz, r2.xyzx, l(1.000000, 1.000000, 1.000000, 0.000000), r4.yzwy')
        changed = M.material(wrong, True)
        self.assertNotEqual(atlas['unnormalizedWorldBlend'], changed['unnormalizedWorldBlend'])
        self.assertNotEqual(atlas['finalWorldNormal'], changed['finalWorldNormal'])
        self.assertEqual(atlas['detailWorldNormal'], changed['detailWorldNormal'])
        self.assertEqual(atlas['baseWorldNormal'], changed['baseWorldNormal'])
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('mul r2.xyz, r2.xxxx, r6.xyzx', 'mov r2.xyz, r6.xyzx')
        mutation = M.material(wrong, True)
        self.assertNotEqual(atlas['detailWorldNormal'], mutation['detailWorldNormal'])
        self.assertNotEqual(atlas['unnormalizedWorldBlend'], mutation['unnormalizedWorldBlend'])
        self.assertEqual(atlas['baseWorldNormal'], mutation['baseWorldNormal'])

    def test_normal_stage_is_unambiguously_different_between_original_paths(self):
        ordinary_machine, atlas_machine = M.material_machine(False), M.material_machine(True)
        ordinary, atlas = M.material(ordinary_machine, False), M.material(atlas_machine, True)
        self.assertNotEqual(ordinary['unnormalizedWorldBlend'], ordinary['finalWorldNormal'])
        self.assertEqual(ordinary['unnormalizedWorldBlend'], atlas['unnormalizedWorldBlend'])
        self.assertLess(atlas_machine.asm.index('mul r2.xyz, r2.xyzx, r5.wwww'), atlas_machine.asm.index('mul r8.xyz, r5.xyzx'))
        self.assertGreater(ordinary_machine.asm.index('dp3 r0.x, r5.xyzx, r5.xyzx'), ordinary_machine.asm.index('mul o3.xyz'))
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('mul r2.xyz, r2.xyzx, r5.wwww', 'mov r2.xyz, r2.xyzx')
        changed = M.material(wrong, True)
        self.assertEqual(changed['finalWorldNormal'], atlas['unnormalizedWorldBlend'])
        self.assertNotEqual(changed['finalWorldNormal'], atlas['finalWorldNormal'])
        self.assertEqual(changed['materialAO'], atlas['materialAO'])
        prior = json.loads((M.ROOT / 'exports/materials/exterior-noscale-shader/equation-validation.json').read_text())
        self.assertEqual(prior['cases'], 3200)
        self.assertLess(prior['maxAbsoluteError'], 1e-10)

    def test_common_kernel_matches_with_normalized_input_and_requires_raw_smoothness_saturation(self):
        floor = M.P.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        self.assertEqual(floor, M.atlas_kernel(M.Machine(M.SHADERS / 'b584a44bc0.dxbc')))
        wrong = M.Machine(M.SHADERS / 'b584a44bc0.dxbc')
        wrong.asm = wrong.asm.replace('mov_sat r5.w, r4.x', 'mov r5.w, r4.x')
        self.assertNotEqual(floor, M.atlas_kernel(wrong))

    def test_full_kernel_preserves_packed_inputs_and_ao_multiplies_rgb_once_not_sky(self):
        source = M.material_machine(True)
        retained = {'r1.w': ['response'], 'r2.w': ['detailAlpha'], 'r3.zw': ['materialAO', 'baseAlpha']}
        for target, names in retained.items():
            source.seed(target, names)
        lighting = M.atlas_kernel(source)
        for target, names in retained.items():
            register, channels = target.split('.')
            self.assertEqual([source.reg[register]['xyzw'.index(c)] for c in channels], [M.P.symbol(name) for name in names])
        for index in range(5):
            source.seed(f'cb1[{index}].xyzw', [f'constant{index}.{c}' for c in 'xyzw'])
        source.seed('cb2[40].x', ['frameExposure'])
        source.seed('r0.w', ['skyVisibility'])
        tail = M.P.section(source, 'add r1.xyz, -cb1[1]', 'ge r0.xy, |r2.zzzz|')
        self.assertEqual(tail[-2:], ['mul r0.xyz, r3.zzzz, r0.xyzx', 'mul o3.xyz, r0.xyzx, cb2[40].xxxx'])
        source.run(tail)
        expected = [M.P.node('mul', M.P.node('mul', M.P.symbol('materialAO'), light), M.P.symbol('frameExposure')) for light in lighting]
        self.assertEqual(source.reg['o3'][:3], expected)
        self.assertEqual(source.reg['r0'][3], M.P.symbol('skyVisibility'))
        self.assertIn('mov o2.w, r0.w', source.asm)
        self.assertEqual(source.reg['o2'][1], M.P.node('mul', M.P.symbol('response'), M.P.symbol('constant4.x')))

    def test_two_rvm_routes_original_samplers_and_exact_constant_stage_slots(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 2)
        seen_slots = set()
        for instance in document['functionInstances']:
            self.assertEqual([row['producer']['selector'] for row in instance['textureMapping'][:5]], [18, 19, 20, 21, 22])
            self.assertEqual([row['register'] for row in instance['textureMapping']], ['t'+str(i) for i in range(2,9)])
            self.assertEqual([row['register'] for row in instance['constantMapping']], ['cb1['+str(i)+']' for i in range(5)])
            self.assertEqual(instance['materialSampler']['samplerBytes'], document['ordinaryMaterialSampler']['samplerBytes'])
            self.assertEqual(instance['atlasSampler']['sampler'], '9216198462')
            table = instance['constantTableRouting']
            seen_slots.add((table['pixelOutputSlot'], table['vertexOutputSlot']))
            self.assertEqual({(r['stage'],r['register'],r['slot']) for r in table['apply']},
                {('pixel',1,table['pixelOutputSlot']),('vertex',0,table['vertexOutputSlot'])})
        self.assertEqual(seen_slots, {(47,48),(40,41)})

    def test_both_vertex_routes_and_recipe_keep_atlas_and_sh_normals_independent(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        for instance in document['functionInstances']:
            vertex = (M.SHADERS / (instance['pairedVertexShader']+'.asm')).read_text()
            uv = instance['vertexUvRouting']['materialUv'].split(' -> ')[0]
            radio = instance['vertexUvRouting']['radiosity'].split(' -> ')[0]
            self.assertNotEqual(uv,radio)
            register,channels = radio.split('.')
            for line in ['mov o6.xy, '+uv+'xx','mov o2.w, '+register+'.'+channels[0],'mov o3.w, '+register+'.'+channels[1]]:
                self.assertIn(line,vertex)
        recipe = json.loads((M.OUT / 'integration-recipe.json').read_text())
        self.assertTrue(recipe['normal']['normalized'])
        self.assertFalse(recipe['normal']['fallbackSHNormalized'])
        self.assertEqual(recipe['normal']['fallbackSHExpression'],'bf2_exterior_prelightingNormal')
        self.assertEqual(recipe['materialAO']['applications'],1)
        self.assertEqual(recipe['emissive']['value'],[0,0,0])


if __name__ == '__main__':
    unittest.main()
