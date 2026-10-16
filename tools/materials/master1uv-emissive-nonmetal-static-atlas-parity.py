"""Original nonmetal emissive Master: material, atlas and emission-stage proof."""
import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('master_atlas_parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
FAMILY = 'master1uv-emissive-nonmetal'
OUT = ROOT / ('exports/materials/' + FAMILY + '-static-atlas')
SHADERS = ROOT / ('exports/materials/' + FAMILY + '-shader')
Machine = P.Machine


def material_machine(atlas):
    bindings = {'s0': '9216198462', 's1': '5993a514cd'} if atlas else {'s0': '5993a514cd'}
    return Machine(SHADERS / ('90de297532.dxbc' if atlas else '17069bc692.dxbc'), 5 if atlas else 0, bindings)


def material(machine, atlas):
    uv, pos, normal = ['uv.x', 'uv.y'], ['position.' + c for c in 'xyz'], ['geometricNormal.' + c for c in 'xyz']
    machine.seed('v2.xyz' if atlas else 'v1.xyz', pos)
    machine.seed('v3.xyz' if atlas else 'v2.xyz', normal)
    if atlas:
        machine.seed('v7.xy', uv)
    else:
        machine.seed('v1.w', uv[:1])
        machine.seed('v2.w', uv[1:])
    for index in range(3):
        machine.seed(f'v{index + (4 if atlas else 3)}.xyz', [f'TBN.row{index}.{c}' for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    for index in range(13):
        machine.seed(f'cb1[{index}].xyzw', [f'constant{index}.{c}' for c in 'xyzw'])
    tbn_start = 'dp3 r3.x, r8.xyzx, v4.xyzx' if atlas else 'dp3 r2.x, r9.xyzx, v3.xyzx'
    machine.run(P.section(machine, 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1', tbn_start))
    tangent = machine.reg['r8' if atlas else 'r9'][:3]
    machine.run(P.section(machine, tbn_start, 'mad r2.x, v1.x' if atlas else 'ld_indexable(buffer)'))
    outputs = {'smoothness': machine.reg['r1'][3], 'normal': machine.reg['r3' if atlas else 'r2'][:3], 'tangentNormal': tangent}
    machine.seed('r0.xyz', ['prelighting.' + c for c in 'rgb'])
    machine.seed('cb2[40].x', ['frameExposure'])
    machine.run(P.section(machine, 'mul r1.x, cb1[0].x' if atlas else 'mul r0.w, cb1[0].x', 'ge r0.xy, |r3.zzzz|' if atlas else 'ge r0.xy, |r2.zzzz|'))
    machine.run(['mov o2.xyz, l(0,0,0.500000,0)'])
    outputs.update({'albedo': machine.reg['o1'][:3], 'metalness': machine.reg['o2'][1],
                    'exposedPrelightingPlusEmission': machine.reg['o3'][:3]})
    return outputs


def atlas_kernel(machine):
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r1.w', ['smoothness'])
    machine.seed('r3.xyz', ['normal.' + c for c in 'xyz'])
    machine.seed('r4.xyw', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r5.xyz', 'r7.xyw', 'r8.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.{c}' for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r9.xyz, r5.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r2.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    regular, atlas = material_machine(False), material_machine(True)
    old, new = material(regular, False), material(atlas, True)
    assert old == new, {key: (old[key], new[key]) for key in old if old[key] != new[key]}
    for values in old.values():
        P.assert_initialized(values)
    floor = Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    native = Machine(SHADERS / '90de297532.dxbc')
    floor_result, native_result = P.atlas_kernel(floor, False), atlas_kernel(native)
    assert floor_result == native_result
    P.assert_initialized(native_result)
    result = {'evidenceId': 'BF2-MASTER1UV-EMISSIVE-NONMETAL-STATIC-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Lane-level symbolic original text-DXBC with exact float32 literals and source sampler identities. Only sat(n)+sat(-n) operand exchange canonicalized, as in Master1UV; no reassociation.',
        'materialExpressionsEqual': {key: P.digest(value) for key, value in old.items()},
        'atlasRGBExpressionsEqual': P.digest(native_result), 'uniqueSymbolicNodes': len(P.NODES),
        'literalMaps': {name: machine.literals for name, machine in [('ordinary', regular), ('atlasMaterial', atlas), ('floorKernel', floor), ('nativeKernel', native)]},
        'composition': {'materialAO': 'None; normalEmission alpha is unused.',
            'emissive': 'saturate(normalEmission.b*1.1111111640930176-0.111111119389534)*cb1[1].rgb*(cb1[0].x*cb1[3].x)',
            'ordinaryAndAtlas': 'Emission added to prelighting before frame exposure in both original PS variants.',
            'metalness': 0, 'materialId': 0, 'reflectance': 0.5,
            'ordinaryCombine': '(prelighting+emission)*baseColor*DFG.b before shared exposure/dynamic AO; source ID0 has zero metalness.',
            'skyVisibility': 't6.r directly to o2.w', 'prelightingFinalMaxZero': False},
        'limitations': ['Retained-source static proof, not original-game runtime pass capture or native sampling execution.',
            'Browser tangent-frame parity and original framebuffer quantization remain outside this proof.',
            'Existing browser SH fallback omits native broad specular; emission stage matches both ordinary SH and atlas producers.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'binding-evidence.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-MASTER1UV-EMISSIVE-NONMETAL-STATIC-ATLAS-RECIPE-001', 'family': FAMILY,
        'shaderName': binding['shaderName'], 'pixelShader': binding['pixelShader'], 'pixelShaderSha256': binding['pixelShaderSha256'],
        'bindingEvidence': 'exports/materials/' + FAMILY + '-static-atlas/binding-evidence.json',
        'parityEvidence': 'exports/materials/' + FAMILY + '-static-atlas/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting',
            'equivalence': 'Identical symbolic instruction expressions and exact original float32 literal bits; no kernel rewrite.'},
        'atlasRegisters': {row['register']: row['producer']['name'] for row in binding['functionInstances'][0]['textureMapping'] if 'producer' in row},
        'normal': {'nativeVariable': 'r3.xyz after TBN mapping and final dp3/rsq/mul normalization', 'space': 'source world', 'normalized': True,
            'browserExpression': 'inverseTransformDirection(geometryNormal, viewMatrix)',
            'stage': 'Final world shading normal; tangent input and interpolated geometric grunge normal are not normalized in PS.'},
        'smoothness': {'nativeVariable': 'r1.w written unchanged to o0.z', 'browserExpression': 'bf2_master1uv_emissive_nonmetal_surface.smoothness',
            'kernelOperation': 'saturate raw source smoothness'},
        'materialAO': {'source': 'No material AO term', 'value': 1, 'applications': 0, 'existingHook': None, 'doNotMultiplyInsideAtlasHelper': True},
        'emissive': {'browserExpression': 'bf2_master1uv_emissive_nonmetal_surface.emissive', 'nativeExpression': result['composition']['emissive'],
            'stage': 'Add to atlas or SH prelighting before frame exposure and ordinary DFG/albedo combine.',
            'indirectPrelightingExpression': 'commonAtlasKernel + bf2_master1uv_emissive_nonmetal_surface.emissive', 'separateThreeEmission': False},
        'gbuffer': {'materialID': 0, 'metalness': 0, 'reflectance': .5,
            'skyVisibility': 't6.r written directly to o2.w', 'prelighting': 'o3.rgb=(commonAtlasKernel+materialEmission)*cb2[40].x',
            'prelightingFinalMaxZero': False, 'classificationEvidence': 'exports/lighting/dfg-gbuffer/manifest.json'},
        'uv': {'sourceAttribute': 'RadiosityTexCoord', 'pixelExpression': ['v1.x*v2.w+v7.z', 'v1.w*v3.w+v7.w'],
            'materialRouting': 'PS v7.xy is original material UV; grunge coordinates derive from source world position and raw interpolated geometric normal.',
            'layoutPolicy': 'Original-size compressed atlas and original affine transform; no cropping/rebasing.'},
        'materialParity': list(old), 'runtimeObserved': False, 'limitations': result['limitations']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'atlasRGBEqual': True, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
