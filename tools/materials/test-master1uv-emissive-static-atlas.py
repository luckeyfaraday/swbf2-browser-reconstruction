"""Original emissive Master atlas and composition mutation controls."""
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('emissive_nonmetal_parity', Path(__file__).with_name('master1uv-emissive-static-atlas-parity.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class EmissiveStaticAtlasTests(unittest.TestCase):
    def test_material_and_exposed_emission_match_for_arbitrary_independent_inputs(self):
        ordinary = M.material(M.material_machine(False), False)
        atlas = M.material(M.material_machine(True), True)
        self.assertEqual(ordinary, atlas)
        for value in atlas.values():
            M.P.assert_initialized(value)
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('mad r0.xyz, r4.xzwx, cb1[0].xxxx, r0.xyzx', 'mad r0.xyz, r4.xzwx, l(1.000000), r0.xyzx')
        changed = M.material(wrong, True)
        self.assertNotEqual(atlas['exposedPrelightingPlusEmission'], changed['exposedPrelightingPlusEmission'])
        for key in ['albedo', 'normal', 'smoothness', 'metalness']:
            self.assertEqual(atlas[key], changed[key])

    def test_emission_blue_and_raw_geometric_normal_are_material_inputs(self):
        original = M.material(M.material_machine(True), True)
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('mad_sat r1.x, r4.w, l(1.111111), l(-0.111111)',
                                       'mad_sat r1.x, r4.z, l(1.111111), l(-0.111111)')
        changed = M.material(wrong, True)
        self.assertNotEqual(original['albedo'], changed['albedo'])
        self.assertNotEqual(original['exposedPrelightingPlusEmission'], changed['exposedPrelightingPlusEmission'])
        wrong = M.material_machine(True)
        # A fragment normalization incorrectly changes grunge weights for
        # ordinary interpolated nonunit geometric normals.
        old = next(line for line in wrong.asm.splitlines() if line.startswith('mov_sat ') and 'v3' in line)
        self.assertIn(old, wrong.asm)
        wrong.asm = wrong.asm.replace(old, 'dp3 r15.x, v3.xyzx, v3.xyzx\nrsq r15.x, r15.x\nmul v3.xyz, r15.xxxx, v3.xyzx\n' + old)
        changed = M.material(wrong, True)
        self.assertNotEqual(original['smoothness'], changed['smoothness'])
        self.assertEqual(original['tangentNormal'], changed['tangentNormal'])

    def test_kernel_exactly_matches_floor_and_rejects_missing_saturation(self):
        floor = M.P.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        self.assertEqual(floor, M.atlas_kernel(M.Machine(M.SHADERS / 'd1092739db.dxbc')))
        wrong = M.Machine(M.SHADERS / 'd1092739db.dxbc')
        clamp = next(line for line in wrong.asm.splitlines() if line.startswith('mov_sat ') and line.endswith(', r1.w'))
        wrong.asm = wrong.asm.replace(clamp, clamp.replace('mov_sat', 'mov'))
        self.assertNotEqual(floor, M.atlas_kernel(wrong))

    def test_kernel_preserves_all_color_and_emission_inputs_and_adds_emission_before_exposure(self):
        source = M.material_machine(True)
        retained = {'r4.w': ['normalEmission.blue'], 'r2.zw': ['metalCS.red', 'wear0'],
                    'r3.w': ['wear3'], 'r4.y': ['wear1'], 'r6.xyz': ['id.r', 'id.g', 'id.b'], 'r7.z': ['wear2']}
        for target, names in retained.items():
            source.seed(target, names)
        lighting = M.atlas_kernel(source)
        for target, names in retained.items():
            register, mask = target.split('.')
            self.assertEqual([source.reg[register]['xyzw'.index(c)] for c in mask], [M.P.symbol(name) for name in names])
        for index in range(12):
            source.seed(f'cb1[{index}].xyzw', [f'constant{index}.{c}' for c in 'xyzw'])
        source.seed('cb2[40].x', ['frameExposure'])
        source.seed('r0.w', ['skyVisibility'])
        source.run(M.P.section(source, 'mad_sat r1.x, r4.w', 'ge r0.xy, |r3.zzzz|'))
        strength = M.P.symbol('constant0.x')
        expected = [M.P.node('mul', M.P.node('mad', e, strength, light), M.P.symbol('frameExposure'))
                    for e, light in zip(source.read('r4.xzwx')[:3], lighting)]
        self.assertEqual(source.reg['o3'][:3], expected)
        self.assertEqual(source.reg['r0'][3], M.P.symbol('skyVisibility'))
        for operation in ['mov o2.xz, l(0,0,0.500000,0)', 'mov o0.w, l(0)', 'mov o2.w, r0.w']:
            self.assertIn(operation, source.asm)

    def test_rvm_routes_all_fifteen_textures_twelve_constants_and_both_samplers(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 4)
        for instance in document['functionInstances']:
            self.assertEqual([row['producer']['selector'] for row in instance['textureMapping'][:5]], [18, 19, 20, 21, 22])
            self.assertEqual([row['register'] for row in instance['textureMapping']], ['t' + str(i) for i in range(2, 17)])
            self.assertEqual([row['register'] for row in instance['constantMapping']], ['cb1[' + str(i) + ']' for i in range(12)])
            table = instance['constantTableRouting']
            self.assertEqual({(r['stage'], r['register'], r['slot']) for r in table['apply']}, {('pixel', 1, 55), ('vertex', 0, 56)})
            self.assertEqual(instance['materialSampler']['samplerBytes'], document['ordinaryMaterialSampler']['samplerBytes'])
            self.assertEqual(instance['atlasSampler']['sampler'], '9216198462')

    def test_zero_atlas_mask_edges_intensity_and_full_metal_keep_source_combine_order(self):
        spec = importlib.util.spec_from_file_location('gbuffer_decoder', Path(__file__).with_name('native-dfg-gbuffer.py'))
        decoder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(decoder)
        consumer = (M.ROOT / 'exports/lighting/dfg-gbuffer/combine-ibl.asm').read_text()
        operations = ['mul r2.xyz, r5.xyzx, cb0[5].yyyy', 'mul r2.xyz, r3.zzzz, r2.xyzx', 'mul r0.yzw, r1.xxyw, r2.xxyz']
        for line in operations:
            self.assertIn(line, consumer)
        nonzero_emission, wrong_order_detected, full_metal_cases = 0, 0, 0
        for blue in [0, .099, .1, .1001, .5, 1]:
            for intensity in [0, 15000, 45000]:
                for lighting in [0, .8]:
                    for metal in [0, .5, 1]:
                        mask = max(0, min(1, blue * 1.1111111640930176 - .111111119389534))
                        emission = mask * intensity
                        base, dfg = [.2, .5, .9], .73
                        diffuse = [c * (1-metal) for c in base]
                        regs = {'r5': [lighting + emission] * 3 + [0], 'cb0[5]': [0, 1, 1, 0],
                                'r3': [0, 0, dfg, 0], 'r1': [diffuse[0], diffuse[1], 0, diffuse[2]]}
                        decoder.interpret(operations, regs)
                        expected = [(lighting + emission) * dfg * c for c in diffuse]
                        self.assertEqual(regs['r0'][1:], expected)
                        if lighting == 0 and emission > 0 and metal < 1:
                            self.assertTrue(all(value > 0 for value in expected))
                            nonzero_emission += 1
                        if metal == 1:
                            self.assertEqual(expected, [0, 0, 0])
                            full_metal_cases += 1
                        if intensity == 0 and lighting == 0:
                            self.assertEqual(expected, [0, 0, 0])
                        wrong = [lighting * dfg * c + emission for c in diffuse]
                        wrong_order_detected += wrong != expected
        self.assertEqual(nonzero_emission, 12)
        self.assertEqual(full_metal_cases, 36)
        self.assertEqual(wrong_order_detected, 36)

    def test_vertex_uv_and_source_composition_recipe(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        for instance in document['functionInstances']:
            vertex = (M.SHADERS / (instance['pairedVertexShader'] + '.asm')).read_text()
            uv = instance['vertexUvRouting']['materialUv'].split(' -> ')[0]
            radio = instance['vertexUvRouting']['radiosity'].split(' -> ')[0]
            self.assertNotEqual(uv, radio)
            register, channels = radio.split('.')
            for line in ['mov o7.xy, ' + uv + 'xx', 'mov o2.w, ' + register + '.' + channels[0], 'mov o3.w, ' + register + '.' + channels[1]]:
                self.assertIn(line, vertex)
        recipe = json.loads((M.OUT / 'integration-recipe.json').read_text())
        self.assertFalse(recipe['emissive']['separateThreeEmission'])
        self.assertEqual(recipe['materialAO']['applications'], 0)
        self.assertEqual(recipe['gbuffer']['metalness'], 'source layered materialScalar')
        self.assertEqual(recipe['gbuffer']['materialID'], 0)
        self.assertIn('atlas or SH', recipe['emissive']['stage'])


if __name__ == '__main__':
    unittest.main()
