"""Array1UV material/kernel equivalence, including typed samples and samplers."""
import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('master_atlas_parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
OUT = ROOT / 'exports/materials/array1uv-static-atlas'
SHADERS = ROOT / 'exports/materials/array1uv-shader'
Machine = P.Machine


def material_machine(atlas):
    bindings = {'s0': '9216198462', 's1': '5993a514cd', 's2': '0a829c84fa'} if atlas else {'s0': '5993a514cd', 's1': '0a829c84fa'}
    return Machine(SHADERS / ('15826ff02a.dxbc' if atlas else 'dfa7a16109.dxbc'), 5 if atlas else 0, bindings)


def material(machine, atlas):
    pos, uv = ['position.' + c for c in 'xyz'], ['uv.x', 'uv.y']
    if atlas:
        machine.seed('v2.xyz', pos)
        machine.seed('v6.xy', uv)
    else:
        machine.seed('v1.xyz', pos)
        machine.seed('v1.w', uv[:1])
        machine.seed('v2.w', uv[1:])
    for index in range(3):
        machine.seed(f'v{index + (3 if atlas else 2)}.xyz', [f'TBN.row{index}.{c}' for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    for index in range(2):
        machine.seed(f'cb1[{index}].xyzw', [f'constant{index}.{c}' for c in 'xyzw'])
    tbn_start = 'dp3 r4.x, r3.xywx, v3.xyzx' if atlas else 'dp3 r5.x, r2.xyzx, v2.xyzx'
    machine.run(P.section(machine, 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1', tbn_start))
    tangent = machine.read('r3.xywx' if atlas else 'r2.xyzx')[:3]
    machine.run(P.section(machine, tbn_start, 'mad r4.x, v1.x' if atlas else 'ld_indexable(buffer)'))
    outputs = {'smoothness': machine.reg['r1'][3], 'normal': machine.read('r3.xywx' if atlas else 'r5.xyzx')[:3],
               'tangentNormal': tangent, 'metalness': machine.reg['r4' if atlas else 'r2'][3]}
    color_start = 'mul r1.xyz, r2.xyzx, r3.zzzz' if atlas else 'mul r1.xyz, r3.xyzx, r4.zzzz'
    machine.run(P.section(machine, color_start, 'mul o3.xyz'))
    outputs['albedo'] = machine.reg['o1'][:3]
    return outputs


def atlas_kernel(machine):
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r1.w', ['smoothness'])
    machine.seed('r3.xyw', ['normal.' + c for c in 'xyz'])
    machine.seed('r5.xyz', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r6.xyz', 'r7.xyz', 'r8.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.{c}' for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r9.xyz, r6.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r4.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    regular, atlas = material_machine(False), material_machine(True)
    old, new = material(regular, False), material(atlas, True)
    assert old == new, {key: (old[key], new[key]) for key in old if old[key] != new[key]}
    for values in old.values():
        P.assert_initialized(values)
    floor = Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    array = Machine(SHADERS / '15826ff02a.dxbc')
    floor_result, array_result = P.atlas_kernel(floor, False), atlas_kernel(array)
    assert floor_result == array_result
    P.assert_initialized(array_result)
    result = {'evidenceId': 'BF2-ARRAY1UV-STATIC-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Lane-level symbolic original text-DXBC instructions, with typed 2D-array XYZ coordinates and original resolved sampler identities attached to every material sample. Exact original float32 literals verified; no canonicalization required.',
        'materialExpressionsEqual': {key: P.digest(value) for key, value in old.items()},
        'atlasRGBExpressionsEqual': P.digest(floor_result), 'uniqueSymbolicNodes': len(P.NODES),
        'materialSamplerBindings': {'ordinary': regular.sampler_bindings, 'atlas': atlas.sampler_bindings},
        'literalMaps': {name: machine.literals for name, machine in [('ordinary', regular), ('atlasMaterial', atlas), ('floorKernel', floor), ('arrayKernel', array)]},
        'composition': {'materialAO': 'None; effective multiplier one.', 'emissive': 'None; native o3 RGB is atlas kernel times frame exposure.',
            'metalness': 'NAM(UV).a', 'reflectance': 0.5, 'materialId': 0},
        'limitations': ['Symbolic equality covers source sample types, coordinates, channels and bound sampler identities; not live texture-view construction, native tie rounding, execution scheduling or GBuffer quantization.',
            'Source tangent/final world normal expressions match, while browser derivative tangent parity remains unresolved.',
            'Native directional zero branches and undefined average/half-vector normalization remain intact.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'binding-evidence.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-ARRAY1UV-STATIC-ATLAS-RECIPE-001',
        'family': 'array1uv', 'shaderName': binding['shaderName'],
        'pixelShader': binding['pixelShader'], 'pixelShaderSha256': binding['pixelShaderSha256'],
        'bindingEvidence': 'exports/materials/array1uv-static-atlas/binding-evidence.json',
        'parityEvidence': 'exports/materials/array1uv-static-atlas/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting',
            'equivalence': 'Identical symbolic instruction expressions and exact float32 literal bits; no canonicalization.'},
        'atlasRegisters': {row['register']: row['producer']['name'] for row in binding['functionInstances'][0]['textureMapping'] if 'producer' in row},
        'normal': {'nativeVariable': 'r3.xyw after tangent normalization, TBN mapping and final dp3/rsq/mul normalization',
            'space': 'source world', 'normalized': True, 'browserExpression': 'inverseTransformDirection(geometryNormal, viewMatrix)',
            'stage': 'Final normalized world shading normal, not tangent-space normal.'},
        'smoothness': {'nativeVariable': 'r1.w, written unchanged to o0.z', 'browserExpression': 'bf2_array1uv_surface.smoothness',
            'kernelOperation': 'saturate raw source smoothness; do not supply Three roughness'},
        'materialAO': {'source': 'No material AO term', 'value': 1, 'applications': 0, 'existingHook': None,
            'doNotMultiplyInsideAtlasHelper': True, 'scope': 'Complete atlas RGB passes directly to frame exposure.'},
        'emissive': {'value': [0, 0, 0], 'source': 'No additive material term in native o3 RGB.'},
        'gbuffer': {'materialID': 0, 'metalness': 'r4.w = NAM(UV).a', 'reflectance': 0.5,
            'skyVisibility': 't6.r written directly to o2.w, no AO or additional clamp',
            'prelighting': 'o3.rgb = commonAtlasKernel * cb2[40].x', 'prelightingFinalMaxZero': False},
        'uv': {'sourceAttribute': 'RadiosityTexCoord', 'pixelExpression': ['v1.x * v2.w + v6.z', 'v1.w * v3.w + v6.w'],
            'materialRouting': {'uv': 'PS v6.xy is the single original UV0 pair for NAM, CS and tiled array coordinates',
                'arrayLayer': 'NAM(v6.xy).b*10, submitted as the third texture2darray coordinate',
                'clampPolicy': 'No explicit coordinate clamp in shader; NAM uses its distinct original sampler.'},
            'layoutPolicy': 'Keep original-size compressed atlas and source affine transform without cropping/rebasing.'},
        'detailArray': {'textureKind': 'texture2darray', 'layers': 10, 'originalRegister': 't3', 'atlasRegister': 't8',
            'fileGuid': binding['detailArray']['identity']['fileGuid'], 'sourceDdsSha256': binding['detailArray']['ddsSha256'],
            'samplers': {'NAM': {'ordinaryRegister': 's1', 'atlasRegister': 's2', 'source': '0a829c84fa', 'packedFilterAddressBytes': [85, 1, 3, 1]},
                'arrayAndCS': {'ordinaryRegister': 's0', 'atlasRegister': 's1', 'source': '5993a514cd', 'packedFilterAddressBytes': [85, 1, 1, 1]}},
            'coordinatePolicy': binding['detailArray']['layerSelection'],
            'detailWeight': 'Raw cb1[1].x affects only normal detail; albedo and smoothness are always twice CS times detail blue.'},
        'materialParity': ['albedo', 'raw smoothness', 'normalized tangent normal', 'final normalized world normal', 'metalness', 'typed array layer', 'resolved material sampler identities'],
        'runtimeObserved': False,
        'limitations': ['Native pass activation, array-view construction and exact hardware layer tie behavior are not captured.',
            'Browser derivative TBN and native packed sampler conversion retain existing material limitations.',
            'Original compressed atlas filtering and LightMapPreExposure come from separate floor/original-atlas recovery.']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'atlasRGBEqual': floor_result == array_result, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
