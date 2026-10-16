"""Extract bounded original deferred consumers and verify ordinary GBuffer math.

Static artifact evidence only. The tiny interpreter evaluates selected original
assembly instructions; it does not execute the original shader or render a game.
"""
import ctypes
import hashlib
import json
import pathlib
import random
import re
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'exports/lighting/dfg-shaderprogramdb/0.res'
OUT = ROOT / 'exports/lighting/dfg-gbuffer'
PROGRAMS = {
    'point-specular': 'Dx11/DeferredPointLight_specular=1,skin=0,trans=0,splitLight=0,gbLayout=0',
    'combine-basic': 'Dx11/DeferredLightTileCombine_splitLight=0,gbLayout=0,distantSpecularIBL=0,reference=0,ssr=0,outdoorLight=0,localReflectionBehavior=0,indirectClear=0,secondaryCloud=0',
    'combine-ibl': 'Dx11/DeferredLightTileCombine_splitLight=0,gbLayout=0,distantSpecularIBL=1,reference=0,ssr=0,outdoorLight=0,localReflectionBehavior=0,indirectClear=0,secondaryCloud=0',
    'gbuffer-fixup': 'Dx11/DeferredGBufferSimpleFixupFatPack_sssoats=0',
    'tiled-light': 'Dx11/DeferredTiledLightingCS_splitLight=0,gbLayout=0,lightType=2,reference=0,materialPassType=0,volumetricShadowMaps=0,dynamicAO=0,translucency=0,cbv=1',
}


def assembly(bytecode):
    library = ctypes.WinDLL('C:/Windows/System32/d3dcompiler_47.dll')
    disassemble = library.D3DDisassemble
    disassemble.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint,
                           ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
    disassemble.restype = ctypes.c_long
    buffer = ctypes.create_string_buffer(bytecode)
    blob = ctypes.c_void_p()
    assert disassemble(buffer, len(bytecode), 0, None, ctypes.byref(blob)) >= 0
    table = ctypes.cast(blob, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    pointer = ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)(table[3])(blob)
    size = ctypes.WINFUNCTYPE(ctypes.c_size_t, ctypes.c_void_p)(table[4])(blob)
    text = ctypes.string_at(pointer, size).rstrip(b'\0').decode()
    ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(table[2])(blob)
    return text


def interpret(lines, registers):
    """Independent vector opcode interpreter for the bounded decoder slices."""
    def operand(text):
        if text.startswith('l('):
            values = [float(x) for x in text[2:-1].split(',')]
            return values * 4 if len(values) == 1 else values
        sign = -1 if text.startswith('-') else 1
        text = text.lstrip('-')
        reg, mask = text.split('.')
        return [sign * registers[reg]['xyzw'.index(c)] for c in mask.ljust(4, mask[-1])]

    for line in lines:
        op, args = line.split(' ', 1)
        args = re.split(r',\s*(?![^()]*\))', args)
        dst = args.pop(0)
        values = [operand(arg) for arg in args]
        saturate = op.endswith('_sat')
        op = op.removesuffix('_sat')
        result = []
        for axis in range(4):
            v = [a[axis] for a in values]
            if op == 'mul': y = v[0] * v[1]
            elif op == 'add': y = v[0] + v[1]
            elif op == 'mad': y = v[0] * v[1] + v[2]
            elif op == 'round_ne': y = round(v[0])
            elif op == 'ftoi': y = int(v[0])
            elif op == 'imin': y = min(v)
            elif op == 'ieq': y = 0xffffffff if v[0] == v[1] else 0
            elif op == 'and':
                # Decoder's masked-float idiom: an all-ones mask retains bits.
                if v[1] in (0, 0xffffffff): y = v[0] if v[1] else 0
                elif v[0] in (0, 0xffffffff): y = v[1] if v[0] else 0
                else: y = int(v[0]) & int(v[1])
            elif op == 'movc': y = v[1] if v[0] else v[2]
            elif op == 'dp3': y = sum(values[0][a] * values[1][a] for a in range(3))
            else: raise AssertionError((op, line))
            result.append(max(0, min(1, y)) if saturate else y)
        reg, mask = dst.split('.')
        registers.setdefault(reg, [0.] * 4)
        for c in mask:
            axis = 'xyzw'.index(c)
            registers[reg][axis] = result[axis]
    return registers


def validation(assemblies):
    # These exact load instructions establish r2/r3/r4 = GBuffer0/1/2.
    point = assemblies['point-specular'].splitlines()
    combine = assemblies['combine-ibl'].splitlines()
    assert 'ld_indexable(texture2d)(float,float,float,float) r4.xyz, r1.xyww, t3.xyzw' in point
    assert 'ld_indexable(texture2d)(float,float,float,float) r4.xyzw, r1.xyww, t2.xyzw' in combine
    assert re.search(r'g_gbufferTexture2\s+texture\s+float4\s+2d\s+t3', '\n'.join(point))
    assert re.search(r'g_gbufferTexture2\s+texture\s+float4\s+2d\s+t2', '\n'.join(combine))
    point = [s.strip() for s in point]
    def section(lines, first, last):
        return lines[lines.index(first):lines.index(last) + 1]
    point_metal = section(point, 'mul r0.z, r2.w, l(3.000000)', 'movc r1.w, r0.w, l(0), r4.y')
    point_f0 = section(point, 'ieq r0.z, r0.z, l(2)', 'mul_sat r1.w, r1.w, l(50.000000)')
    combine_f0 = section(combine, 'mul r1.z, r2.w, l(3.000000)', 'mul_sat r2.z, r2.z, l(50.000000)')
    rng = random.Random(0xBF2)
    maximum = 0.
    cases = []
    for index in range(1000):
        material_id = index % 3
        color = [rng.random() for _ in range(3)]
        raw_metal, reflectance, raw_coat = [rng.random() for _ in range(3)]
        metal = 0 if material_id == 1 else raw_metal
        coat = raw_coat if material_id == 2 else 0
        dielectric = .16 * ((1 - coat) * reflectance) ** 2
        f0 = [dielectric + metal * (c - dielectric) for c in color]
        f90 = min(1, 50 * .33 * sum(f0))
        source = {'r2': [.5, .5, .7, material_id / 3], 'r3': color + [0],
                  'r4': [raw_coat, raw_metal, reflectance, .8]}
        p = interpret(point_metal, {r: v[:] for r, v in source.items()})
        assert p['r1'][3] == metal
        p = interpret(point_f0, p)
        c = interpret(combine_f0, {r: v[:] for r, v in source.items()})
        actual = [p['r3'][:3], c['r4'][:3], [p['r1'][3]], [c['r2'][2]]]
        expected = [f0, f0, [f90], [f90]]
        error = max(abs(a-b) for av,bv in zip(actual, expected) for a,b in zip(av,bv))
        maximum = max(maximum, error)
        if index < 3: cases.append({'materialId': material_id, 'baseColor': color,
                                  'metalness': metal, 'reflectance': reflectance,
                                  'coat': coat, 'f0': f0, 'f90': f90})
    assert maximum < 1e-12, maximum
    return {'cases': 1000, 'maximumAbsoluteError': maximum, 'examples': cases,
            'method': 'Two independent source instruction slices interpreted with vector swizzles; compared to compact formulas. Double precision algebra, not native float32 execution.'}


def main():
    data = SOURCE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert digest == '110d7169cb6f70559f8ecea0819e26b1df4fb66e0649f95bdeea033ef44ef898'
    OUT.mkdir(exist_ok=True)
    records, assemblies = [], {}
    for short, name in PROGRAMS.items():
        matches = list(re.finditer(re.escape(name.encode()) + b'\0', data))
        assert len(matches) == 1
        at = matches[0].end()
        length = struct.unpack_from('<I', data, at)[0]
        bytecode = data[at+4:at+4+length]
        assert bytecode[:4] == b'DXBC' and struct.unpack_from('<I', bytecode, 24)[0] == length
        assemblies[short] = assembly(bytecode)
        (OUT / (short+'.dxbc')).write_bytes(bytecode)
        (OUT / (short+'.asm')).write_text(assemblies[short])
        records.append({'file': short, 'sourceName': name, 'nameOffset': matches[0].start(),
                        'bytecodeOffset': at+4, 'bytecodeBytes': length,
                        'sha256': hashlib.sha256(bytecode).hexdigest()})
    producers = []
    for family, name in [('master1uv', '6d0dd89b35'), ('metalonly', '85476b5805')]:
        path = ROOT / ('exports/materials/' + family + '-shader/' + name)
        text = path.with_suffix('.asm').read_text()
        normalize = 'dp3 r2.w, r2.xyzx, r2.xyzx\nrsq r2.w, r2.w\nmul r2.xyz, r2.wwww, r2.xyzx'
        assert normalize in text
        assert text.index(normalize) < text.index('ld_indexable(buffer)')
        assert 'mov o0.w, l(0)' in text and 'mov o2.xz, l(0,0,0.500000,0)' in text
        producers.append({'family': family, 'shader': name,
                          'sha256': hashlib.sha256(path.with_suffix('.dxbc').read_bytes()).hexdigest(),
                          'normalRepresentation': 'Tangent-mapped world normal explicitly normalized before SH loads and evaluation.',
                          'prelighting': 'GBuffer3.rgb=max(SH+broadSpecular,0)*packedTextureAO*cb2[40].x',
                          'materialId': 0, 'reflectance': .5})
    report = {'evidenceId': 'BF2-NATIVE-GBUFFER-001',
              'sourceResource': str(SOURCE.relative_to(ROOT)).replace('\\', '/'),
              'sourceSha256': digest, 'consumers': records, 'validation': validation(assemblies),
              'producers': producers,
              'ordinaryMaterialId': 0,
              'equations': {'materialId': 'round(GBuffer0.w*3)', 'metalness': 'GBuffer2.y',
                            'reflectance': 'GBuffer2.z', 'diffuseColor': '(1-metalness)*GBuffer1.rgb',
                            'F0': 'mix(vec3(0.16*reflectance^2),GBuffer1.rgb,metalness)',
                            'F90': 'saturate(50*dot(F0,vec3(0.33)))',
                            'IBLResponse': 'F0*DFG.r+F90*DFG.g',
                            'indirectDiffuseBeforeExposureAndDynamicAO': 'GBuffer3.rgb*DFG.b*(1-metalness)*baseColor'},
              'limitations': ['Static source shaders; actual selected native frame/pass not captured.',
                              'Ordinary materialID0 only in browser helper; skin ID1 and coat ID2 differ.',
                              'GBuffer resource view/quantization and native radiance filtering are not emulated by this decoder.']}
    (OUT / 'manifest.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'evidenceId': report['evidenceId'], 'shaders': len(records), 'validation': report['validation']}, indent=2))


if __name__ == '__main__':
    main()
