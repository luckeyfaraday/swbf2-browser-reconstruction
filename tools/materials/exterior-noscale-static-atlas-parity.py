"""ExteriorNoScale source atlas: different SH/atlas normal stages preserved."""
import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('master_atlas_parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
OUT = ROOT / 'exports/materials/exterior-noscale-static-atlas'
SHADERS = ROOT / 'exports/materials/exterior-noscale-shader'
Machine = P.Machine


def material_machine(atlas):
    samplers = {'s0': '9216198462', 's1': '5993a514cd'} if atlas else {'s0': '5993a514cd'}
    return Machine(SHADERS / ('b584a44bc0.dxbc' if atlas else '87f18d3646.dxbc'), 5 if atlas else 0, samplers)


def normalize_final(machine, atlas):
    lines = P.section(machine, 'dp3 r5.w, r2.xyzx, r2.xyzx' if atlas else 'dp3 r0.x, r5.xyzx, r5.xyzx',
                      'mul r8.xyz, r5.xyzx' if atlas else 'ge r1.xy, |r0.zzzz|')
    machine.run(lines)
    normal = machine.reg['r2' if atlas else 'r0'][:3]
    if not atlas:
        # Ordinary multiplies invLength*sum; atlas multiplies sum*invLength.
        # Only these three final component products are commuted.
        assert lines[-1] == 'mul r0.xyz, r0.xxxx, r5.xyzx'
        assert all(P.NODES[n][0] == 'mul' for n in normal)
        normal = [P.node('mul', P.NODES[n][2], P.NODES[n][1]) for n in normal]
    return normal


def material(machine, atlas):
    uv, pos = ['uv.x', 'uv.y'], ['position.' + c for c in 'xyz']
    machine.seed('v2.xyz' if atlas else 'v1.xyz', pos)
    if atlas:
        machine.seed('v6.xy', uv)
    else:
        machine.seed('v1.w', uv[:1])
        machine.seed('v2.w', uv[1:])
    for index in range(3):
        machine.seed(f'v{index + (3 if atlas else 2)}.xyz', [f'TBN.row{index}.{c}' for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    for index in range(5):
        machine.seed(f'cb1[{index}].xyzw', [f'constant{index}.{c}' for c in 'xyzw'])
    blend_prefix = 'mad r2.xyz, r2.xyzx, l(' if atlas else 'mad r5.xyz, r3.xyzx, l('
    blend = next(line for line in machine.asm.splitlines() if line.startswith(blend_prefix) and line.endswith(', r4.yzwy'))
    machine.run(P.section(machine, 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1', blend))
    outputs = {'smoothness': machine.reg['r4'][0], 'baseWorldNormal': machine.read('r4.yzwy')[:3],
        'detailWorldNormal': machine.reg['r2' if atlas else 'r3'][:3], 'materialAO': machine.reg['r3' if atlas else 'r2'][2]}
    machine.run([blend])
    outputs['unnormalizedWorldBlend'] = machine.reg['r2' if atlas else 'r5'][:3]
    outputs['finalWorldNormal'] = normalize_final(machine, atlas)
    machine.seed('r0.xyz', ['prelighting.' + c for c in 'rgb'])
    machine.seed('cb2[40].x', ['frameExposure'])
    machine.run(P.section(machine, 'add r1.xyz, -cb1[1]', 'ge r0.xy, |r2.zzzz|' if atlas else 'dp3 r0.x, r5.xyzx, r5.xyzx'))
    outputs.update({'albedo': machine.reg['o1'][:3], 'metalness': machine.reg['o2'][1], 'exposedPrelightingWithAO': machine.reg['o3'][:3]})
    return outputs


def atlas_kernel(machine):
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r4.x', ['smoothness'])
    machine.seed('r2.xyz', ['normal.' + c for c in 'xyz'])
    machine.seed('r4.yzw', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r5.xyz', 'r6.xyz', 'r7.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.{c}' for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r8.xyz, r5.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r3.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    regular, atlas = material_machine(False), material_machine(True)
    old, new = material(regular, False), material(atlas, True)
    assert old == new, {key: (old[key], new[key]) for key in old if old[key] != new[key]}
    for values in old.values():
        P.assert_initialized(values)
    floor = Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    native = Machine(SHADERS / 'b584a44bc0.dxbc')
    floor_result, native_result = P.atlas_kernel(floor, False), atlas_kernel(native)
    assert floor_result == native_result
    P.assert_initialized(native_result)
    result = {'evidenceId': 'BF2-EXTERIOR-NOSCALE-STATIC-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Lane-level symbolic original text-DXBC and exact float32 literals with source sampler identities. Only the final ordinary normal component products invLength*sum are commuted to match atlas sum*invLength; no kernel rewrite.',
        'materialExpressionsEqual': {key: P.digest(value) for key, value in old.items()},
        'atlasRGBExpressionsEqual': P.digest(native_result), 'uniqueSymbolicNodes': len(P.NODES),
        'normalBoundary': {'ordinarySH': 'Unnormalized baseWorld+detailWorld*(1,1,0); normalized only for GBuffer after prelighting output.',
            'atlas': 'The same blend is explicitly normalized before directional/broad-specular atlas evaluation and GBuffer packing.',
            'atlasInstructions': ['dp3 r5.w, r2.xyzx, r2.xyzx', 'rsq r5.w, r5.w', 'mul r2.xyz, r2.xyzx, r5.wwww'],
            'browserSH': 'bf2_exterior_prelightingNormal', 'browserAtlas': 'inverseTransformDirection(geometryNormal, viewMatrix)'},
        'literalMaps': {name: machine.literals for name, machine in [('ordinary', regular), ('atlasMaterial', atlas), ('floorKernel', floor), ('nativeKernel', native)]},
        'composition': {'AO': 'BaseRGBA.b multiplies complete atlas RGB once before frame exposure.', 'emissive': 'None.',
            'materialID': 0, 'reflectance': .5, 'skyVisibility': 't6.r directly to o2.w; no material AO.', 'prelightingFinalMaxZero': False},
        'limitations': ['Retained-source static proof, not original-game live pass activation or GPU execution.',
            'Native resource-view overrides, GBuffer quantization and browser tangent-frame parity remain outside this proof.',
            'SH and atlas normal stages differ in original source; their shader paths must not share one normal argument.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'binding-evidence.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-EXTERIOR-NOSCALE-STATIC-ATLAS-RECIPE-001', 'family': 'exterior-noscale',
        'shaderName': binding['shaderName'], 'pixelShader': binding['pixelShader'], 'pixelShaderSha256': binding['pixelShaderSha256'],
        'bindingEvidence': 'exports/materials/exterior-noscale-static-atlas/binding-evidence.json',
        'parityEvidence': 'exports/materials/exterior-noscale-static-atlas/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting', 'equivalence': 'Identical symbolic expressions and exact float32 literal bits; no kernel rewrite.'},
        'atlasRegisters': {row['register']: row['producer']['name'] for row in binding['functionInstances'][0]['textureMapping'] if 'producer' in row},
        'normal': {'nativeVariable': 'r2.xyz after explicit normalization before atlas kernel', 'space': 'source world', 'normalized': True,
            'browserExpression': 'inverseTransformDirection(geometryNormal, viewMatrix)', 'stage': 'Final normalized world normal used by this atlas variant.',
            'fallbackSHExpression': 'bf2_exterior_prelightingNormal', 'fallbackSHNormalized': False},
        'smoothness': {'nativeVariable': 'r4.x written unchanged to o0.z', 'browserExpression': 'bf2_exterior_surface.smoothness', 'kernelOperation': 'saturate raw source smoothness'},
        'materialAO': {'source': 'BaseRGBA.b', 'nativeVariable': 'r3.z', 'applications': 1, 'existingHook': 'bf2_exterior_surface.ao',
            'doNotMultiplyInsideAtlasHelper': True, 'scope': 'Complete atlas RGB including broadened baked specular, once before frame exposure; sky remains separate.'},
        'emissive': {'value': [0, 0, 0], 'source': 'No additive emission term in original o3 RGB.'},
        'gbuffer': {'materialID': 0, 'metalness': '2*(1-BaseRGBA.a)*DetailNA.a*cb1[4].x', 'reflectance': .5,
            'skyVisibility': 't6.r directly to o2.w', 'prelighting': 'o3.rgb=commonAtlasKernel*BaseRGBA.b*cb2[40].x', 'prelightingFinalMaxZero': False},
        'uv': {'sourceAttribute': 'RadiosityTexCoord', 'pixelExpression': ['v1.x*v2.w+v6.z', 'v1.w*v3.w+v6.w'],
            'materialRouting': 'PS v6.xy, detail tiled by cb1[0].xy.', 'layoutPolicy': 'Original-size compressed atlas and original affine transform; no cropping/rebasing.'},
        'materialParity': list(old), 'normalBoundary': result['normalBoundary'], 'runtimeObserved': False, 'limitations': result['limitations']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'atlasRGBEqual': True, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
