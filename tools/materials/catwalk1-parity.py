"""Original Catwalk1 material and common atlas symbolic arithmetic parity."""
import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
OUT = ROOT / 'exports/materials/catwalk1-shader'


def material(atlas):
    machine = P.Machine(OUT / ('3b42a4bca7.dxbc' if atlas else 'd260c7f82c.dxbc'), 5 if atlas else 0,
        {'s0': '9216198462', 's1': '5993a514cd', 's2': '83d4c1d84a'} if atlas else {'s0': '5993a514cd', 's1': '83d4c1d84a'})
    machine.seed('v2.xyz' if atlas else 'v1.xyz', ['position.' + c for c in 'xyz'])
    if atlas:
        machine.seed('v6.xy', ['uv.x', 'uv.y'])
    else:
        machine.seed('v1.w', ['uv.x'])
        machine.seed('v2.w', ['uv.y'])
    for i in range(3):
        machine.seed(f'v{i + (3 if atlas else 2)}.xyz', [f'TBN.row{i}.' + c for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    machine.seed('cb1[0].xyzw', ['detailUVScale.' + c for c in 'xyzw'])
    start = 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1'
    tbn = 'dp3 r5.x, r4.xyzx, v3.xyzx' if atlas else 'dp3 r5.x, r2.xyzx, v2.xyzx'
    machine.run(P.section(machine, start, tbn))
    tangent = machine.read('r4.xyzx' if atlas else 'r2.xyzx')[:3]
    machine.run(P.section(machine, tbn, 'mad r5.x, v1.x' if atlas else 'ld_indexable(buffer)'))
    normal = machine.read('r4.xyzx' if atlas else 'r2.xyzx')[:3]
    machine.run(['mul o1.xyz, r2.xyzx, r3.xyzx' if atlas else 'mul o1.xyz, r3.xyzx, r4.xyzx', 'mov o2.xyz, l(0,0,0.500000,0)'])
    outputs = {'albedo': machine.reg['o1'][:3], 'rawSmoothness': [machine.reg['r1'][3]], 'tangentNormal': tangent, 'finalWorldNormal': normal,
        'metalness': [machine.reg['o2'][1]], 'reflectance': [machine.reg['o2'][2]]}
    return outputs, machine


def kernel():
    machine = P.Machine(OUT / '3b42a4bca7.dxbc')
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r1.w', ['smoothness'])
    machine.seed('r4.xyz', ['normal.' + c for c in 'xyz'])
    machine.seed('r6.xyz', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r7.xyz', 'r8.xyz', 'r9.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.' + c for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r10.xyz, r7.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r5.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    old, regular = material(False)
    new, atlas = material(True)
    assert old == new, {key: [old[key], new[key]] for key in old if old[key] != new[key]}
    for row in old.values():
        P.assert_initialized(row)
    floor = P.Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    common, actual = P.atlas_kernel(floor, False), kernel()
    assert common == actual
    P.assert_initialized(actual)
    result = {'evidenceId': 'BF2-CATWALK1-MATERIAL-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Original DXBC lane-level symbolic expressions and exact float32 literal words, with resolved native sampler identities.',
        'materialExpressions': {key: P.digest(row) for key, row in old.items()}, 'commonAtlasKernelExpressions': P.digest(actual),
        'literalMaps': {'ordinary': regular.literals, 'atlas': atlas.literals}, 'symbolicNodes': len(P.NODES),
        'composition': {'metalness': 0, 'reflectance': .5, 'materialId': 0, 'materialAO': 1, 'emissive': [0, 0, 0],
            'prelightingFinalMaxZero': {'ordinarySH': True, 'atlas': False}, 'skyVisibility': 'Original atlas t6.r goes directly to o2.w'},
        'limitations': ['Instruction expression proof does not establish hardware filtering, original live pass activation, FMA execution or GBuffer quantization.']}
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'material-analysis.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-CATWALK1-STATIC-ATLAS-RECIPE-001', 'family': 'catwalk1', 'shaderName': binding['shaderName'],
        'pixelShader': '3b42a4bca7', 'pixelShaderSha256': binding['pixelShaders']['3b42a4bca7']['sha256'],
        'bindingEvidence': 'exports/materials/catwalk1-shader/material-analysis.json', 'parityEvidence': 'exports/materials/catwalk1-shader/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting', 'equivalence': 'Exact lane-level symbolic expressions including original float32 literal words.'},
        'eligibleSections': [{'assetId': row['assetId'], 'materialId': row['materialId'], 'pixelShader': row['atlasPixelShader']} for row in binding['materials'] if row['atlasPixelShader']],
        'excludedSections': [{'assetId': row['assetId'], 'materialId': row['materialId'], 'reason': 'Exact selected compiled section inputs have no five-atlas route.'} for row in binding['materials'] if not row['atlasPixelShader']],
        'normal': {'nativeVariable': 'r4.xyz after tangent normalization, TBN mapping, and final normalization', 'space': 'source world', 'normalized': True,
            'browserExpression': 'inverseTransformDirection(geometryNormal,viewMatrix)'},
        'smoothness': {'nativeVariable': 'r1.w written unchanged to o0.z', 'browserExpression': 'bf2_catwalk1_surface.smoothness', 'kernelOperation': 'Saturate raw source smoothness inside common kernel.'},
        'materialAO': {'value': 1, 'applications': 0, 'existingHook': None, 'doNotMultiplyInsideAtlasHelper': True},
        'emissive': {'value': [0, 0, 0], 'source': 'No material emission term in complete o3.rgb path.'},
        'gbuffer': {'materialID': 0, 'metalness': 0, 'reflectance': .5, 'skyVisibility': 't6.r directly to o2.w',
            'prelighting': 'commonAtlasKernel * cb2[40].x', 'prelightingFinalMaxZero': False},
        'uv': {'sourceAttribute': 'RadiosityTexCoord', 'layoutPolicy': 'Original-size compressed atlas and original source affine UV. No crop/rebase.',
            'material': 'Original UV0; source world XZ * 0.1 for grunge. NW clamped by sampler, all other material inputs wrap.'},
        'runtimeObserved': False, 'limitations': ['Native live pass not captured. Browser adapter and native tangent publication are separate.', 'Filter exact eligibleSections; one source section is explicitly excluded.']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'commonKernelEqual': True, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
