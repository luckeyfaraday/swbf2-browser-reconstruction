"""Ceiling source atlas, smoothness-domain and emission-composition regressions."""
import importlib.util
import json
import math
from pathlib import Path
import random
import unittest

SPEC = importlib.util.spec_from_file_location('ceiling_parity', Path(__file__).with_name('ceiling-static-atlas-parity.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class CeilingStaticAtlasTests(unittest.TestCase):
    def test_material_matches_and_detects_normal_and_mask_mutations(self):
        original = M.material(M.material_machine(False), False)
        atlas = M.material(M.material_machine(True), True)
        self.assertEqual(original, atlas)
        for value in atlas.values():
            M.P.assert_initialized(value)
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('mul r2.xyw, r2.xxxx, r4.xyxz', 'mov r2.xyw, r4.xyxz')
        changed = M.material(wrong, True)
        self.assertNotEqual(atlas['normal'], changed['normal'])
        self.assertEqual(atlas['tangentNormal'], changed['tangentNormal'])
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('t7.yxzw, s1', 't7.xyzw, s1')
        changed = M.material(wrong, True)
        self.assertNotEqual(atlas['albedo'], changed['albedo'])
        self.assertNotEqual(atlas['exposedPrelightingPlusEmission'], changed['exposedPrelightingPlusEmission'])
        self.assertEqual(atlas['metalness'], changed['metalness'])

    def test_kernel_requires_source_domain_and_detects_missing_upper_clamp(self):
        floor = M.P.atlas_kernel(M.Machine(M.ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'), False)
        self.assertNotEqual(floor, M.atlas_kernel(M.Machine(M.SHADERS / '96644c0f9e.dxbc')))
        self.assertEqual(floor, M.atlas_kernel(M.Machine(M.SHADERS / '96644c0f9e.dxbc'), True))
        wrong = M.Machine(M.SHADERS / '96644c0f9e.dxbc')
        wrong.asm = wrong.asm.replace('min r3.z, r1.w, l(1.000000)', 'mov r3.z, r1.w')
        self.assertNotEqual(floor, M.atlas_kernel(wrong))
        # Domain evidence is an original BC7 UNORM header and full payload hash,
        # not merely a convenient assumption about a shader variable.
        domain = M.smoothness_domain()
        self.assertEqual(domain['dxgiFormat'], 98)
        self.assertEqual(domain['selectedMaterials'], 20)
        for index in range(4097):
            green = index / 4096
            exponential = 0 if green == 0 else math.exp2(math.log2(green) * 1.5)
            smoothness = exponential + exponential
            self.assertGreaterEqual(smoothness, 0)
            self.assertLessEqual(smoothness, 2)
            self.assertEqual(min(smoothness, 1), max(0, min(smoothness, 1)))
        self.assertNotEqual(min(-.2, 1), max(0, min(-.2, 1)))

    def test_complete_kernel_preserves_material_scalar_and_emission_is_before_exposure(self):
        source = M.material_machine(True)
        source.seed('v6.xy', ['uv.x', 'uv.y'])
        source.seed('r2.z', ['metalCS.red'])
        lighting = M.atlas_kernel(source)
        self.assertEqual(source.reg['r2'][2], M.P.symbol('metalCS.red'))
        source.seed('r0.w', ['skyVisibility'])
        source.seed('cb2[40].x', ['frameExposure'])
        for index in range(5):
            source.seed(f'cb1[{index}].xyzw', [f'constant{index}.{c}' for c in 'xyzw'])
        source.run(M.P.section(source, 'mul r1.x, cb1[2].x', 'ge r0.xy, |r2.wwww|'))
        strength = M.P.node('mul', M.P.symbol('constant2.x'), M.P.symbol('constant3.x'))
        self.assertEqual(source.reg['r1'][0], strength)
        emission_color = source.reg['r3'][:3]
        expected = [M.P.node('mul', M.P.node('mad', e, strength, light), M.P.symbol('frameExposure'))
                    for e, light in zip(emission_color, lighting)]
        self.assertEqual(source.reg['o3'][:3], expected)
        self.assertEqual(source.reg['r0'][3], M.P.symbol('skyVisibility'))
        self.assertIn('mov o2.w, r0.w', source.asm)
        wrong = M.material_machine(True)
        wrong.asm = wrong.asm.replace('mad r0.xyz, r3.xyzx, r1.xxxx, r0.xyzx', 'mul r0.xyz, r3.xyzx, r1.xxxx')
        self.assertNotEqual(M.material(M.material_machine(True), True)['exposedPrelightingPlusEmission'],
                            M.material(wrong, True)['exposedPrelightingPlusEmission'])

    def test_ordinary_decoder_and_zero_atlas_emission_contribution(self):
        classification = M.classification()
        self.assertEqual(classification['materialID'], 0)
        self.assertEqual(classification['decoderValidation']['cases'], 1000)
        spec = importlib.util.spec_from_file_location('gbuffer', Path(__file__).with_name('native-dfg-gbuffer.py'))
        decoder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(decoder)
        text = (M.ROOT / 'exports/lighting/dfg-gbuffer/combine-ibl.asm').read_text()
        # ID0 takes this ordinary diffuse-color branch. Its later prelighting
        # product consumes GBuffer3, which already contains material emission.
        lines = ['add r2.x, -r2.y, l(1.000000)', 'mul r1.xyw, r2.xxxx, r3.xyxz',
                 'mul r2.xyz, r5.xyzx, cb0[5].yyyy', 'mul r2.xyz, r3.zzzz, r2.xyzx',
                 'mul r0.yzw, r1.xxyw, r2.xxyz']
        for line in lines:
            self.assertIn(line, text)
        rng = random.Random(0xCE111)
        mutations = 0
        for index in range(512):
            base = [rng.random() for _ in range(3)]
            metal = .5 * rng.random()
            dfg = .2 + rng.random()
            light = [0 if index < 128 else 2 * rng.random() for _ in range(3)]
            emission = [1 + 5000 * rng.random() for _ in range(3)]
            regs = {'r2': [0, metal, 0, 0], 'r3': base + [0]}
            decoder.interpret(lines[:2], regs)
            regs.update({'r5': [a + b for a, b in zip(light, emission)] + [0],
                         'cb0[5]': [0, 1, 1, 0], 'r3': [0, 0, dfg, 0]})
            decoder.interpret(lines[2:], regs)
            actual = regs['r0'][1:]
            expected = [(a + e) * dfg * (1 - metal) * c for a, e, c in zip(light, emission, base)]
            for a, e in zip(actual, expected):
                self.assertAlmostEqual(a, e, places=9)
            if index < 128:
                self.assertTrue(all(x > 0 for x in actual))
            wrong = [a * dfg * (1 - metal) * c + e for a, e, c in zip(light, emission, base)]
            mutations += any(abs(a - b) > 1e-6 for a, b in zip(actual, wrong))
        self.assertEqual(mutations, 512)

    def test_two_rvm_routes_constants_and_sampler_identities(self):
        document = json.loads((M.OUT / 'binding-evidence.json').read_text())
        self.assertEqual(len(document['functionInstances']), 2)
        for instance in document['functionInstances']:
            self.assertEqual([row['producer']['selector'] for row in instance['textureMapping'][:5]], [18, 19, 20, 21, 22])
            self.assertEqual([row['role'] for row in instance['textureMapping'][5:]], ['mask', 'metalCS', 'metalNormal'])
            self.assertEqual([row['register'] for row in instance['constantMapping']], [f'cb1[{i}]' for i in range(5)])
            self.assertEqual(instance['atlasSampler']['sampler'], '9216198462')
            self.assertEqual(instance['materialSampler']['samplerBytes'], document['ordinaryMaterialSampler']['samplerBytes'])
            table = instance['constantTableRouting']
            self.assertEqual({(r['stage'], r['register'], r['slot']) for r in table['apply']}, {('pixel', 1, 41), ('vertex', 0, 42)})

    def test_both_vertex_routes_preserve_material_and_radiosity_pairs(self):
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
        pixel = M.material_machine(True).asm
        self.assertIn('mad r3.x, v1.x, v2.w, v6.z', pixel)
        self.assertIn('mad r3.y, v1.w, v3.w, v6.w', pixel)


if __name__ == '__main__':
    unittest.main()
