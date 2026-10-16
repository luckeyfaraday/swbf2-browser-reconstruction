"""Bind the native GaussianSimple bloom chain to executable, EBX and shader bytes.

Reads the installed executable and extracted exports only; the game is never
loaded or executed. The only native code called is the Windows CRT powf export
that the original weight generator imports (same binding as the PQ lookup).
"""
import os
import ctypes
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
EXE = Path(os.environ.get('BF2_GAME_DIR', 'C:/Games/Star Wars - Battlefront 2'), 'starwarsbattlefrontii.exe')
OUT = ROOT / 'exports/lighting/native-bloom'
data = EXE.read_bytes()
pe = struct.unpack_from('<I', data, 0x3c)[0]
count = struct.unpack_from('<H', data, pe + 6)[0]
optional = pe + 24
optional_size = struct.unpack_from('<H', data, pe + 20)[0]
base = struct.unpack_from('<Q', data, optional + 24)[0]
sections = []
for i in range(count):
    at = optional + optional_size + 40 * i
    virtual_size, rva, size, offset = struct.unpack_from('<IIII', data, at + 8)
    sections.append((rva, size, offset))


def to(address):
    rva = address - base
    for start, size, offset in sections:
        if start <= rva < start + size:
            return offset + rva - start
    raise ValueError(hex(address))


def cstr(address):
    o = to(address)
    return data[o:data.index(b'\0', o)].decode('latin1')


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    exe_sha = hashlib.sha256(data).hexdigest()
    # Frame-graph pass and resource names used by the GaussianSimple builder.
    strings = {0x14343d740: 'UpsamplePyramid', 0x14343d768: 'GaussianBloom',
               0x14343d790: 'DirectionalDownsample', 0x14343d7a8: 'DirectionalBlur',
               0x14343dbd8: 'Texture2dBlend', 0x143300208: 'BloomBlackboardData',
               0x143440a20: 'drawTwoTexture2dBlend', 0x143411dc8: 'Gaussian Pyramid',
               0x143410d48: 'ShaderProgram_GaussianPyramidCs'}
    for address, expected in strings.items():
        assert cstr(address) == expected, (hex(address), cstr(address))
    # GaussianBloom pass vtable: execute slot then class-name bytes.
    vtable = struct.unpack_from('<3Q', data, to(0x14343d750))
    assert vtable[2] == 0x141568bb0 and data[to(0x14343d768):to(0x14343d768) + 14] == b'GaussianBloom\0'
    # 141561810 GaussianSimple weight constants (float32 bit patterns).
    constants = {0x14301a310: ('two', 2.0), 0x143012f68: ('one', 1.0), 0x14301a308: ('minimumSpread', f32(0.01)),
                 0x143032f58: ('sampleStep', f32(0.1)), 0x14302cd24: ('exponentScale', 20.0), 0x1430d8490: ('normalizeEpsilon', 0.0)}
    bound = []
    for address, (name, expected) in constants.items():
        value = struct.unpack_from('<f', data, to(address))[0]
        assert value == expected, name
        bound.append({'address': hex(address), 'name': name, 'value': value, 'bytes': data[to(address):to(address) + 4].hex()})
    # powf import thunk shared with the PQ lookup witness (original import descriptor).
    descriptor = to(0x144032a34)
    original_first, _, _, dll_rva, first = struct.unpack_from('<5I', data, descriptor)
    dll = data[to(base + dll_rva):data.index(b'\0', to(base + dll_rva))].decode()
    assert dll.lower() == 'api-ms-win-crt-math-l1-1-0.dll'
    thunk = to(0x141e73026)
    assert data[thunk:thunk + 2] == b'\xff\x25'
    slot = 0x141e73026 + 6 + struct.unpack_from('<i', data, thunk + 2)[0]
    entry = (slot - base - first) // 8
    name_rva = struct.unpack_from('<Q', data, to(base + original_first) + entry * 8)[0]
    assert data[to(base + name_rva) + 2:to(base + name_rva) + 7] == b'powf\0'
    powf = ctypes.CDLL(dll).powf
    powf.argtypes = [ctypes.c_float, ctypes.c_float]
    powf.restype = ctypes.c_float
    # PostProcess settings constructor 142deb960: packed byte-flag defaults.
    flag_writes = {0x214: 0x1000001, 0x218: 0x1000100, 0x21c: 0x1000101}
    for address, (field, value) in zip((0x142debe11, 0x142debe1b, 0x142debe25), flag_writes.items()):
        # MOV dword ptr [RBX + field], value (RBX holds the constructed object).
        encoded = b'\xc7\x83' + struct.pack('<I', field) + struct.pack('<I', value)
        assert data[to(address):to(address) + 10] == encoded, hex(field)
    flags = {}
    for field, value in flag_writes.items():
        for byte in range(4):
            flags[field + byte] = (value >> (8 * byte)) & 0xff
    settings = {'BlurEnable': flags[0x214], 'QuarterDownsamplingEnable': flags[0x215], 'BlurBlendEnable': flags[0x216],
                'BloomEnable': flags[0x217], 'BloomTestEnable': flags[0x218], 'BlurPyramidEnable': flags[0x219],
                'BlurPyramidQuarterResEnable': flags[0x21a], 'BlurPyramidHdrEnable': flags[0x21b],
                'BlurPyramidFastHdrEnable': flags[0x21c], 'BlurPyramidSinglePassEnable': flags[0x21d]}
    assert settings['BloomEnable'] == 1 and settings['BlurPyramidEnable'] == 1 and settings['QuarterDownsamplingEnable'] == 0
    assert settings['BlurPyramidHdrEnable'] == 1 and settings['BlurPyramidFastHdrEnable'] == 1
    # Field descriptors give the offsets used above.
    descriptors = {}
    for address, name, offset in [(0x144df1fe8, 'BloomEnable', 0x217), (0x144df2000, 'BloomTestEnable', 0x218),
                                  (0x144df2018, 'BlurPyramidEnable', 0x219), (0x144df2060, 'BlurPyramidHdrEnable', 0x21b),
                                  (0x144df2078, 'BlurPyramidFastHdrEnable', 0x21c)]:
        name_address, _, field_offset = struct.unpack_from('<QHH', data, to(address))
        assert cstr(name_address) == name and field_offset == offset, name
        descriptors[name] = hex(offset)
    # Selected interior TonemapComponentData (serialized EBX, all fields).
    interior = ROOT / 'exports/map-initial/spatial-extra/ebx/Levels_Lighting_DeathStar_02_VE_DeathStar_02_Interior_01__5944175c-c90c-11e6-bf1d-a6092bb9b8be.json'
    gamewide = ROOT / 'exports/map-initial/spatial-extra/ebx/Levels_Lighting_Global_VE_Gamewide_01__4a4965f8-52e3-11e4-a6bc-af304338998d.json'

    def tonemap(path):
        found = []

        def walk(node):
            if isinstance(node, dict):
                if node.get('$type') == 'FrostySdk.Ebx.TonemapComponentData':
                    found.append(node)
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)
        walk(json.loads(path.read_text(encoding='utf-8')))
        assert len(found) == 1
        return found[0]
    selected = tonemap(interior)
    assert selected['BloomMethod']['name'] == 'BloomMethod_GaussianSimple' and selected['BloomMethod']['value'] == 0
    assert selected['BloomDirection']['value'] == 0 and selected['BloomSoftClip'] == 0
    assert selected['GaussianSharpness'] == 0.5
    scale = [selected['BloomScale'][axis] for axis in 'xyz']
    assert scale == [0.075, 0.11, 0.115]
    ebx = {'interior': {'path': interior.relative_to(ROOT).as_posix(), 'sha256': sha(interior), 'id': selected['$id'],
                        'BloomMethod': selected['BloomMethod']['name'], 'BloomDirection': selected['BloomDirection']['name'],
                        'BloomSoftClip': selected['BloomSoftClip'], 'DirectionalBloomClamp': selected['DirectionalBloomClamp'],
                        'GaussianSharpness': selected['GaussianSharpness'], 'BloomScale': scale},
           'gamewide': {'path': gamewide.relative_to(ROOT).as_posix(), 'sha256': sha(gamewide)}}
    gamewide_tonemap = tonemap(gamewide)
    assert gamewide_tonemap['BloomMethod']['value'] == 0 and gamewide_tonemap['GaussianSharpness'] == 0.5

    # 141561810 GaussianSimple weights, separately rounded float32 operations.
    def weights(levels, sharpness):
        n = f32(levels)
        step = f32(1.0 / n)
        denominator = powf(2.0, n)
        inverse = f32(1.0 / denominator)
        spread = f32(1.0 - f32(sharpness))
        if spread <= f32(0.01):
            spread = f32(0.01)
        out, total = [], f32(0.0)
        for level in range(levels):
            low = f32(powf(2.0, f32(f32(f32(level) * step) * n)) * inverse)
            high = f32(powf(2.0, f32(f32(f32(level + 1) * step) * n)) * inverse)
            accumulated = f32(0.0)
            for sample in range(10):
                t = f32(f32(f32(f32(sample) * f32(high - low)) * f32(0.1)) + low)
                falloff = powf(f32(1.0 - t), 2.0)
                shaped = powf(f32(spread * 2.0), f32(t * 20.0))
                accumulated = f32(accumulated + f32(f32(falloff * shaped) * f32(0.1)))
            total = f32(total + accumulated)
            out.append(accumulated)
        if total > 0:
            normalize = f32(1.0 / total)
            out = [f32(normalize * value) for value in out]
        return out + [0.0] * (15 - levels)
    tables = {f'{sharpness}': {str(levels): weights(levels, sharpness) for levels in range(1, 16)}
              for sharpness in (0.5, 0.25, 0.9)}
    shaders = json.loads((ROOT / 'exports/lighting/native-bloom-shaders/manifest.json').read_text(encoding='utf-8'))
    report = {
        'evidenceId': 'BF2-NATIVE-BLOOM-001',
        'sourceExecutableSha256': exe_sha,
        'strings': {hex(k): v for k, v in strings.items()},
        'functions': {
            'environmentBloomFill': {'address': '0x140d984b0', 'callsite': '0x140d99bf8', 'observed': 'BloomBlackboardData method=view+0x5c8 (clamped <=2), direction=+0x5bc, clamp=+0x5c0, softClip=+0x5c4, scale=ForceBloomScale when forced else tonemap BloomScale (+0x4e0), enable=BloomEnable && |scale|^2>0, Gaussian path also requires BlurPyramidEnable, source=current scene colour handle.'},
            'bloomBlackboardConstructor': {'address': '0x140d67c80', 'observed': 'source/output handles invalid, level vector, colour (1,1,1,1), +0xd4 65535.0.'},
            'postprocessOrchestrator': {'address': '0x1415669d0', 'observed': 'Bloom stage 14155cad0 follows CalculateExposure 14155ac40; tonemap consumes the bloom output.'},
            'bloomSelector': {'address': '0x14155a9a0', 'observed': 'direction 0 -> Gaussian 14155d910; 1,2 -> directional 14155d2c0; other -> disabled.'},
            'pyramidDescription': {'address': '0x141569670', 'observed': 'levels = (W>>1,H>>1) halved to 1x1; L = min(levelCount, floor(log2(H))-1, 15); format 0x12 LDR, 0x28 HDR, 0x1a FastHDR; QuarterDownsamplingEnable skips level 0; method 0 -> 141561810(L,GaussianSharpness), 1 -> 141560f60(Gaussian1..5 colour/weight).'},
            'gaussianSimpleWeights': {'address': '0x141561810', 'observed': 'w_i = 0.1*sum_k powf(1-t_k,2)*powf(2*max(1-sharpness,0.01),20*t_k), t_k = a+k*(b-a)*0.1, a=2^i/2^L, b=2^(i+1)/2^L; normalized; levels >= L zero.'},
            'gaussianUpsample': {'address': '0x14155d910', 'observed': 'Smallest level Texture2dBlend: up[L-1]=w[L-1]*mip(L); others GaussianBloom: up[i]=w[i]*mip(i+1)+up[i+1]; output up[start].'},
            'gaussianBloomExecute': {'address': '0x1415563a0', 'observed': 'drawTwoTexture2dBlend(pyramid mip level+1 * (w,1), previous upsample mip0 * (1,1,1,1)), linear/clamp samplers.'},
            'twoTextureBlend': {'address': '0x14158c070', 'observed': 'Tex2dDouble: mainTexture*color + mainTexture2*color2.'},
            'pyramidDispatch': {'address': '0x141444a40', 'observed': 'GaussianPyramidCs: dst = src>>1 per mip, 8x8 groups; separable TwoPass fallback 14143a750 by device type.'},
            'formatMapping': {'address': '0x1415ae210', 'observed': 'native 0x1a -> DXGI 26 R11G11B10_FLOAT, 0x28 -> DXGI 10 R16G16B16A16_FLOAT, 0x12 -> DXGI 28 R8G8B8A8_UNORM.'},
        },
        'constants': bound,
        'powf': {'dll': dll, 'thunk': '0x141e73026', 'importDescriptor': '0x144032a34'},
        'postprocessSettingsDefaults': {'constructor': '0x142deb960', 'descriptors': descriptors, 'values': settings,
                                        'derived': {'upsampleFormat': 'R11G11B10_FLOAT', 'startLevel': 0}},
        'ebx': ebx,
        'tonemapCombine': {'shader': 'native-bloom-shaders/tonemap-bloom-hardclip', 'observed': 'color = main + bloomScale*bloom (bilinear tonemapBloomTexture at tonemap UV), then colorScale (exposure) and vignette, PQ, cube. BloomSoftClip 0 selects bloomSoftClipping=0.'},
        'pyramidKernel': {'shader': 'native-bloom-shaders/gaussian-pyramid-*', 'observed': 'Separable discrete Gaussian, sigma 2 source texels (exp2(-d^2*0.180337)), 12 taps per axis, centred at (dst+0.5)*srcSize/dstSize; aligned variant uses 6 bilinear horizontal taps with identical weights.'},
        'weightTables': tables,
        'shaders': [{'file': row['file'], 'sha256': row['sha256']} for row in shaders['stages']],
        'inferred': [
            'The scene-colour mips sampled by the upsample chain are produced by the blur-pyramid GaussianPyramidCs pass; the producer pass ordering relative to transparency is not traced. The browser builds them from the composited HDR scene used for metering.',
            'tonemapBloomTexture sampler is taken as bilinear/clamp like the other postprocess samplers; its descriptor is not traced.',
            'Scene-colour mip storage format is not traced; the browser stores mips in half float. The upsample chain emulates R11G11B10_FLOAT rounding.',
            'Robust-edge GaussianPyramidCs permutation selection is not decoded; the browser clamps taps to the image edge.'],
        'limitations': ['No native frame capture; parity is per-pass against unchanged bytecode on WARP.', 'Directional bloom (BloomDirection 1/2) and FFT bloom are not reconstructed; this map selects neither.'],
    }
    (OUT / 'evidence.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'levels8': tables['0.5']['8'][:8], 'settings': settings}, indent=1))


if __name__ == '__main__':
    main()
