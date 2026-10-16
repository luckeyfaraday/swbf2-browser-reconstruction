"""Validate exact local-volume sky/AO instructions; no game or GPU execution."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting'
SPEC = importlib.util.spec_from_file_location('reflection_math', Path(__file__).with_name('native-dfg-reflection-math.py'))
MATH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MATH)


def evaluate(sky, scale, offset, skip_ao, skip_mask, screen_ao, ndotv, roughness):
    sat = lambda value: min(1, max(0, value))
    remapped = sat(sat(sky) * scale + offset)
    ao = min(screen_ao, max(remapped, skip_ao))
    specular = sat((ndotv + ao) ** (2 ** (-16 * roughness * roughness - 1)) + ao - 1)
    return {'remappedSky': remapped, 'occlusionInput': ao,
            'specularOcclusion': specular, 'skyMask': max(1 - remapped, skip_mask)}


def recover():
    shader = OUT / 'dfg-reflection-shaders/local-type4.dxbc'
    asm = OUT / 'dfg-reflection-shaders/local-type4.asm'
    lines = [line.strip() for line in asm.read_text().splitlines()]
    branches = {
        'sphere': (MATH.section(lines, 'mad_sat r10.w, r5.x, cb0[r7.w + 55].x, cb0[r7.w + 55].y',
                                'add_sat r11.w, r11.w, l(-1.000000)'),
                   MATH.section(lines, 'add r10.w, -r10.w, l(1.000000)',
                                'max r10.w, r10.w, cb0[r7.w + 54].w'), 'r11', 'r10'),
        'box': (MATH.section(lines, 'mad_sat r11.w, r5.x, cb0[r7.w + 55].x, cb0[r7.w + 55].y',
                             'add_sat r12.w, r12.w, l(-1.000000)'),
                MATH.section(lines, 'add r11.w, -r11.w, l(1.000000)',
                             'max r7.w, r11.w, cb0[r7.w + 54].w'), 'r12', 'r7'),
    }
    assert 'ld_indexable(texture2d)(float,float,float,float) r5.xyz, r2.xyww, t2.wyzx' in lines
    assert 'mov_sat r5.x, r5.x' in lines
    rng = random.Random(0x5A7A0)
    maximum, examples = 0., []
    for case in range(1200):
        sky, scale, offset = rng.uniform(-.2, 1.2), rng.uniform(1, 11), rng.uniform(-5, 0)
        skip_ao, skip_mask = case % 2, (case // 2) % 2
        screen, nv, roughness = rng.random(), rng.random(), rng.random()
        expected = evaluate(sky, scale, offset, skip_ao, skip_mask, screen, nv, roughness)
        for branch, (visibility, mask, spec_reg, mask_reg) in branches.items():
            registers = {'r1': [screen, 0, 0, 0], 'r4': [nv, roughness * roughness, 0, 0],
                         'r5': [sky, 0, 0, 0], 'c53': [0, 0, 0, skip_ao],
                         'c54': [0, 0, 0, skip_mask], 'c55': [scale, offset, 0, 0]}
            code = ['mov_sat r5.x, r5.x', 'mad r5.z, r4.y, l(-16.000000), l(-1.000000)',
                    'exp r5.z, r5.z'] + visibility + mask
            actual = MATH.interpret(code, registers)
            maximum = max(maximum, abs(actual[spec_reg][3] - expected['specularOcclusion']),
                          abs(actual[mask_reg][3] - expected['skyMask']))
        if case < 24:
            examples.append({'inputs': {'skyVisibility': sky, 'skyVisibilityScale': scale,
                             'skyVisibilityOffset': offset, 'skipSkyVisibilityAsAO': skip_ao,
                             'skipSkyVisibilityAsMask': skip_mask, 'screenDiffuseOcclusion': screen,
                             'ndotv': nv, 'perceptualRoughness': roughness}, 'expected': expected})
    assert maximum < 1e-12
    source = OUT / 'dfg-reflection-recovery.json'
    volumes = json.loads(source.read_text())['volumes']
    fields = ['UseSkyVisibilityAsAO', 'UseSkyVisibilityAsMask', 'SharpenSkyVisibility', 'BiasSkyVisibility']
    assert len(volumes) == 88
    assert all([v[field] for field in fields] == [False, False, 0, .5] for v in volumes)
    report = {
        'schemaVersion': 1, 'evidenceId': 'BF2-NATIVE-LOCAL-REFLECTION-VISIBILITY-001',
        'shader': shader.relative_to(ROOT).as_posix(), 'shaderSha256': hashlib.sha256(shader.read_bytes()).hexdigest(),
        'sourceProgram': 'Dx11/DeferredTiledLightingCS_splitLight=0,gbLayout=0,lightType=4,reference=0,materialPassType=0,volumetricShadowMaps=0,dynamicAO=0,translucency=0,cbv=1',
        'skyProducer': 'Native atlas PS f789fdaafa t6.r → GBuffer2.w → local t2.w → r5.x, saturated before per-volume processing.',
        'equations': {'s': 'saturate(saturate(skyVisibility)*skyVisibilityScale+skyVisibilityOffset)',
                      'ao': 'min(screenDiffuseOcclusion,max(s,skipSkyVisibilityAsAO))',
                      'specularOcclusion': 'saturate(pow(NdotV+ao,exp2(-16*perceptualRoughness^2-1))+ao-1)',
                      'skyMask': 'max(1-s,skipSkyVisibilityAsMask)',
                      'contribution': 'remaining * geometricFade * skyMask * specularOcclusion * nativeDFGResponse * cubeRGB * inverseLRVExposure',
                      'coverage': 'remaining *= 1 - geometricFade*skyMask*cubeAlpha'},
        'rdefFields': {'skipSkyVisibilityAsAO': 860, 'skipSkyVisibilityAsMask': 876,
                       'skyVisibilityScale': 880, 'skyVisibilityOffset': 884},
        'nativeBuilder': '140f86570: invert runtime bytes+a5/+a6; scale=1+10*float[a8]; offset=-(scale-1)*float[ac]. See dfg-reflection-volumes.json.',
        'branches': {name: {'visibilityInstructions': values[0], 'maskInstructions': values[1]}
                     for name, values in branches.items()},
        'validation': {'casesPerBranch': 1200, 'branches': 2, 'maximumAbsoluteError': maximum,
                       'kind': 'Independent original instruction-slice interpretation versus compact double algebra, not native GPU execution.'},
        'examples': examples,
        'selectedMapAudit': {'count': len(volumes), 'source': source.relative_to(ROOT).as_posix(),
                             'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                             'valuesForEveryVolume': dict(zip(fields, [False, False, 0, .5])),
                             'volumeIds': [v['$id'] for v in volumes]},
        'limitations': [
            'EBX entity fields to 224-byte runtime record remain an unproven producer edge; do not silently promote matching names to a native association.',
            'If those authored flags reach the native record unchanged, all selected local volumes skip atlas sky visibility as both AO and mask. This is an explicit conditional inference.',
            'screenDiffuseOcclusion is original t10, distinct from an arbitrary material AO factor; no browser substitute is chosen here.',
            'Ordered volume coverage, influence masks, native capture exposure and runtime projection selection remain separate integration limits.',
        ],
    }
    return report


if __name__ == '__main__':
    report = recover()
    (OUT / 'local-reflection-visibility.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'evidenceId': report['evidenceId'], **report['validation'],
                      'selectedVolumes': report['selectedMapAudit']['count']}))
