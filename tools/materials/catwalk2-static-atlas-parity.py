"""Catwalk2 original atlas material/kernel comparison; no native execution."""
import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('master_atlas_parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
OUT = ROOT / 'exports/materials/catwalk2-static-atlas'
SHADERS = ROOT / 'exports/materials/catwalk2-shader'
Machine = P.Machine


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
    machine.seed('cb1[0].xyzw', ['uvScale.' + c for c in 'xyzw'])
    tbn_start = 'dp3 r4.x, r2.xywx, v3.xyzx' if atlas else 'dp3 r5.x, r2.xyzx, v2.xyzx'
    machine.run(P.section(machine, 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1', tbn_start))
    tangent = machine.read('r2.xywx' if atlas else 'r2.xyzx')[:3]
    machine.run(P.section(machine, tbn_start, 'mad r4.x, v1.x' if atlas else 'ld_indexable(buffer)'))
    outputs = {'smoothness': machine.reg['r1'][3], 'normal': machine.read('r2.xywx' if atlas else 'r2.xyzx')[:3],
               'tangentNormal': tangent}
    color = 'mul o1.xyz, r2.zzzz, r3.xyzx' if atlas else 'mul o1.xyz, r3.zzzz, r4.xyzx'
    assert machine.asm.count(color) == 1
    machine.run([color, 'mov o2.xyz, l(0,0,0.500000,0)'])
    outputs.update({'albedo': machine.reg['o1'][:3], 'metalness': machine.reg['o2'][1], 'reflectance': machine.reg['o2'][2]})
    return outputs


def atlas_kernel(machine):
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r1.w', ['smoothness'])
    machine.seed('r2.xyw', ['normal.' + c for c in 'xyz'])
    machine.seed('r5.xyz', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r6.xyz', 'r7.xyz', 'r8.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.{c}' for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r9.xyz, r6.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r4.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    regular = Machine(SHADERS / '2b6d233517.dxbc')
    atlas = Machine(SHADERS / 'b1dedf865d.dxbc', 5)
    old, new = material(regular, False), material(atlas, True)
    assert old == new, {key: (old[key], new[key]) for key in old if old[key] != new[key]}
    for values in old.values():
        P.assert_initialized(values)
    floor = Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    catwalk = Machine(SHADERS / 'b1dedf865d.dxbc')
    floor_result, catwalk_result = P.atlas_kernel(floor, False), atlas_kernel(catwalk)
    assert floor_result == catwalk_result
    P.assert_initialized(catwalk_result)
    result = {'evidenceId': 'BF2-CATWALK2-STATIC-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Lane-level symbolic original text-DXBC instructions using the Master1UV interner. Exact original float32 literal words verified. No operand canonicalization is needed by this family.',
        'materialExpressionsEqual': {key: P.digest(value) for key, value in old.items()},
        'atlasRGBExpressionsEqual': P.digest(floor_result), 'uniqueSymbolicNodes': len(P.NODES),
        'literalMaps': {name: machine.literals for name, machine in [('ordinary', regular), ('atlasMaterial', atlas), ('floorKernel', floor), ('catwalkKernel', catwalk)]},
        'composition': {'tail': ['mul o1.xyz, r2.zzzz, r3.xyzx', 'mul o3.xyz, r0.xyzx, cb2[40].xxxx'],
            'materialAO': 'No material AO instruction or extra texture channel; effective multiplier one.',
            'emissive': 'No emissive addition; prelighting contains only atlas kernel and frame exposure.',
            'metalness': 0, 'reflectance': 0.5, 'materialId': 0},
        'limitations': ['Symbolic source parity does not establish native live pass activation, hardware sampling, scheduling or GBuffer quantization.',
            'Normalized tangent normal and normalized final TBN world normal are independently compared; browser derivative tangent parity remains unresolved.',
            'Native directional zero branches and undefined average/half-vector normalization remain intact.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'binding-evidence.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-CATWALK2-STATIC-ATLAS-RECIPE-001',
        'family': 'catwalk2', 'shaderName': binding['shaderName'],
        'pixelShader': binding['pixelShader'], 'pixelShaderSha256': binding['pixelShaderSha256'],
        'bindingEvidence': 'exports/materials/catwalk2-static-atlas/binding-evidence.json',
        'parityEvidence': 'exports/materials/catwalk2-static-atlas/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting',
            'equivalence': 'Identical symbolic lane-level instruction expressions and exact original float32 literal bits; no canonicalization.'},
        'atlasRegisters': {row['register']: row['producer']['name'] for row in binding['functionInstances'][0]['textureMapping'] if 'producer' in row},
        'normal': {'nativeVariable': 'r2.xyw after normalized tangent-vector TBN mapping and final dp3/rsq/mul normalization',
            'space': 'source world', 'normalized': True,
            'browserExpression': 'inverseTransformDirection(geometryNormal, viewMatrix)',
            'stage': 'Final normalized source material shading normal, not the tangent-space normal.'},
        'smoothness': {'nativeVariable': 'r1.w, written unmodified to o0.z',
            'browserExpression': 'bf2_catwalk2_surface.smoothness',
            'kernelOperation': 'saturate raw source smoothness; do not supply Three roughness'},
        'materialAO': {'source': 'No material AO term', 'value': 1, 'applications': 0,
            'existingHook': None, 'doNotMultiplyInsideAtlasHelper': True,
            'scope': 'Complete atlas RGB passes directly to frame exposure. No material-AO hook should be added.'},
        'emissive': {'value': [0, 0, 0], 'source': 'No additive material term in the native o3 RGB path.'},
        'gbuffer': {'materialID': 0, 'metalness': 0, 'reflectance': 0.5,
            'skyVisibility': 't6.r written directly to o2.w, no material-AO multiplication or additional clamp',
            'prelighting': 'o3.rgb = commonAtlasKernel * cb2[40].x', 'prelightingFinalMaxZero': False},
        'uv': {'sourceAttribute': 'RadiosityTexCoord',
            'pixelExpression': ['v1.x * v2.w + v6.z', 'v1.w * v3.w + v6.w'],
            'convertedVertexRouting': {'material': 'VS v3.xy -> PS v6.xy',
                'radiosityVariants': {'13f25cb3dd': 'VS v3.zw -> PS v2.w/v3.w', '6fee6b97a3': 'VS v4.xy -> PS v2.w/v3.w'},
                'instanceOffset': 'instance-buffer pair -> PS v6.zw'},
            'layoutPolicy': 'Use original-size compressed atlas and source affine transform, with no cropping or UV rebasing.'},
        'materialParity': ['albedo', 'raw smoothness', 'normalized tangent normal', 'final normalized world normal', 'zero metalness', 'reflectance 0.5'],
        'runtimeObserved': False,
        'limitations': ['Native pass activation is static RVM evidence, not a captured original-game frame.',
            'Browser derivative TBN and source-to-converted vertex attribute association retain existing extraction/adapter limits.',
            'Original compressed filtering and LightMapPreExposure come from separate floor/original-atlas recovery.']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'atlasRGBEqual': floor_result == catwalk_result, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
