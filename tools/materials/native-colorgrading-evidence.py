"""Hash-bound SDR grading baseline and native CPU PQ lookup reconstruction.

Reads the installed executable; calls only the Windows CRT powf math export.
Never loads or executes the game executable.
"""
import ctypes
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting/native-colorgrading'


def main():
    script = ROOT / 'tools/materials/native-dfg-pe.py'
    pe = {'__file__': str(script)}
    exec(script.read_text(encoding='utf-8').split('names =')[0], pe)
    data, base, to = pe['data'], pe['image_base'], pe['to_offset']
    digest = hashlib.sha256(data).hexdigest()
    assert digest == 'd350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4'
    f32 = lambda v: struct.unpack('<f', struct.pack('<f', v))[0]
    constants = []
    values = {}
    for address, name, expected in [
        (0x143411120, 'pqIndexScale', f32(1 / 1023)),
        (0x14341f178, 'inverseM2', f32(1 / 78.84375)),
        (0x14341f180, 'c1', .8359375),
        (0x14341f184, 'inverseM1', f32(1 / .1593017578125)),
        (0x14341f18c, 'c3', 18.6875),
        (0x14341f190, 'c2', 18.8515625),
        (0x14301af38, 'linearScale', 100.0),
    ]:
        offset = to(address - base)
        value = struct.unpack_from('<f', data, offset)[0]
        assert value == expected, name
        values[name] = value
        constants.append(dict(address=hex(address), name=name, value=value,
                              bytes=data[offset:offset + 4].hex()))
    assert struct.unpack_from('<4f', data, to(0x14301eea0 - base)) == (1, 1, 1, 1)
    # Original import table survives alongside the loader's relocated table.
    descriptor = to(0x144032a34 - base)
    original_first, _, _, dll_rva, first = struct.unpack_from('<5I', data, descriptor)
    name_offset = to(dll_rva)
    dll = data[name_offset:data.index(b'\0', name_offset)].decode()
    assert dll.lower() == 'api-ms-win-crt-math-l1-1-0.dll'
    thunk = to(0x141e73026 - base)
    assert data[thunk:thunk + 2] == b'\xff\x25'
    slot = 0x141e73026 + 6 + struct.unpack_from('<i', data, thunk + 2)[0]
    entry = (slot - base - first) // 8
    rva = struct.unpack_from('<Q', data, to(original_first) + entry * 8)[0]
    assert data[to(rva) + 2:to(rva) + 7] == b'powf\0'
    powf = ctypes.CDLL(dll).powf
    powf.argtypes = [ctypes.c_float, ctypes.c_float]
    powf.restype = ctypes.c_float
    # SSE MUL/SUB/DIV round separately in 141476d80; no fused operations.
    pixels = bytearray()
    for index in range(1024):
        p = powf(f32(index * values['pqIndexScale']), values['inverseM2'])
        numerator = max(f32(p - values['c1']), 0)
        denominator = f32(values['c2'] - f32(p * values['c3']))
        value = f32(powf(f32(numerator / denominator), values['inverseM1']) * 100)
        bits = struct.unpack('<I', struct.pack('<f', value))[0]
        absolute = bits & 0x7fffffff
        shift = min((0x71 - (absolute >> 23)) & 0xffffffff, 31)
        adjusted = (absolute - 0x38000000) & 0xffffffff
        mask = 0xffffffff if (absolute - 0x38800000) & 0x80000000 else 0
        mantissa = (((bits & 0x7fffff) | 0x800000) >> shift)
        word = ((((mantissa - adjusted) & mask) + adjusted) & 0xffffffff)
        half = ((word + 0xfff + ((word >> 13) & 1)) >> 13) | ((bits >> 16) & 0x8000)
        packed = struct.pack('<H', half & 0xffff)
        assert packed == struct.pack('<e', value), (index, value)
        pixels.extend(packed)
    sampler_address = 0x144099788
    sampler = list(struct.unpack_from('<11I', data, to(sampler_address - base)))
    assert sampler == [2, 2, 2, 2, 2, 2, 0, 16, 1, 0, 0]
    descriptions = {
        '142deadf0': 'GameRenderSettings defaults: SDR peak200, shoulder1, brightness1, RenderPlanesAutoDisable false.',
        '141488500': 'HDR grading forces RenderPlanes enabled; default AutoDisable does not disable them on SDR.',
        '1414872a0': 'SDR display-mapped neutral shoulder selects conversion1, post-grade [100/200,1].',
        '140f5b9a0': 'GlobalPostProcessSettings+10c quality passed to cube constructor.',
        '140f42080': 'HDR cube size33; quality1 requests native format27, otherwise18.',
        '140f41480': 'Create 3D cube, native format27 when supported, fallback18; input reference depends on HDR flag.',
        '140f40460': 'World view+3154 captured as cube output conversion.',
        '140f36170': 'Captured cube/view/settings/conversion copied into render task.',
        '14649fec0': 'Task reads world view+3158/+315c as post-grade exposures.',
        '140f6b130': 'Visual-environment LUT weights/textures, matrix/settings cache and cube rebuild.',
        '140f48190': 'Color-correction matrix from global and selected environment adjustments.',
        '140f61420': '400-byte cube constants, native gamma/brightness and exposure binding.',
        '140f47bf0': 'ColorCubeInterpolateCS permutation, original source textures and output UAV.',
        '141476d80': '1024-sample R16F PQ-to-linear CPU LUT generation and immutable upload.',
        '14147ac40': 'Default merge flags select PQ-to-linear lookup, no optional display cube.',
        '141480d70': 'SDR merge binds lookup t2, point main sampler and linear/clamp lookup sampler.',
        '141457130': 'Tonemap grading sampler getter returns global linear/clamp descriptor.',
        '141451cf0': 'Merge sampler constructor copies filter/address enums into all three axes.',
        '14147e120': 'Main render-plane descriptor selects native format27 for SDR HDR grading with render planes; display mode2 selects41.',
        '141486f30': 'Allocates the main descriptor through frame graph and stores its handle in RenderPlaneData+18.',
        '1409fcc60': 'Registers RenderPlaneData context type d3379ecd and global index14407aa44.',
        '1414673c0': 'Allocates the RenderPlaneData context and returns its data after the eight-byte header.',
        '141470ad0': 'Merge graph dependency copies RenderPlaneData+18 into its main texture handle at+8.',
        '141466310': 'Merge graph object constructor binds dependency builder and virtual execution table14341f0d0.',
        '141479d20': 'Merge graph execution thunk selects the object handles and enters141470030.',
        '141470030': 'Resolves main handle at+8 to sixth argument of141480d70, which binds it as pixel t0.',
        '1414776a0': 'Merge HDR flag requires GameRenderSettings HDR and RenderPlaneData main type2.',
    }
    functions = []
    for address, meaning in descriptions.items():
        path = ROOT / 'exports/lighting/native-postprocess-functions' / (address + '.c')
        body = path.read_bytes()
        assert b'/* Instructions:' in body
        functions.append(dict(address='0x' + address, meaning=meaning,
                              path=path.relative_to(ROOT).as_posix(), sha256=hashlib.sha256(body).hexdigest()))
    support = []
    for address in ['142deb960', '14158b6b0', '1415a41c0', '1415affc0', '1415ae210']:
        path = ROOT / 'exports/lighting/dfg-native-functions' / (address + '.c')
        support.append(dict(address='0x' + address, path=path.relative_to(ROOT).as_posix(),
                            sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    defaults = (ROOT / 'exports/lighting/dfg-native-functions/142deb960.c').read_text(encoding='utf-8')
    assert '*(undefined4 *)((longlong)param_1 + 0x10c) = 1;' in defaults
    formats = (ROOT / 'exports/lighting/dfg-native-functions/1415ae210.c').read_text(encoding='utf-8')
    for text in ['case 0x1b:\n      uVar4 = 0x18;', 'case 0x12:\n      uVar4 = 0x1c;', 'case 0x1e:\n      uVar4 = 0x36;']:
        assert text in formats
    # Bind the resource identity, virtual callback and allocation-to-consumer
    # chain independently of the similarly formatted optional rescale target.
    def native_string(address):
        offset = to(address - base)
        return data[offset:data.index(b'\0', offset)].decode('ascii')
    assert native_string(0x14341e490) == 'GameRenderer/MainTexture/FrameGraph'
    assert native_string(0x14323a3b8) == 'RenderPlaneData'
    assert struct.unpack_from('<Q', data, to(0x14341f0d0 + 0x10 - base))[0] == 0x141479d20
    for address, required in {
        '14147e120': ['+ 0x112)', '+ 0x10a)', 'uVar3 = 0x1b;', '+ 0x2678) == 2',
                      'uVar3 = 0x29;', '+ 0x24) = uVar3;', '&UNK_14341e490'],
        '141486f30': ['FUN_1414673c0(param_3)', 'FUN_14147e120(param_1,auStack_98)',
                      'FUN_14146a240(param_2 + 0x428,&uStackX_8,uVar2)', '(lVar1 + 0x18) = uStackX_8'],
        '141470ad0': ['FUN_1409fcc60()', '*(ulonglong *)(lVar16 + 0x18)', 'param_3[1] = uStackX_8'],
        '141466310': ['&UNK_14341f0d0', 'FUN_141470ad0(param_4,param_2)'],
        '141479d20': ['JMP 0x141470030'],
        '141470030': ['param_2[5]', 'lVar1 = *(longlong *)(lVar2 + 0xa8)',
                      '*(undefined8 *)(lVar3 + 0x26d0),lVar2,lVar1,lVar4'],
    }.items():
        body = (ROOT / 'exports/lighting/native-postprocess-functions' / (address + '.c')).read_text(encoding='utf-8')
        for fragment in required:
            assert fragment in body, (address, fragment)
    OUT.mkdir(exist_ok=True)
    (OUT / 'pq-to-linear.r16f.bin').write_bytes(pixels)
    report = dict(evidenceId='BF2-NATIVE-COLORGRADING-BASELINE-001', sourceExecutableSha256=digest,
        constants=constants, functions=functions, supportFunctions=support,
        pqLookup=dict(file='pq-to-linear.r16f.bin', width=1024, format='R16_FLOAT', bytes=len(pixels),
            sha256=hashlib.sha256(pixels).hexdigest(), importDll=dll, importName='powf',
            importDescriptor='0x144032a34', thunk='0x141e73026', nativeGenerator='0x141476d80',
            halfConversion='Original integer round-to-nearest ties-even; all1024 agree with IEEE binary16 packing.'),
        gradingSampler=dict(address=hex(sampler_address), words=sampler, filter='LINEAR', addressUVW='CLAMP'),
        nativeCube=dict(size=33, format='R10G10B10A2_UNORM', nativeFormat=27, dxgiFormat=24,
            quality=1, unsupportedFallback='R8G8B8A8_UNORM', sourceTextureYFlip=True),
        nativeRenderPlane=dict(format='R10G10B10A2_UNORM', nativeFormat=27, dxgiFormat=24,
            resourceName='GameRenderer/MainTexture/FrameGraph', context='RenderPlaneData', handleOffset='0x18',
            descriptor='0x14147e120', allocator='0x141486f30', descriptorFormatOffset='0x24',
            consumerChain=['0x141470ad0', '0x141466310', '0x141479d20', '0x141470030', '0x141480d70'],
            mergeTextureSlot=0, displayMode=0, hdrGrading=True, renderPlanes=True,
            rounding='Clamp UNORM then round-to-nearest ties-even at RGB10/A2 precision before SDR merge.',
            excluded='Display mode2 selects native format41; HDR-disabled or render-planes-disabled paths use display format.'),
        baseline=dict(display='SDR', hdrGrading=True, displayMapping=True, renderPlanes=True,
            shoulder=1, outputConversion=1, postGradeExposure=[.5, 1], matrix='identity',
            gamma=[1, 1, 1], curb=0, userBrightness=[1, 1, f32(.05), 1], sourceCount=1),
        limitations=['Static original code and installed defaults, not a captured native frame.',
            'Per-view bulk copy from source+1024/+1028/+102c to world+3154/+3158/+315c remains untraced.',
            'Active local environment blending and user overrides are not captured.',
            'Bloom composition and local environment changes remain separate work; authored global vignette has separate BF2-NATIVE-VIGNETTE-001 evidence.',
            'PQ lookup reconstructs native float operations using the same named Windows CRT API on this machine.'])
    (OUT / 'evidence.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(dict(functions=len(functions), pqLookup=report['pqLookup'], nativeCube=report['nativeCube'])))


if __name__ == '__main__':
    main()
