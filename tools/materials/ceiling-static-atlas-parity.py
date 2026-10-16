"""Ceiling material, bounded atlas kernel and ordinary GBuffer composition."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

SPEC = importlib.util.spec_from_file_location('master_atlas_parity', Path(__file__).with_name('master1uv-static-atlas-parity.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
ROOT = P.ROOT
OUT = ROOT / 'exports/materials/ceiling-static-atlas'
SHADERS = ROOT / 'exports/materials/ceiling-shader'
Machine = P.Machine


def material_machine(atlas):
    samplers = {'s0': '9216198462', 's1': '5993a514cd'} if atlas else {'s0': '5993a514cd'}
    return Machine(SHADERS / ('96644c0f9e.dxbc' if atlas else '1fb4d25b38.dxbc'), 5 if atlas else 0, samplers)


def material(machine, atlas):
    pos, uv = ['position.' + c for c in 'xyz'], ['uv.x', 'uv.y']
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
    tbn_start = 'dp3 r4.x, r3.xyzx, v3.xyzx' if atlas else 'dp3 r5.x, r4.xyzx, v2.xyzx'
    machine.run(P.section(machine, 'add r0.xyz, -v2' if atlas else 'add r0.xyz, -v1', tbn_start))
    tangent = machine.read('r3.xyzx' if atlas else 'r4.xyzx')[:3]
    machine.run(P.section(machine, tbn_start, 'mad r3.x, v1.x' if atlas else 'ld_indexable(buffer)'))
    outputs = {'smoothness': machine.reg['r1'][3], 'normal': machine.read('r2.xywx' if atlas else 'r4.xyzx')[:3], 'tangentNormal': tangent}
    machine.seed('r0.xyz', ['prelighting.' + c for c in 'rgb'])
    machine.seed('cb2[40].x', ['frameExposure'])
    machine.run(P.section(machine, 'mul r1.x, cb1[2].x' if atlas else 'mul r0.w, cb1[2].x', 'ge r0.xy, |r2.wwww|' if atlas else 'ge r0.xy, |r4.zzzz|'))
    outputs.update({'albedo': machine.reg['o1'][:3], 'metalness': machine.reg['o2'][1], 'exposedPrelightingPlusEmission': machine.reg['o3'][:3]})
    return outputs


def atlas_kernel(machine, bounded_smoothness=False):
    machine.seed('r0.xyz', ['delta.' + c for c in 'xyz'])
    machine.seed('r0.w', ['inverseDeltaLength'])
    machine.seed('r1.xyz', ['view.' + c for c in 'xyz'])
    machine.seed('r1.w', ['smoothness'])
    machine.seed('r2.xyw', ['normal.' + c for c in 'xyz'])
    machine.seed('r4.xyz', ['irradiance.' + c for c in 'xyz'])
    for target, role in zip(['r5.xyz', 'r6.xyz', 'r7.xyz'], ['R', 'G', 'B']):
        machine.seed(target, [f'direction{role}.{c}' for c in 'xyz'])
    machine.seed('cb2[41].y', ['LightMapPreExposure'])
    lines = P.section(machine, 'mul r8.xyz, r5.xyzx', 'sample_indexable(texture2d)(float,float,float,float) r0.w, r3.xyxx, t6')
    if bounded_smoothness:
        # This is a domain-bound rewrite, not arbitrary-input identity. The
        # material producer is 2*exp2(1.5*log2(UNORM green)) in [0,2].
        assert lines.count('min r3.z, r1.w, l(1.000000)') == 1
        lines[lines.index('min r3.z, r1.w, l(1.000000)')] = 'mov_sat r3.z, r1.w'
    machine.run(lines)
    return machine.reg['r0'][:3]


def classification():
    manifest = json.loads((ROOT / 'exports/lighting/dfg-gbuffer/manifest.json').read_text())
    records = []
    for name in ['point-specular', 'combine-ibl']:
        record = next(row for row in manifest['consumers'] if row['file'] == name)
        path = ROOT / 'exports/lighting/dfg-gbuffer' / (name + '.dxbc')
        assert hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256']
        records.append(record)
    assert manifest['equations']['materialId'] == 'round(GBuffer0.w*3)'
    assert manifest['equations']['metalness'] == 'GBuffer2.y'
    pixel = material_machine(True).asm
    assert 'mov o0.w, l(0)' in pixel
    assert 'mov o2.xz, l(0,0,0.500000,0)' in pixel
    assert 'mul o2.y, r2.z, l(0.500000)' in pixel
    spec = importlib.util.spec_from_file_location('native_gbuffer', Path(__file__).with_name('native-dfg-gbuffer.py'))
    decoder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(decoder)
    validation = decoder.validation({name: (ROOT / 'exports/lighting/dfg-gbuffer' / (name + '.asm')).read_text()
                                     for name in ['point-specular', 'combine-ibl']})
    return {'source': 'exports/lighting/dfg-gbuffer/manifest.json', 'consumerShaders': records, 'decoderValidation': validation,
        'materialID': 0, 'metalness': '0.5 * metalCS.r', 'reflectance': 0.5,
        'ordinaryCombine': manifest['equations']['indirectDiffuseBeforeExposureAndDynamicAO'],
        'consequence': 'Emission is already part of GBuffer3.rgb, so native ordinary combine multiplies both atlas and material emission by baseColor*(1-metalness)*DFG.b.'}


def smoothness_domain():
    source = json.loads((ROOT / 'exports/materials/ceiling-shader/material-analysis.json').read_text())
    guid = '9a413a2c-3487-11e6-ac79-a3cec912a554'
    assert all(row['bindings']['metalCS']['texture']['fileGuid'] == guid for row in source['materials'])
    published = json.loads((ROOT / 'web/public/assets/recovered-ceiling-materials.json').read_text())['sourceTextures'][guid]
    payload = (ROOT / published['sourceDdsPath']).read_bytes()
    assert hashlib.sha256(payload).hexdigest() == published['sourceDdsSha256']
    assert payload[:4] == b'DDS ' and payload[84:88] == b'DX10'
    assert struct.unpack_from('<I', payload, 128)[0] == 98
    return {'sourceDdsPath': published['sourceDdsPath'], 'sourceDdsSha256': published['sourceDdsSha256'],
        'textureGuid': guid, 'selectedMaterials': len(source['materials']), 'dxgiFormat': 98,
        'format': 'BC7_UNORM', 'sampleDomain': '[0,1]', 'smoothnessDomain': '[0,2]'}


def main():
    regular, atlas = material_machine(False), material_machine(True)
    old, new = material(regular, False), material(atlas, True)
    assert old == new, {key: (old[key], new[key]) for key in old if old[key] != new[key]}
    for values in old.values():
        P.assert_initialized(values)
    floor = Machine(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc')
    ceiling = Machine(SHADERS / '96644c0f9e.dxbc')
    floor_result = P.atlas_kernel(floor, False)
    raw_result = atlas_kernel(ceiling)
    assert floor_result != raw_result
    bounded = Machine(SHADERS / '96644c0f9e.dxbc')
    bounded_result = atlas_kernel(bounded, True)
    assert floor_result == bounded_result, (floor_result, bounded_result)
    P.assert_initialized(bounded_result)
    classification_evidence = classification()
    result = {'evidenceId': 'BF2-CEILING-STATIC-ATLAS-PARITY-001', 'runtimeObserved': False,
        'method': 'Lane-level symbolic original text-DXBC with exact float32 literals, typed samples and bound sampler identities.',
        'materialExpressionsEqual': {key: P.digest(value) for key, value in old.items()},
        'unrestrictedAtlasKernelEqual': False, 'sourceDomainAtlasKernelEqual': True,
        'sourceDomainRewrite': {'original': 'min(smoothness,1)', 'commonHelper': 'saturate(smoothness)',
            'producer': 'smoothness=exp2(log2(metalCS.g)*1.5)+exp2(log2(metalCS.g)*1.5)',
            'inputDomain': 'BC7_UNORM metalCS.g in [0,1]', 'outputDomain': '[0,2]',
            'zeroEndpoint': 'log2(0)=-infinity; exp2(-infinity)=0. No arbitrary negative or NaN smoothness claimed.',
            'textureDomainEvidence': smoothness_domain()},
        'atlasRGBExpressionsEqual': P.digest(floor_result), 'uniqueSymbolicNodes': len(P.NODES),
        'literalMaps': {name: machine.literals for name, machine in [('ordinary', regular), ('atlasMaterial', atlas), ('floorKernel', floor), ('ceilingKernel', ceiling)]},
        'classification': classification_evidence,
        'composition': {'materialAO': 'None; effective multiplier one.',
            'emissive': 'mask * cb1[1].rgb * (cb1[2].x*cb1[3].x), added to atlas before frame exposure and GBuffer combine.',
            'skyVisibility': 't6.r directly to o2.w', 'prelightingFinalMaxZero': False},
        'limitations': ['Static source proof; original-game runtime pass activation, sampler execution and GBuffer quantization are not captured.',
            'Common helper parity is restricted to the nonnegative source smoothness domain; native code uses min rather than saturate.',
            'Browser derivative tangent parity remains unresolved. Native zero-direction and half-vector singularities remain unchanged.']}
    OUT.mkdir(exist_ok=True)
    (OUT / 'parity-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    binding = json.loads((OUT / 'binding-evidence.json').read_text())
    recipe = {'schemaVersion': 1, 'evidenceId': 'BF2-CEILING-STATIC-ATLAS-RECIPE-001', 'family': 'ceiling',
        'shaderName': binding['shaderName'], 'pixelShader': binding['pixelShader'], 'pixelShaderSha256': binding['pixelShaderSha256'],
        'bindingEvidence': 'exports/materials/ceiling-static-atlas/binding-evidence.json',
        'parityEvidence': 'exports/materials/ceiling-static-atlas/parity-evidence.json',
        'commonAtlasKernel': {'shader': 'f789fdaafa', 'helper': 'bf2_staticAtlasPrelighting',
            'equivalence': 'Identical symbolic expressions after min(S,1)=saturate(S) on the proven nonnegative source smoothness domain; exact float32 literal bits.',
            'domainRestriction': result['sourceDomainRewrite']},
        'atlasRegisters': {row['register']: row['producer']['name'] for row in binding['functionInstances'][0]['textureMapping'] if 'producer' in row},
        'normal': {'nativeVariable': 'r2.xyw after TBN mapping and final dp3/rsq/mul normalization', 'space': 'source world', 'normalized': True,
            'browserExpression': 'inverseTransformDirection(geometryNormal, viewMatrix)', 'stage': 'Final world shading normal. Tangent input is not separately normalized.'},
        'smoothness': {'nativeVariable': 'r1.w, written unchanged to o0.z', 'browserExpression': 'bf2_ceiling_surface.smoothness',
            'kernelOperation': 'min(rawSmoothness,1), equivalent to saturate on source [0,2] domain'},
        'materialAO': {'source': 'No material AO term', 'value': 1, 'applications': 0, 'existingHook': None, 'doNotMultiplyInsideAtlasHelper': True},
        'emissive': {'browserExpression': 'bf2_ceiling_surface.emissive', 'nativeExpression': 'mask*cb1[1].rgb*(cb1[2].x*cb1[3].x)',
            'stage': 'Add to prelighting before frame exposure and ordinary DFG/albedo/metalness combine.',
            'indirectPrelightingExpression': 'commonAtlasKernel + bf2_ceiling_surface.emissive',
            'separateThreeEmission': False},
        'gbuffer': {'materialID': 0, 'metalness': '0.5*metalCS.r', 'metalnessBrowserExpression': 'bf2_ceiling_surface.nativeScalar',
            'reflectance': 0.5, 'skyVisibility': 't6.r written directly to o2.w',
            'prelighting': 'o3.rgb=(commonAtlasKernel+materialEmission)*cb2[40].x', 'prelightingFinalMaxZero': False,
            'classificationEvidence': classification_evidence},
        'uv': {'sourceAttribute': 'RadiosityTexCoord', 'pixelExpression': ['v1.x*v2.w+v6.z', 'v1.w*v3.w+v6.w'],
            'materialRouting': 'PS v6.xy; CS uses UV*cb1[0].x, normal uses twice that, mask uses original UV.',
            'layoutPolicy': 'Original-size compressed atlas and original affine transform; no cropping/rebasing.'},
        'materialParity': list(old), 'runtimeObserved': False, 'limitations': result['limitations']}
    (OUT / 'integration-recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'materialOutputsEqual': list(old), 'unrestrictedAtlasKernelEqual': False,
        'sourceDomainAtlasKernelEqual': True, 'symbolicNodes': len(P.NODES)}))


if __name__ == '__main__':
    main()
