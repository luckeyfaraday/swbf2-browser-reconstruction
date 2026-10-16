"""Exact original material and five-atlas arithmetic for PropsNonMetallicPreset."""
import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
OUT = ROOT / 'exports/materials/propsnonmetal-shader'


def material(atlas):
    machine = P.Machine(OUT / ('1c6f05ad3a.dxbc' if atlas else '1e3d99cec3.dxbc'), 5 if atlas else 0,
        {'s0': '9216198462', 's1': '5993a514cd'} if atlas else {'s0': '5993a514cd'})
    machine.seed('v2.xyz' if atlas else 'v1.xyz', ['position.' + c for c in 'xyz'])
    if atlas:
        machine.seed('v6.xy', ['uv.x', 'uv.y'])
    else:
        machine.seed('v1.w', ['uv.x'])
        machine.seed('v2.w', ['uv.y'])
    for i in range(3):
        machine.seed(f'v{i + (3 if atlas else 2)}.xyz', [f'TBN.row{i}.' + c for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    start = 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1'
    tbn = 'dp3 r4.x, r3.xyzx, v3.xyzx' if atlas else 'dp3 r4.x, r2.xyzx, v2.xyzx'
    machine.run(P.section(machine, start, tbn))
    tangent = machine.read('r3.xyzx' if atlas else 'r2.xyzx')[:3]
    machine.run(P.section(machine, tbn, 'mad r4.x, v1.x' if atlas else 'ld_indexable(buffer)'))
    normal = machine.read('r3.xyzx' if atlas else 'r2.xyzx')[:3]
    machine.run(['mov o1.xyz, r2.xyzx' if atlas else 'mov o1.xyz, r3.xyzx', 'mov o2.xyz, l(0,0,0.500000,0)'])
    outputs = {'albedo': machine.reg['o1'][:3], 'rawSmoothness': [machine.reg['r2' if atlas else 'r3'][3]],
        'tangentNormal': tangent, 'finalWorldNormal': normal, 'metalness': [machine.reg['o2'][1]], 'reflectance': [machine.reg['o2'][2]]}
    return outputs, machine


def kernel():
    machine = P.Machine(OUT / '1c6f05ad3a.dxbc')
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r2.w', ['smoothness'])
    machine.seed('r3.xyz', ['normal.' + c for c in 'xyz'])
    machine.seed('r5.xyz', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r6.xyz', 'r7.xyz', 'r8.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.' + c for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r9.xyz, r6.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r4.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    old, ordinary = material(False)
    new, atlas = material(True)
    assert old == new, {key: [old[key], new[key]] for key in old if old[key] != new[key]}
    for row in old.values():
        P.assert_initialized(row)
    floor = P.Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    common, actual = P.atlas_kernel(floor, False), kernel()
    assert common == actual
    P.assert_initialized(actual)
    binding = json.loads((OUT / 'material-analysis.json').read_text())
    for pixel in ['1e3d99cec3','1c6f05ad3a']:
        for instance in binding['selectedDeferredFunctions'][pixel]:
            slots = instance['textureMapping']
            if pixel == '1c6f05ad3a':
                assert [row['producer']['selector'] for row in slots[:5]] == [18,19,20,21,22]
                assert [row['payloadBlock'] for row in instance['samplerMapping']] == ['9216198462','5993a514cd']
            else:
                assert [row['payloadBlock'] for row in instance['samplerMapping']] == ['5993a514cd']
            assert [row['parameterHash'] for row in slots if 'parameterHash' in row] == [5861109,5861212]
    result = {'evidenceId': 'BF2-PROPSNONMETAL-MATERIAL-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Original DXBC lane-level symbolic expressions and exact float32 literal words, resolved native sampler identities; no material algebraic reassociation.',
        'materialExpressions': {key: P.digest(row) for key, row in old.items()}, 'commonAtlasKernelExpressions': P.digest(actual),
        'literalMaps': {'ordinary': ordinary.literals, 'atlas': atlas.literals}, 'symbolicNodes': len(P.NODES),
        'composition': {'metalness': 0, 'reflectance': .5, 'materialId': 0, 'materialAO': 1, 'emissive': [0,0,0],
            'prelightingFinalMaxZero': {'ordinarySH': True, 'atlas': False}, 'skyVisibility': 'Original atlas t6.r goes directly to o2.w'},
        'limitations': ['Instruction expression proof does not establish filtering, original live dispatch, FMA execution or GBuffer quantization.',
            'Ordinary SH contains always-on broadened specular; independent ordinary shader execution validates any shared helper separately.']}
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    eligible = [row for row in binding['materials'] if '1c6f05ad3a' in row['deferredPixelShaders']]
    excluded = [row for row in binding['materials'] if '1c6f05ad3a' not in row['deferredPixelShaders']]
    assert len(eligible) == 19 and len(excluded) == 3
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-PROPSNONMETAL-STATIC-ATLAS-RECIPE-001', 'family': 'propsnonmetal', 'shaderName': binding['shaderName'],
        'pixelShader': '1c6f05ad3a', 'pixelShaderSha256': binding['pixelShaders']['1c6f05ad3a']['sha256'],
        'bindingEvidence': 'exports/materials/propsnonmetal-shader/material-analysis.json', 'parityEvidence': 'exports/materials/propsnonmetal-shader/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting', 'equivalence': 'Exact lane-level symbolic expressions including original float32 literal words.'},
        'ordinarySH': {'helper':'volcanicObjectPrelighting','scale':1,'normal':'normalized final source world normal','smoothness':'CS.a',
            'validation':'exports/materials/propsnonmetal-shader/warp-validation.json',
            'fallbackRequirement':'Unmatched atlas rows and ordinary-only sections use SH plus broadened specular. Diffuse-only bf2_probeDiffuse is insufficient for this family.'},
        'eligibleSections': [{'assetId': row['assetId'], 'materialId': row['materialId'], 'pixelShader': '1c6f05ad3a'} for row in eligible],
        'excludedSections': [{'assetId': row['assetId'], 'materialId': row['materialId'], 'reason': 'Exact selected compiled section inputs have no five-atlas route.'} for row in excluded],
        'normal': {'nativeVariable': 'r3.xyz after original XY normal decode, TBN mapping and final normalization', 'space': 'source world', 'normalized': True,
            'browserExpression': 'inverseTransformDirection(geometryNormal,viewMatrix)'},
        'smoothness': {'nativeVariable': 'r2.w from CS alpha, written unchanged to o0.z', 'browserExpression': 'bf2_propsnonmetal_surface.smoothness', 'kernelOperation': 'Saturate raw source smoothness inside common kernel.'},
        'materialAO': {'value': 1, 'applications': 0, 'existingHook': None, 'doNotMultiplyInsideAtlasHelper': True},
        'emissive': {'value': [0,0,0], 'source': 'No material emission term in complete o3.rgb path.'},
        'gbuffer': {'materialID': 0, 'metalness': 0, 'reflectance': .5, 'skyVisibility': 't6.r directly to o2.w',
            'prelighting': 'commonAtlasKernel * cb2[40].x', 'prelightingFinalMaxZero': False},
        'uv': {'sourceAttribute': 'RadiosityTexCoord', 'pixelExpression': ['v1.x*v2.w+v6.z','v1.w*v3.w+v6.w'],
            'layoutPolicy': 'Original-size compressed atlas and original source affine UV. No crop/rebase.', 'material': 'Original UV0, both CS and NW use native wrap U/V.'},
        'runtimeObserved': False, 'limitations': ['Filter exact19 eligible sections; three are excluded.',
            'Three-texture and dual-atlas variants remain separate source routes, not interchangeable.', 'Browser adapter and native tangent publication are separate.']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'commonKernelEqual': True, 'eligibleSections':len(eligible),'excludedSections':len(excluded),'symbolicNodes':len(P.NODES)}))


if __name__ == '__main__':
    main()
