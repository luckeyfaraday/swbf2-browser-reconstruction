"""Array1UV native atlas regression including distinct sampler identities."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('array1uv_parity', Path(__file__).with_name('array1uv-static-atlas-parity.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class Array1UVStaticAtlasTests(unittest.TestCase):
    def test_arbitrary_material_inputs_match_including_typed_layer_coordinate(self):
        ordinary = M.material(M.material_machine(False), False)
        atlas = M.material(M.material_machine(True), True)
        self.assertEqual(ordinary, atlas)
        for value in atlas.values():
            M.P.assert_initialized(value)
        changed = M.material_machine(True)
        changed.asm = changed.asm.replace('mul r3.z, r4.z, l(10.000000)', 'mul r3.z, r4.z, l(1.000000)')
        mutation = M.material(changed, True)
        for key in ['normal', 'smoothness', 'albedo']:
            self.assertNotEqual(atlas[key], mutation[key])
        self.assertEqual(atlas['metalness'], mutation['metalness'])

    def test_changing_nam_to_the_array_sampler_is_detected(self):
        original = M.material(M.material_machine(True), True)
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('t7.xyzw, s2', 't7.xyzw, s1')
        changed = M.material(wrong, True)
        # Resource and coordinates remain identical; only the source sampler
        # changes. This must remain a different symbolic texture operation.
        for key in ['normal', 'metalness', 'smoothness', 'albedo']:
            self.assertNotEqual(original[key], changed[key])

    def test_raw_detail_weight_affects_only_normal_and_final_world_normalization_matters(self):
        original = M.material(M.material_machine(True), True)
        wrong_weight = M.material_machine(True)
        wrong_weight.asm = wrong_weight.asm.replace('mad r5.xy, r3.xyxx, cb1[1].xxxx, r4.xyxx',
            'mov_sat r6.w, cb1[1].x\nmad r5.xy, r3.xyxx, r6.wwww, r4.xyxx')
        changed = M.material(wrong_weight, True)
        self.assertNotEqual(original['normal'], changed['normal'])
        self.assertEqual(original['albedo'], changed['albedo'])
        self.assertEqual(original['smoothness'], changed['smoothness'])
        wrong_final = M.material_machine(True)
        wrong_final.asm = wrong_final.asm.replace('mul r3.xyw, r2.wwww, r4.xyxz', 'mov r3.xyw, r4.xyxz')
        changed = M.material(wrong_final, True)
        self.assertNotEqual(original['normal'], changed['normal'])
        self.assertEqual(original['tangentNormal'], changed['tangentNormal'])

    def test_common_kernel_matches_floor_and_rejects_missing_smoothness_saturation(self):
        floor = M.P.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        self.assertEqual(floor, M.atlas_kernel(M.Machine(M.SHADERS / '15826ff02a.dxbc')))
        wrong = M.Machine(M.SHADERS / '15826ff02a.dxbc')
        wrong.asm = wrong.asm.replace('mov_sat r2.w, r1.w', 'mov r2.w, r1.w')
        self.assertNotEqual(floor, M.atlas_kernel(wrong))

    def test_composition_preserves_material_inputs_without_ao_or_emission(self):
        source = M.Machine(M.SHADERS / '15826ff02a.dxbc')
        source.seed('r2.xyz', ['base.' + c for c in 'rgb'])
        source.seed('r3.z', ['detailBlue'])
        source.seed('r4.w', ['metalness'])
        lighting = M.atlas_kernel(source)
        self.assertEqual(source.reg['r2'][:3], [M.P.symbol('base.' + c) for c in 'rgb'])
        self.assertEqual(source.reg['r3'][2], M.P.symbol('detailBlue'))
        self.assertEqual(source.reg['r4'][3], M.P.symbol('metalness'))
        source.seed('r0.w', ['skyVisibility'])
        source.seed('cb2[40].x', ['frameExposure'])
        tail = M.P.section(source, 'mul r1.xyz, r2.xyzx, r3.zzzz', 'ge r0.xy, |r3.wwww|')
        self.assertEqual(tail, ['mul r1.xyz, r2.xyzx, r3.zzzz', 'add o1.xyz, r1.xyzx, r1.xyzx', 'mul o3.xyz, r0.xyzx, cb2[40].xxxx'])
        source.run(tail)
        self.assertEqual(source.reg['o3'][:3], [M.P.node('mul', value, M.P.symbol('frameExposure')) for value in lighting])
        self.assertEqual(source.reg['r0'][3], M.P.symbol('skyVisibility'))
        for instruction in ['mov o2.y, r4.w', 'mov o2.w, r0.w', 'mov o0.w, l(0)', 'mov o2.xz, l(0,0,0.500000,0)']:
            self.assertIn(instruction, source.asm)

    def test_five_rvm_routes_retain_true_array_and_both_original_material_samplers(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 5)
        for instance in document['functionInstances']:
            rows = instance['textureMapping']
            self.assertEqual([row['producer']['selector'] for row in rows[:5]], [18, 19, 20, 21, 22])
            self.assertEqual([row['role'] for row in rows[5:]], ['normalArrayMetal', 'detailArray', 'colorSmoothness'])
            self.assertEqual([row['shaderSamplerRegisters'] for row in rows[5:]], [['s2'], ['s1'], ['s1']])
            self.assertEqual([row['register'] for row in rows if row['textureKind'] == 'texture2darray'], ['t8'])
            self.assertEqual(instance['materialSampler']['samplerBytes'], document['ordinaryMaterialSampler']['samplerBytes'])
            self.assertEqual(instance['normalSampler']['samplerBytes'], document['ordinaryNormalSampler']['samplerBytes'])
            self.assertEqual(instance['normalSampler']['packedSamplerBytes16to19'], [85, 1, 3, 1])
            self.assertEqual(instance['materialSampler']['packedSamplerBytes16to19'], [85, 1, 1, 1])
        array = document['detailArray']
        self.assertEqual(array['ddsHeader']['layers'], 10)
        self.assertEqual(hashlib.sha256((M.ROOT / array['ddsPath']).read_bytes()).hexdigest(), array['ddsSha256'])

    def test_all_vertex_variants_keep_one_material_pair_and_separate_radiosity_components(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        for instance in document['functionInstances']:
            vertex = (M.SHADERS / (instance['pairedVertexShader'] + '.asm')).read_text()
            uv = instance['vertexUvRouting']['materialUv'].split(' -> ')[0]
            radio = instance['vertexUvRouting']['radiosity'].split(' -> ')[0]
            self.assertNotEqual(uv, radio)
            register, channels = radio.split('.')
            self.assertIn('mov o6.xy, ' + uv + 'xx', vertex)
            self.assertIn('mov o2.w, ' + register + '.' + channels[0], vertex)
            self.assertIn('mov o3.w, ' + register + '.' + channels[1], vertex)
        pixel = (M.SHADERS / '15826ff02a.asm').read_text()
        for instruction in ['mad r4.x, v1.x, v2.w, v6.z', 'mad r4.y, v1.w, v3.w, v6.w']:
            self.assertIn(instruction, pixel)


if __name__ == '__main__':
    unittest.main()
