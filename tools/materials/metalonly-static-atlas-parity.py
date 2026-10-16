"""MetalOnly symbolic material/kernel comparison using retained original DXBC.

No renderer, GPU or original-game execution is performed by this analysis.
"""
import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('master_atlas_parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
OUT = ROOT / 'exports/materials/metalonly-static-atlas'
SHADERS = ROOT / 'exports/materials/metalonly-shader'
Machine = P.Machine


def material(machine, atlas):
    uv = ['uv.x', 'uv.y']
    pos = ['position.' + c for c in 'xyz']
    normal = ['geometricNormal.' + c for c in 'xyz']
    if atlas:
        machine.seed('v2.xyz', pos)
        machine.seed('v3.xyz', normal)
        machine.seed('v7.xy', uv)
    else:
        machine.seed('v1.xyz', pos)
        machine.seed('v1.w', uv[:1])
        machine.seed('v2.xyz', normal)
        machine.seed('v2.w', uv[1:])
    for index in range(3):
        machine.seed(f'v{index + (4 if atlas else 3)}.xyz', [f'TBN.row{index}.{c}' for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    for index in range(5):
        machine.seed(f'cb1[{index}].xyzw', [f'constant{index}.{c}' for c in 'xyzw'])
    prefix = P.section(machine, 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1', 'mad r2.x, v1.x' if atlas else 'ld_indexable(buffer)')
    if not atlas:
        # The compiler exchanges only this grunge subtraction's add operands:
        # ordinary a + (-b), atlas (-b) + a. This is not reassociation.
        original = 'add r4.y, r4.y, -r5.w'
        assert prefix.count(original) == 1
        prefix = [line.replace(original, 'add r4.y, -r5.w, r4.y') for line in prefix]
    machine.run(prefix)
    outputs = {'smoothness': machine.reg['r1'][3], 'normal': machine.reg['r3' if atlas else 'r2'][:3],
               'materialAO': machine.reg['r4'][3] if atlas else machine.reg['r6'][2]}
    machine.run(P.section(machine, 'add r1.xyz, cb1[3]', 'mul r0.xyz, r4.wwww' if atlas else 'mul r0.xyz, r6.zzzz'))
    outputs.update({'albedo': machine.reg['o1'][:3], 'metalness': machine.reg['o2'][1]})
    return outputs


def atlas_kernel(machine):
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r1.w', ['smoothness'])
    machine.seed('r3.xyz', ['normal.' + c for c in 'xyz'])
    machine.seed('r5.xyw', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r6.xyz', 'r7.xyz', 'r8.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.{c}' for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r9.xyz, r6.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r2.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    regular = Machine(SHADERS / '85476b5805.dxbc')
    atlas = Machine(SHADERS / '2db6de846b.dxbc', texture_shift=5)
    old, new = material(regular, False), material(atlas, True)
    assert old == new, {k: (old[k], new[k]) for k in old if old[k] != new[k]}
    for values in old.values():
        P.assert_initialized(values)
    floor = Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    master = Machine(SHADERS / '2db6de846b.dxbc')
    floor_result, master_result = P.atlas_kernel(floor, False), atlas_kernel(master)
    assert floor_result == master_result, (floor_result, master_result)
    P.assert_initialized(floor_result)
    result = {'evidenceId': 'BF2-METALONLY-STATIC-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Lane-level symbolic original text-DXBC instruction dataflow using the Master1UV interner. Exact unique float32 literal words verified against each original DXBC. Only sat(n)+sat(-n) and one grunge sample subtraction add-operand exchange are canonicalized; no reassociation.',
        'materialOperandExchange': {'ordinary': 'add r4.y, r4.y, -r5.w', 'atlas': 'add r4.x, -r4.z, r4.x', 'scope': 'Both source additions compute grungeZY + (-grungeXY); finite source texture inputs, no reassociation.'},
        'materialExpressionsEqual': {k: P.digest(value) for k, value in old.items()},
        'atlasRGBExpressionsEqual': P.digest(floor_result), 'uniqueSymbolicNodes': len(P.NODES),
        'literalMaps': {name: machine.literals for name, machine in [('ordinary', regular), ('atlasMaterial', atlas), ('floorKernel', floor), ('masterKernel', master)]},
        'limitations': ['Static symbolic equivalence covers scoped arithmetic and source register routing, not sampler filtering, hardware scheduling or GBuffer quantization.',
            'Arbitrary UV, position, interpolated geometric normal, tangent frame, and five per-material vectors are compared. Derivative tangent frame parity remains the existing adapter boundary.',
            'Common atlas inputs are decoded directions, normalized final world normal, normalized view and raw source smoothness. Material AO is a separate subsequent multiply.',
            'Source zero-length directional branches and undefined average/half-vector normalization are preserved.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'binding-evidence.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-METALONLY-STATIC-ATLAS-RECIPE-001',
        'family': 'metalonly', 'shaderName': binding['shaderName'],
        'pixelShader': binding['pixelShader'], 'pixelShaderSha256': binding['pixelShaderSha256'],
        'bindingEvidence': 'exports/materials/metalonly-static-atlas/binding-evidence.json',
        'parityEvidence': 'exports/materials/metalonly-static-atlas/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting',
            'equivalence': 'Identical symbolic lane-level instruction expressions with exact original float32 literal bits; no kernel algebraic canonicalization needed.'},
        'atlasRegisters': {row['register']: row['producer']['name'] for row in binding['functionInstances'][0]['textureMapping'] if 'producer' in row},
        'normal': {'nativeVariable': 'r3.xyz after TBN mapping and dp3/rsq/mul world normalization',
            'space': 'source world', 'normalized': True,
            'browserExpression': 'inverseTransformDirection(geometryNormal, viewMatrix)',
            'stage': 'After source normal-map/TBN material evaluation; geometric grunge normal remains interpolated without fragment renormalization.'},
        'smoothness': {'nativeVariable': 'r1.w, also written unmodified to o0.z',
            'browserExpression': 'bf2_metalonly_surface.smoothness',
            'kernelOperation': 'saturate raw source smoothness; do not supply Three roughness'},
        'materialAO': {'source': 't9.a (normalAO; ordinary t4.a)', 'nativeVariable': 'r4.w',
            'browserExpression': 'bf2_metalonly_surface.ao', 'applications': 1,
            'scope': 'Multiply entire atlas prelighting RGB, including directional diffuse and broadened baked specular, before frame exposure.',
            'existingHook': 'reflectedLight.indirectDiffuse *= bf2_metalonly_surface.ao;',
            'doNotMultiplyInsideAtlasHelper': True},
        'gbuffer': {'materialID': 0, 'metalness': 'unchanged material expression in o2.y', 'reflectance': 0.5,
            'skyVisibility': 't6.r written directly to o2.w; no material-AO multiplication or additional clamp',
            'prelighting': 'o3.rgb = commonAtlasKernel * materialAO * cb2[40].x',
            'prelightingFinalMaxZero': False},
        'uv': {'sourceAttribute': 'RadiosityTexCoord',
            'pixelExpression': ['v1.x * v2.w + v7.z', 'v1.w * v3.w + v7.w'],
            'materialUv': {'surface': 'PS v7.xy = VS v3.xy',
                'radiosity': 'PS v2.w/v3.w = VS v4.xy'},
            'layoutPolicy': 'Use original-size compressed atlas and source affine transform, with no cropping or UV rebasing.'},
        'materialParity': ['albedo', 'raw smoothness', 'final normalized world normal', 'metalness', 'normalAO alpha'],
        'runtimeObserved': False,
        'limitations': ['Native pass activation is static RVM evidence, not a recorded original-game frame.',
            'Browser derivative TBN retains the existing material limitations.',
            'Exact compressed sampling and LightMapPreExposure come from the separate floor/original-atlas recovery.']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'atlasRGBEqual': floor_result == master_result, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
