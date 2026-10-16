"""CorvetteDamage atlas parity with retained dynamic submaterial indexing."""
import importlib.util
import json
from pathlib import Path
import re

SPEC = importlib.util.spec_from_file_location('master_atlas_parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
OUT = ROOT / 'exports/materials/corvette-damage-static-atlas'
SHADERS = ROOT / 'exports/materials/corvette-damage-shader'


class Machine(P.Machine):
    def read(self, text):
        match = re.fullmatch(r'cb1\[(r\d+\.[xyzw]) \+ 0\]\.x', text)
        if match:
            selector = super().read(match[1])[0]
            # An opaque, identical dynamic selection expression. All eight
            # entries remain independent symbols, including when defaults are 0.
            selected = P.node('indexedConstant8', selector, *[self.reg[f'cb1[{i}]'][0] for i in range(8)])
            return [selected] * 4
        return super().read(text)


def material_machine(atlas):
    samplers = {'s0': '9216198462', 's1': '5993a514cd'} if atlas else {'s0': '5993a514cd'}
    return Machine(SHADERS / ('cf1ffd68fd.dxbc' if atlas else 'd92fda6613.dxbc'), 5 if atlas else 0, samplers)


def material(machine, atlas):
    machine.seed('v3.xyz' if atlas else 'v2.xyz', ['position.' + c for c in 'xyz'])
    machine.seed('v1.x', ['damageColor0.r'])
    machine.seed('v8.x' if atlas else 'v6.x', ['subMaterialIndex.uint'])
    if atlas:
        machine.seed('v7.xyzw', ['baseUv.x', 'baseUv.y', 'tiledUv.x', 'tiledUv.y'])
    else:
        for target, name in zip(['v4.w', 'v5.w', 'v2.w', 'v3.w'], ['baseUv.x', 'baseUv.y', 'tiledUv.x', 'tiledUv.y']):
            machine.seed(target, [name])
    for index in range(3):
        machine.seed(f'v{index + (4 if atlas else 3)}.xyz', [f'TBN.row{index}.{c}' for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    for index in range(8):
        machine.seed(f'cb1[{index}].xyzw', [f'layerTable{index}.{c}' for c in 'xyzw'])
    start = 'add r0.xyz, -v3' if atlas else 'add r0.xyz, -v2'
    stop = 'mad r4.x, v2.x' if atlas else 'ld_indexable(buffer)'
    machine.run(P.section(machine, start, stop))
    outputs = {'smoothness': machine.reg['r1'][3], 'finalWorldNormal': machine.reg['r2' if atlas else 'r4'][:3],
        'unsaturatedDamageWeight': machine.reg['r3' if atlas else 'r2'][3],
        'metalness': machine.reg['r6' if atlas else 'r5'][2]}
    machine.seed('r0.xyz', ['prelighting.' + c for c in 'rgb'])
    machine.seed('cb2[40].x', ['frameExposure'])
    machine.run(P.section(machine, 'add r1.xyz, -r3.xyzx, r5.xyzx' if atlas else 'add r1.xyz, -r2.xyzx, r6.xyzx',
                          'ge r0.xy, |r2.zzzz|' if atlas else 'ge r0.xy, |r4.zzzz|'))
    outputs.update({'albedo': machine.reg['o1'][:3], 'exposedPrelighting': machine.reg['o3'][:3]})
    return outputs


def atlas_kernel(machine):
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r1.w', ['smoothness'])
    machine.seed('r2.xyz', ['normal.' + c for c in 'xyz'])
    machine.seed('r6.xyw', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r7.xyz', 'r8.xyz', 'r9.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.{c}' for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r10.xyz, r7.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r4.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    regular, atlas = material_machine(False), material_machine(True)
    old, new = material(regular, False), material(atlas, True)
    assert old == new, {key: (old[key], new[key]) for key in old if old[key] != new[key]}
    for value in old.values():
        P.assert_initialized(value)
    floor = Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    native = Machine(SHADERS / 'cf1ffd68fd.dxbc')
    floor_result, native_result = P.atlas_kernel(floor, False), atlas_kernel(native)
    assert floor_result == native_result
    P.assert_initialized(native_result)
    result = {'evidenceId': 'BF2-CORVETTE-DAMAGE-STATIC-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Lane-level original text-DXBC symbolic dataflow with exact float32 literals and recovered sampler identities. Dynamic cb1 indexing is represented by an identical eight-entry selection node retaining all entries and the original flat uint selector; no default folding, clamping or index remapping.',
        'materialExpressionsEqual': {key: P.digest(value) for key, value in old.items()},
        'atlasRGBExpressionsEqual': P.digest(native_result), 'uniqueSymbolicNodes': len(P.NODES),
        'literalMaps': {name: machine.literals for name, machine in [('ordinary', regular), ('atlasMaterial', atlas), ('floorKernel', floor), ('nativeKernel', native)]},
        'composition': {'AO': 'None.', 'emissive': 'None.', 'materialID': 0, 'reflectance': .5,
            'skyVisibility': 't6.r directly to o2.w; independent of material textures and damage.',
            'prelightingFinalMaxZero': False, 'ordinarySHFinalMaxZero': True},
        'limitations': ['Static retained-source proof, not an original-game runtime pass selection capture or GPU execution.',
            'Dynamic constant indexing proof is scoped to original integer indices 0..7. The two-layer texture-array coordinate is the selected table X, not the index itself. Out-of-range indices and runtime table overrides are unobserved.',
            'Native UV-to-converted-mesh association, derivative browser tangent frame, regenerated browser mipmaps and GBuffer quantization remain separate reconstruction boundaries.',
            'Only primitives with matching retained source RadiosityTexCoord and a nonzero matched atlas transform are eligible; other Corvette material routes retain SH.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'binding-evidence.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-CORVETTE-DAMAGE-STATIC-ATLAS-RECIPE-001', 'family': 'corvette-damage',
        'shaderName': binding['shaderName'], 'pixelShader': binding['pixelShader'], 'pixelShaderSha256': binding['pixelShaderSha256'],
        'bindingEvidence': 'exports/materials/corvette-damage-static-atlas/binding-evidence.json',
        'parityEvidence': 'exports/materials/corvette-damage-static-atlas/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting', 'equivalence': 'Identical symbolic expressions and exact float32 literal bits; no kernel rewrite.'},
        'atlasRegisters': {row['register']: row['producer']['name'] for row in binding['functionInstances'][0]['textureMapping'] if 'producer' in row},
        'normal': {'nativeVariable': 'r2.xyz after dp3/rsq/mul normalization before atlas kernel', 'space': 'source world', 'normalized': True,
            'browserExpression': 'inverseTransformDirection(geometryNormal, viewMatrix)', 'stage': 'Final normalized world normal in both atlas and ordinary SH.', 'fallbackSHNormalized': True},
        'smoothness': {'nativeVariable': 'r1.w written unchanged to o0.z', 'browserExpression': 'bf2_corvette_damage_surface.smoothness', 'kernelOperation': 'saturate raw source smoothness'},
        'materialAO': {'source': 'None', 'value': 1, 'applications': 0, 'existingHook': None,
                       'doNotMultiplyInsideAtlasHelper': True},
        'emissive': {'value': [0, 0, 0], 'source': 'No additive emission term in original o3 RGB.'},
        'gbuffer': {'materialID': 0, 'metalness': 'normalMetal.b (t8.b)', 'reflectance': .5,
            'skyVisibility': 't6.r directly to o2.w', 'prelighting': 'o3.rgb=commonAtlasKernel*cb2[40].x', 'prelightingFinalMaxZero': False},
        'uv': {'sourceAttribute': 'RadiosityTexCoord', 'pixelExpression': ['v2.x*v3.w+v5.w', 'v2.w*v4.w+v6.w'],
            'materialRouting': 'PS v7.xy=baseUV; v7.zw=tiledUV. Dirt=6*tiledUV, detailArray=3*tiledUV, wreck=2*tiledUV.',
            'layoutPolicy': 'Original-size compressed atlas and original affine transform; no cropping/rebasing.'},
        'arrayLayer': {'sourceExpression': 'cb1[uint flat SubMaterialIndex.x].x', 'entries': 8, 'selectedDefaults': [0]*8,
            'nativeTextureLayers': 2, 'indexDomain': [0,7], 'runtimeOverrideObserved': False, 'mustPreserveDynamicSelection': True},
        'damage': {'expression': 'Color0.r*(1+wreck.a)', 'saturate': False},
        'materialParity': list(old), 'runtimeObserved': False, 'limitations': result['limitations']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'atlasRGBEqual': True, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
