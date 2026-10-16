"""Independent ordinary/atlas material and common-lighting symbolic proof."""
import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('symbolic', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
SHADERS = ROOT / 'exports/materials/propspreset-shader'
OUT = ROOT / 'exports/materials/propspreset-routing'
PAIRS = [('c13680b516', 'b5b53e93ab', 'clampAll'), ('93681d7ffd', '2561af268e', 'clampVertical'),
         ('3352783e34', 'd390b460db', 'emissiveTwoUV')]


def material(pixel, atlas, family):
    machine = P.Machine(SHADERS / (pixel + '.dxbc'), 5 if atlas else 0,
                        {'s0': '9216198462', 's1': '5993a514cd'} if atlas else {'s0': '5993a514cd'})
    machine.seed('v2.xyz' if atlas else 'v1.xyz', ['position.' + c for c in 'xyz'])
    if atlas:
        machine.seed('v6.xy', ['baseUv.x', 'baseUv.y'])
        if family == 'emissiveTwoUV':
            machine.seed('v6.zw', ['detailUv.x', 'detailUv.y'])
    else:
        machine.seed('v1.w', ['detailUv.x' if family == 'emissiveTwoUV' else 'baseUv.x'])
        machine.seed('v2.w', ['detailUv.y' if family == 'emissiveTwoUV' else 'baseUv.y'])
        if family == 'emissiveTwoUV':
            machine.seed('v3.w', ['baseUv.x'])
            machine.seed('v4.w', ['baseUv.y'])
    for i in range(3):
        machine.seed(f'v{i + (3 if atlas else 2)}.xyz', [f'TBN.row{i}.' + c for c in 'xyz'])
    machine.seed('cb2[37].xyz', ['camera.' + c for c in 'xyz'])
    for i in range(5 if family == 'emissiveTwoUV' else 2):
        machine.seed(f'cb1[{i}].xyzw', [f'constant{i}.' + c for c in 'xyzw'])
    first = 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1'
    tbn = 'dp3 r6.x, r5.xyzx, v3.xyzx' if atlas else (
        'dp3 r4.x, r5.xyzx, v2.xyzx' if family == 'emissiveTwoUV' else
        'dp3 r6.x, r5.xyzx, v2.xyzx' if family == 'clampVertical' else 'dp3 r2.x, r5.xyzx, v2.xyzx')
    machine.run(P.section(machine, first, tbn))
    tangent = machine.reg['r5'][:3]
    machine.run(P.section(machine, tbn, 'mad r5.x, v1.x' if atlas else 'ld_indexable(buffer)'))
    normal = machine.read('r3.xywx')[:3] if atlas else machine.reg['r4' if family == 'emissiveTwoUV' else 'r5'][:3]
    # Compiler reverses final normalization multiply operands in clampAll SH.
    # Canonicalize only this proven multiplication, not arbitrary arithmetic.
    normal = [P.node('mul', *sorted(P.NODES[value][1:])) if P.NODES[value][0] == 'mul' else value for value in normal]
    outputs = {'rawSmoothness': machine.reg['r1'][3], 'tangentNormal': tangent, 'finalWorldNormal': normal}
    if family == 'emissiveTwoUV':
        outputs['metalness'] = machine.reg['cb1[2]'][0]
        color = 'mul r1.xyz, r4.yyyy, cb1[0].xyzx' if atlas else 'mul r1.xyz, r2.yyyy, cb1[0].xyzx'
        machine.seed('r0.xyz', ['prelighting.' + c for c in 'xyz'])
    else:
        outputs['metalness'] = machine.reg['r4'][1] if atlas else machine.reg['r2'][1 if family == 'clampVertical' else 3]
        color = 'mul r1.xyz, r2.xyzx, r3.zzzz' if atlas else 'mul r1.xyz, r3.xyzx, r4.zzzz'
    machine.run(P.section(machine, color, 'mul o3.xyz'))
    outputs['albedo'] = machine.reg['o1'][:3]
    if family == 'emissiveTwoUV':
        outputs['prelightingPlusEmission'] = machine.reg['r0'][:3]
    for values in outputs.values():
        P.assert_initialized(values if isinstance(values, list) else [values])
    return outputs, machine


def kernel(pixel):
    machine = P.Machine(SHADERS / (pixel + '.dxbc'))
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r1.w', ['smoothness'])
    machine.seed('r3.xyw', ['normal.' + c for c in 'xyz'])
    machine.seed('r4.xzw', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r6.xyz', 'r7.xyz', 'r8.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.' + c for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    machine.run(P.section(machine, 'mul r9.xyz, r6.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r5.xyxx, t6'))
    return machine.reg['r0'][:3]


def main():
    routing = json.loads((OUT / 'routing-evidence.json').read_text())
    floor = P.Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    reference = P.atlas_kernel(floor, False)
    groups = []
    for ordinary, atlas, family in PAIRS:
        old, regular = material(ordinary, False, family)
        new, mapped = material(atlas, True, family)
        assert old == new, {k: (old[k], new[k]) for k in old if old[k] != new[k]}
        expression = kernel(atlas)
        assert reference == expression
        for ps, expected in [(ordinary, {'s0': '5993a514cd'}), (atlas, {'s0': '9216198462', 's1': '5993a514cd'})]:
            for instance in routing['shaders'][ps]['instances']:
                assert {x['register']: x['payloadBlock'] for x in instance['samplerMapping']} == expected
        groups.append({'family': family, 'ordinaryPixelShader': ordinary, 'atlasPixelShader': atlas,
            'materialExpressions': {key: P.digest(value if isinstance(value, list) else [value]) for key, value in old.items()},
            'commonAtlasKernelExpressions': P.digest(expression), 'literalMaps': {'ordinary': regular.literals, 'atlas': mapped.literals},
            'materialAO': 1, 'materialID': 0, 'reflectance': .5,
            'emissionStage': 'Add before frame exposure and deferred DFG/albedo/nonmetal composition' if family == 'emissiveTwoUV' else 'No emission',
            'worldNormal': 'Normalize(TBN rows dot tangentNormal); no earlier tangent normalization',
            'sourceSampler': '5993a514cd wrap U/V; explicit normal-only coordinate saturate remains in shader',
            'prelightingFinalMaxZero': {'ordinarySH': True, 'atlas': False}})
    result = {'evidenceId': 'BF2-PROPSPRESET-MATERIAL-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Lane-level symbolic original DXBC with exact original float32 literal bits, typed array XYZ coordinates, and resolved sampler identities. Only final normalization multiply operand order is canonicalized (a*b versus b*a).',
        'groups': groups, 'symbolicNodeCount': len(P.NODES),
        'limitations': ['This proves instruction expressions, not live pass activation, texture-view construction, native rasterization or float32/FMA execution.',
            'LOD-simple has no retained five-atlas route for these selected section predicates.',
            'Browser source tangent/UV1 attributes and source constant publication remain separate implementation work.']}
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    primary = 'b5b53e93ab'
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-PROPSPRESET-STATIC-ATLAS-RECIPE-001', 'family': 'propspreset',
        'shaderName': routing['sourceShader'], 'pixelShader': primary, 'pixelShaderSha256': routing['shaders'][primary]['sha256'],
        'primaryShaderScope': 'Primary common-kernel reference only. Native material variant is selected by the exact eligible section table below.',
        'bindingEvidence': 'exports/materials/propspreset-routing/routing-evidence.json',
        'parityEvidence': 'exports/materials/propspreset-routing/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting', 'equivalence': 'Exact symbolic kernel identity for all three atlas variants, preserving source float32 literals.'},
        'variants': [{'family': family, 'ordinaryPixelShader': ordinary, 'pixelShader': atlas,
            'pixelShaderSha256': routing['shaders'][atlas]['sha256']} for ordinary, atlas, family in PAIRS],
        'eligibleSections': [{'assetId': row['assetId'], 'materialId': row['materialId'], 'pixelShader': row['atlasPixelShaders'][0]}
                             for row in routing['sections'] if row['atlasPixelShaders']],
        'excludedSections': [{'assetId': row['assetId'], 'materialId': row['materialId'], 'reason': 'No five-atlas shader reachable under the selected compiled section predicates.'}
                             for row in routing['sections'] if not row['atlasPixelShaders']],
        'normal': {'space': 'source world', 'normalized': True, 'nativeVariable': 'r3.xyw, after TBN and final normalization',
                   'browserExpression': 'inverseTransformDirection(geometryNormal,viewMatrix)'},
        'smoothness': {'nativeVariable': 'r1.w written unchanged to o0.z', 'browserExpression': 'bf2_props_surface.smoothness',
                       'kernelOperation': 'Saturate raw source smoothness inside the common kernel.'},
        'materialAO': {'value': 1, 'applications': 0, 'existingHook': None, 'doNotMultiplyInsideAtlasHelper': True},
        'emissive': {'browserExpression': 'bf2_props_surface.emissive', 'stage': 'Add to atlas/SH prelighting before frame exposure and native DFG/albedo/nonmetal response; zero for non-emissive branches.',
                     'threeTotalEmissiveRadiance': 'Must remain zero.'},
        'gbuffer': {'materialID': 0, 'reflectance': .5, 'skyVisibility': 'Original t6.r direct to o2.w, no extra AO or clamp.',
                    'prelightingFinalMaxZero': False, 'prelighting': '(commonAtlasKernel + sourceEmission) * cb2[40].x'},
        'uv': {'sourceAttribute': 'RadiosityTexCoord', 'layoutPolicy': 'Original-size compressed atlas and original affine coordinates. No crop/rebase.',
               'material': 'UV0 normal/detail; alarm CS/mask/layer uses original UV1.'},
        'runtimeObserved': False,
        'limitations': ['Do not promote all PropsPreset sections by shaderName: five sections explicitly have no selected atlas variant.',
                       'Native live pass activation is not captured. Source shader tree gives the exact allowed pass set.',
                       'Browser derivative TBN is separate from exact original material and lighting arithmetic.']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'groups': len(groups), 'materialAndKernelEqual': True, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
