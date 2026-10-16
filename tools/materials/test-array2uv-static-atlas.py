"""TextureArray2UV atlas proof with layer, UV, detail and composition mutations."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('array2uv_parity', Path(__file__).with_name('array2uv-static-atlas-parity.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class Array2UVStaticAtlasTests(unittest.TestCase):
    def test_material_parity_includes_array_third_coordinate(self):
        ordinary = M.material(M.Machine(M.SHADERS / '52d055444c.dxbc'), False)
        atlas = M.material(M.Machine(M.SHADERS / 'b398fb7ed2.dxbc', 5), True)
        self.assertEqual(ordinary, atlas)
        for value in atlas.values():
            M.P.assert_initialized(value)
        changed = M.Machine(M.SHADERS / 'b398fb7ed2.dxbc', 5)
        changed.asm = changed.asm.replace('mul r2.z, r3.x, l(10.000000)', 'mul r2.z, r3.x, l(1.000000)')
        mutation = M.material(changed, True)
        # A checker which discarded array Z would incorrectly pass this mutation.
        for field in ['normal', 'smoothness', 'albedo']:
            self.assertNotEqual(atlas[field], mutation[field])
        self.assertEqual(atlas['metalness'], mutation['metalness'])

    def test_surface_uv_and_raw_normal_detail_weight_are_independent_inputs(self):
        original = M.material(M.Machine(M.SHADERS / 'b398fb7ed2.dxbc', 5), True)
        wrong_uv = M.Machine(M.SHADERS / 'b398fb7ed2.dxbc', 5)
        wrong_uv.asm = wrong_uv.asm.replace('r3.xy, v6.zwzz, t7', 'r3.xy, v6.xyxx, t7')
        changed_uv = M.material(wrong_uv, True)
        self.assertNotEqual(original['metalness'], changed_uv['metalness'])
        self.assertNotEqual(original['normal'], changed_uv['normal'])
        wrong_weight = M.Machine(M.SHADERS / 'b398fb7ed2.dxbc', 5)
        wrong_weight.asm = wrong_weight.asm.replace('mad r5.xy, r2.xyxx, cb1[1].xxxx, r3.xzxx', 'mad r5.xy, r2.xyxx, r1.wwww, r3.xzxx')
        changed_weight = M.material(wrong_weight, True)
        self.assertNotEqual(original['normal'], changed_weight['normal'])
        self.assertEqual(original['smoothness'], changed_weight['smoothness'])
        self.assertEqual(original['albedo'], changed_weight['albedo'])

    def test_kernel_uses_final_normal_and_raw_smoothness_with_source_saturation(self):
        floor = M.P.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        source = M.Machine(M.SHADERS / 'b398fb7ed2.dxbc')
        self.assertEqual(floor, M.atlas_kernel(source))
        changed = M.Machine(M.SHADERS / 'b398fb7ed2.dxbc')
        changed.asm = changed.asm.replace('mov_sat r4.w, r2.w', 'mov r4.w, r2.w')
        self.assertNotEqual(floor, M.atlas_kernel(changed))

    def test_full_tail_preserves_material_inputs_and_has_no_ao_or_emission(self):
        source = M.Machine(M.SHADERS / 'b398fb7ed2.dxbc')
        source.seed('r1.w', ['boundedDetailWeight'])
        source.seed('r2.z', ['detailBlue'])
        source.seed('r3.y', ['metalness'])
        source.seed('r4.xyz', ['base.' + c for c in 'rgb'])
        lighting = M.atlas_kernel(source)
        for register, channel, symbol in [('r1', 3, 'boundedDetailWeight'), ('r2', 2, 'detailBlue'), ('r3', 1, 'metalness')]:
            self.assertEqual(source.reg[register][channel], M.P.symbol(symbol))
        source.seed('r0.w', ['skyVisibility'])
        source.seed('cb2[40].x', ['frameExposure'])
        tail = M.P.section(source, 'mul r1.xyz, r2.zzzz, r4.xyzx', 'ge r0.xy, |r3.wwww|')
        self.assertEqual(len(tail), 4)
        self.assertEqual(tail[-1], 'mul o3.xyz, r0.xyzx, cb2[40].xxxx')
        source.run(tail)
        self.assertEqual(source.reg['o3'][:3], [M.P.node('mul', value, M.P.symbol('frameExposure')) for value in lighting])
        self.assertEqual(source.reg['r0'][3], M.P.symbol('skyVisibility'))
        for instruction in ['mov o2.y, r3.y', 'mov o2.w, r0.w', 'mov o0.w, l(0)', 'mov o2.xz, l(0,0,0.500000,0)']:
            self.assertIn(instruction, source.asm)

    def test_all_six_rvm_routes_use_true_array_and_original_material_sampler(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 6)
        for instance in document['functionInstances']:
            self.assertEqual([row['producer']['selector'] for row in instance['textureMapping'][:5]], [18, 19, 20, 21, 22])
            self.assertEqual([row['role'] for row in instance['textureMapping'][5:]], ['normalArrayMetal', 'detailArray', 'colorSmoothness'])
            self.assertEqual([row['register'] for row in instance['textureMapping'] if row['textureKind'] == 'texture2darray'], ['t8'])
            self.assertEqual([row['role'] for row in instance['constantMapping']], ['detailUvScale', 'detailWeight'])
            self.assertEqual(instance['atlasSampler']['sampler'], '9216198462')
            self.assertEqual(instance['materialSampler']['samplerBytes'], document['ordinaryMaterialSampler']['samplerBytes'])
        array = document['detailArray']
        self.assertEqual(array['ddsHeader'], {'width': 1024, 'height': 1024, 'mipCount': 11, 'dxgiFormat': 98, 'dimension': 3, 'layers': 10})
        self.assertEqual(hashlib.sha256((M.ROOT / array['ddsPath']).read_bytes()).hexdigest(), array['ddsSha256'])
        self.assertEqual(array['identity']['rootInstanceGuid'], 'd72f699d-b7ad-f0da-de8e-7f2741b3ef4c')

    def test_radiosity_uv_is_separate_from_both_material_pairs_in_every_vertex_variant(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        for instance in document['functionInstances']:
            vertex = (M.SHADERS / (instance['pairedVertexShader'] + '.asm')).read_text()
            pairs = instance['vertexUvRouting']['materialPairs'].split('.')[0]
            radiosity = instance['vertexUvRouting']['radiosity'].split('.')[0]
            self.assertNotEqual(pairs, radiosity)
            for instruction in [f'mov o6.xyzw, {pairs}.xyzw', f'mov o2.w, {radiosity}.x', f'mov o3.w, {radiosity}.y']:
                self.assertIn(instruction, vertex)
        pixel = (M.SHADERS / 'b398fb7ed2.asm').read_text()
        for instruction in ['mad r2.x, v1.x, v2.w, v4.w', 'mad r2.y, v1.w, v3.w, v5.w', 'mov_sat r3.xz, v6.xxyx', 'sample_indexable(texture2darray)(float,float,float,float) r2.xyz, r2.xyzx, t8.xyzw, s1']:
            self.assertIn(instruction, pixel)


if __name__ == '__main__':
    unittest.main()
