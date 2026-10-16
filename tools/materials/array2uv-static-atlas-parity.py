"""TextureArray2UV atlas proof including the third texture-array coordinate."""
import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('master_atlas_parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
OUT = ROOT / 'exports/materials/array2uv-static-atlas'
SHADERS = ROOT / 'exports/materials/array2uv-shader'
Machine = P.Machine


def material(machine, atlas):
    pos = ['position.' + c for c in 'xyz']
    normal_uv, surface_uv = ['normalDetailUv.x', 'normalDetailUv.y'], ['surfaceUv.x', 'surfaceUv.y']
    if atlas:
        machine.seed('v2.xyz', pos)
        machine.seed('v6.xy', normal_uv)
        machine.seed('v6.zw', surface_uv)
    else:
        machine.seed('v1.xyz', pos)
        machine.seed('v1.w', surface_uv[:1])
        machine.seed('v2.w', surface_uv[1:])
        machine.seed('v3.w', normal_uv[:1])
        machine.seed('v4.w', normal_uv[1:])
    for index in range(3):
        machine.seed(f'v{index + (3 if atlas else 2)}.xyz', [f'TBN.row{index}.{c}' for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    for index in range(2):
        machine.seed(f'cb1[{index}].xyzw', [f'constant{index}.{c}' for c in 'xyzw'])
    tbn_start = 'dp3 r5.x, r3.xzwx, v3.xyzx' if atlas else 'dp3 r5.x, r3.xywx, v2.xyzx'
    machine.run(P.section(machine, 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1', tbn_start))
    tangent = machine.read('r3.xzwx' if atlas else 'r3.xywx')[:3]
    machine.run(P.section(machine, tbn_start, 'mad r2.x, v1.x' if atlas else 'ld_indexable(buffer)'))
    outputs = {'smoothness': machine.reg['r2'][3 if atlas else 2],
               'normal': machine.read('r3.xzwx' if atlas else 'r5.xyzx')[:3], 'tangentNormal': tangent,
               'metalness': machine.reg['r3'][1] if atlas else machine.reg['r2'][3]}
    color_start = 'mul r1.xyz, r2.zzzz, r4.xyzx' if atlas else 'mul r1.xyz, r3.zzzz, r4.xyzx'
    machine.run(P.section(machine, color_start, 'mul o3.xyz'))
    outputs['albedo'] = machine.reg['o1'][:3]
    return outputs


def atlas_kernel(machine):
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r2.w', ['smoothness'])
    machine.seed('r3.xzw', ['normal.' + c for c in 'xyz'])
    machine.seed('r5.xyz', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r6.xyz', 'r7.xyz', 'r8.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.{c}' for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r9.xyz, r6.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r2.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    regular = Machine(SHADERS / '52d055444c.dxbc')
    atlas = Machine(SHADERS / 'b398fb7ed2.dxbc', 5)
    old, new = material(regular, False), material(atlas, True)
    assert old == new, {key: (old[key], new[key]) for key in old if old[key] != new[key]}
    for values in old.values():
        P.assert_initialized(values)
    floor = Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    array = Machine(SHADERS / 'b398fb7ed2.dxbc')
    floor_result, array_result = P.atlas_kernel(floor, False), atlas_kernel(array)
    assert floor_result == array_result
    P.assert_initialized(array_result)
    result = {'evidenceId': 'BF2-ARRAY2UV-STATIC-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Lane-level symbolic original text-DXBC instruction dataflow, including typed 2D-array samples with all three coordinates. Original float32 literals verified; no canonicalization is needed.',
        'materialExpressionsEqual': {key: P.digest(value) for key, value in old.items()},
        'atlasRGBExpressionsEqual': P.digest(floor_result), 'uniqueSymbolicNodes': len(P.NODES),
        'literalMaps': {name: machine.literals for name, machine in [('ordinary', regular), ('atlasMaterial', atlas), ('floorKernel', floor), ('arrayKernel', array)]},
        'composition': {'materialAO': 'None; effective multiplier one.', 'emissive': 'None; native o3 RGB is atlas kernel times frame exposure.',
            'metalness': 'NAM(surface UV).a', 'reflectance': 0.5, 'materialId': 0},
        'limitations': ['Symbolic source equality proves typed sample coordinates and channels, not native filtering, texture-view construction, tie rounding, runtime activation or GBuffer quantization.',
            'Normalized tangent and final world normal are compared separately; original UV0/UV1 association and browser derivative TBN remain existing adapter limits.',
            'Native directional zero branches and undefined average/half-vector normalization remain intact.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'binding-evidence.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-ARRAY2UV-STATIC-ATLAS-RECIPE-001',
        'family': 'array2uv', 'shaderName': binding['shaderName'],
        'pixelShader': binding['pixelShader'], 'pixelShaderSha256': binding['pixelShaderSha256'],
        'bindingEvidence': 'exports/materials/array2uv-static-atlas/binding-evidence.json',
        'parityEvidence': 'exports/materials/array2uv-static-atlas/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting',
            'equivalence': 'Identical symbolic instruction expressions and exact float32 literal bits; no canonicalization.'},
        'atlasRegisters': {row['register']: row['producer']['name'] for row in binding['functionInstances'][0]['textureMapping'] if 'producer' in row},
        'normal': {'nativeVariable': 'r3.xzw after tangent normalization, TBN mapping and final dp3/rsq/mul normalization',
            'space': 'source world', 'normalized': True, 'browserExpression': 'inverseTransformDirection(geometryNormal, viewMatrix)',
            'stage': 'Final normalized world shading normal, not tangent-space normal.'},
        'smoothness': {'nativeVariable': 'r2.w, written unchanged to o0.z', 'browserExpression': 'bf2_array2uv_surface.smoothness',
            'kernelOperation': 'saturate raw source smoothness; do not supply Three roughness'},
        'materialAO': {'source': 'No material AO term', 'value': 1, 'applications': 0, 'existingHook': None,
            'doNotMultiplyInsideAtlasHelper': True, 'scope': 'Complete atlas RGB passes directly to frame exposure.'},
        'emissive': {'value': [0, 0, 0], 'source': 'No additive material term in the native o3 RGB path.'},
        'gbuffer': {'materialID': 0, 'metalness': 'r3.y = NAM(surface UV).a', 'reflectance': 0.5,
            'skyVisibility': 't6.r written directly to o2.w, no AO or additional clamp',
            'prelighting': 'o3.rgb = commonAtlasKernel * cb2[40].x', 'prelightingFinalMaxZero': False},
        'uv': {'sourceAttribute': 'RadiosityTexCoord', 'pixelExpression': ['v1.x * v2.w + v4.w', 'v1.w * v3.w + v5.w'],
            'materialRouting': {'normalAndDetail': 'PS v6.xy; NAM normal uses saturate(v6.xy), array XY uses v6.xy*cb1[0].xy',
                'surface': 'PS v6.zw; color/smoothness and NAM layer/metalness use this pair',
                'arrayLayer': 'NAM(v6.zw).b*10, passed unchanged as the third texture2darray sample coordinate',
                'browserAssociation': 'Existing inferred original UV0=normal/detail, original UV1=surface; native converted-vertex association remains unobserved.'},
            'layoutPolicy': 'Keep original-size compressed atlas and source affine transform without cropping/rebasing.'},
        'detailArray': {'textureKind': 'texture2darray', 'layers': 10, 'originalRegister': 't3', 'atlasRegister': 't8',
            'fileGuid': binding['detailArray']['identity']['fileGuid'], 'sourceDdsSha256': binding['detailArray']['ddsSha256'],
            'materialSampler': '5993a514cd', 'coordinatePolicy': binding['detailArray']['layerSelection'],
            'detailWeight': 'saturate(cb1[1].x) only for color/smoothness; raw cb1[1].x for normal detail'},
        'materialParity': ['albedo', 'raw smoothness', 'normalized tangent normal', 'final normalized world normal', 'metalness', 'typed array layer and two UV pairs'],
        'runtimeObserved': False,
        'limitations': ['Native pass activation, array-view construction and exact hardware layer tie behavior are not captured.',
            'Browser derivative TBN and original UV0/UV1-to-converted attribute association retain existing material limits.',
            'Original compressed atlas filtering and LightMapPreExposure come from separate floor/original-atlas recovery.']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'atlasRGBEqual': floor_result == array_result, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
