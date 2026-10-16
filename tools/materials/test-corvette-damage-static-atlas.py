"""Original Corvette atlas routing and mutation-sensitive dataflow checks."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import unittest

SPEC = importlib.util.spec_from_file_location('corvette_parity', Path(__file__).with_name('corvette-damage-static-atlas-parity.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class CorvetteStaticAtlasTests(unittest.TestCase):
    def test_ordinary_atlas_material_parity_requires_dynamic_table_selection(self):
        ordinary = M.material(M.material_machine(False), False)
        atlas = M.material(M.material_machine(True), True)
        self.assertEqual(ordinary, atlas)
        for value in atlas.values():
            M.P.assert_initialized(value)
        for replacement in ['mov r4.z, cb1[0].x', 'mov r4.z, v8.x']:
            wrong = M.material_machine(True)
            wrong.asm = wrong.asm.replace('mov r4.z, cb1[r1.w + 0].x', replacement)
            changed = M.material(wrong, True)
            self.assertNotEqual(atlas['smoothness'], changed['smoothness'])
            self.assertNotEqual(atlas['finalWorldNormal'], changed['finalWorldNormal'])
            self.assertEqual(atlas['albedo'], changed['albedo'])
            self.assertEqual(atlas['metalness'], changed['metalness'])

    def test_unsaturated_damage_and_independent_base_tiled_uv_are_preserved(self):
        original = M.material(M.material_machine(True), True)
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('mad r3.w, v1.x, r2.w, v1.x', 'mad_sat r3.w, v1.x, r2.w, v1.x')
        changed = M.material(wrong, True)
        for key in ['unsaturatedDamageWeight', 'smoothness', 'finalWorldNormal', 'albedo']:
            self.assertNotEqual(original[key], changed[key])
        self.assertEqual(original['metalness'], changed['metalness'])
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('v7.zwzz', 'v7.xyxx')
        changed = M.material(wrong, True)
        for key in ['smoothness', 'finalWorldNormal', 'albedo']:
            self.assertNotEqual(original[key], changed[key])
        prior = json.loads((M.SHADERS / 'equation-validation.json').read_text())
        self.assertEqual(prior['cases'], 3600)
        self.assertGreater(prior['unsaturatedDamageCases'], 1000)
        self.assertLess(prior['maxAbsoluteError'], 1e-10)

    def test_normalization_precedes_both_lighting_routes_and_cannot_be_removed(self):
        original = M.material(M.material_machine(True), True)
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('mul r2.xyz, r2.xxxx, r4.xyzx', 'mov r2.xyz, r4.xyzx')
        self.assertNotEqual(original['finalWorldNormal'], M.material(wrong, True)['finalWorldNormal'])
        for atlas, normalization, lighting in [(True, 'mul r2.xyz, r2.xxxx, r4.xyzx', 'mul r10.xyz, r7.xyzx'),
                (False, 'mul r4.xyz, r3.xxxx, r4.xyzx', 'ld_indexable(buffer)')]:
            source = M.material_machine(atlas)
            self.assertLess(source.asm.index(normalization), source.asm.index(lighting))

    def test_exact_common_kernel_retains_raw_smoothness_saturation_and_source_preexposure(self):
        floor = M.P.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        self.assertEqual(floor, M.atlas_kernel(M.Machine(M.SHADERS / 'cf1ffd68fd.dxbc')))
        for before, after in [('mov_sat r4.z, r1.w', 'mov r4.z, r1.w'),
                ('mul r6.xyw, r6.xyxw, cb2[41].yyyy', 'mov r6.xyw, r6.xyxw')]:
            wrong = M.Machine(M.SHADERS / 'cf1ffd68fd.dxbc')
            wrong.asm = wrong.asm.replace(before, after)
            self.assertNotEqual(floor, M.atlas_kernel(wrong))

    def test_kernel_retains_material_lanes_and_prelighting_has_no_ao_or_emission(self):
        source = M.material_machine(True)
        retained = {'r2.w': ['wreckAlpha'], 'r3.xyzw': ['dirt.r', 'dirt.g', 'dirt.b', 'damageWeight'],
                    'r5.xyz': ['color.r', 'color.g', 'color.b'], 'r6.z': ['metalness']}
        for target, names in retained.items():
            source.seed(target, names)
        lighting = M.atlas_kernel(source)
        for target, names in retained.items():
            register, channels = target.split('.')
            self.assertEqual([source.reg[register]['xyzw'.index(c)] for c in channels], [M.P.symbol(name) for name in names])
        source.seed('r0.w', ['skyVisibility'])
        source.seed('cb2[40].x', ['frameExposure'])
        source.run(M.P.section(source, 'add r1.xyz, -r3.xyzx, r5.xyzx', 'ge r0.xy, |r2.zzzz|'))
        self.assertEqual(source.reg['o3'][:3], [M.P.node('mul', light, M.P.symbol('frameExposure')) for light in lighting])
        self.assertEqual(source.reg['r0'][3], M.P.symbol('skyVisibility'))
        for line in ['mov o2.w, r0.w', 'mov o2.y, r6.z', 'mov o0.w, l(0)', 'mov o2.xz, l(0,0,0.500000,0)']:
            self.assertIn(line, source.asm)

    def test_rvm_keys_samplers_table_and_pair_hashes_are_exact(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 1)
        route = document['functionInstances'][0]
        self.assertEqual([x['producer']['selector'] for x in route['textureMapping'][:5]], [18,19,20,21,22])
        self.assertEqual([x['role'] for x in route['textureMapping'][5:]], ['dirt','normalMetal','color','detailArray','wreck'])
        self.assertEqual([x['register'] for x in route['textureMapping']], ['t'+str(i) for i in range(2,12)])
        self.assertEqual(route['constantMapping'][0]['vectorCount'], 8)
        self.assertEqual(route['constantMapping'][0]['byteOffset'], 0)
        table = route['constantTableRouting']
        self.assertEqual({(r['stage'],r['register'],r['slot']) for r in table['apply']}, {('pixel',1,58),('vertex',0,57)})
        self.assertEqual(route['atlasSampler']['sampler'], '9216198462')
        self.assertEqual(route['materialSampler']['samplerBytes'], document['ordinaryMaterialSampler']['samplerBytes'])
        self.assertTrue(all(x[0] == 0 for x in struct.iter_unpack('<4f', bytes.fromhex(route['selectedLayerTable']['rawHex']))))
        self.assertEqual(hashlib.sha256((M.SHADERS / (document['pixelShader']+'.dxbc')).read_bytes()).hexdigest(), document['pixelShaderSha256'])
        self.assertEqual(hashlib.sha256((M.SHADERS / (route['pairedVertexShader']+'.dxbc')).read_bytes()).hexdigest(), route['pairedVertexShaderSha256'])
        graph = json.loads((M.SHADERS / 'graph.json').read_text())
        for a,b in zip(route['pixelSelectionChain'],route['pixelSelectionChain'][1:]):
            self.assertTrue(any(e['from']==a and e['to']==b for e in graph['edges']))

    def test_vertex_radio_base_tiled_damage_and_flat_index_routes_remain_distinct(self):
        vertex = (M.SHADERS / '4529e9e8bd.asm').read_text()
        for line in ['mov o1.xyzw, v2.xyzw', 'mov o3.w, v7.x', 'mov o4.w, v7.y',
                     'mov o5.w, r4.x', 'mov o6.w, r4.y', 'mov o7.xyzw, v5.xyzw', 'mov o8.xyzw, v6.xyzw']:
            self.assertIn(line, vertex)
        pixel = M.material_machine(True).asm
        for line in ['dcl_input_ps constant v8.x', 'mad r4.x, v2.x, v3.w, v5.w', 'mad r4.y, v2.w, v4.w, v6.w']:
            self.assertIn(line, pixel)
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        array = document['sourceArray']
        dds = (M.ROOT / array['sourceDdsPath']).read_bytes()
        self.assertEqual(hashlib.sha256(dds).hexdigest(), array['sourceDdsSha256'])
        self.assertEqual(struct.unpack_from('<4I', dds,128),(98,3,0,2))
        recipe = json.loads((M.OUT / 'integration-recipe.json').read_text())
        self.assertEqual(recipe['materialAO']['applications'],0)
        self.assertEqual(recipe['emissive']['value'],[0,0,0])
        self.assertTrue(recipe['normal']['normalized'])
        self.assertTrue(recipe['arrayLayer']['mustPreserveDynamicSelection'])
        self.assertFalse(recipe['damage']['saturate'])


if __name__ == '__main__':
    unittest.main()
