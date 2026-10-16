"""Independent BRDF integral versus original DXBC executed by D3D11 WARP."""
import hashlib
import json
import pathlib
import struct
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT/'exports/lighting/dfg-generator'
F = np.float32


def exact_float(bits):
    return struct.unpack('<f', struct.pack('<I', bits))[0]


def shader_chunk(path, tag):
    data = path.read_bytes()
    for index in range(struct.unpack_from('<I', data, 28)[0]):
        offset = struct.unpack_from('<I', data, 32+index*4)[0]
        if data[offset:offset+4] == tag:
            size = struct.unpack_from('<I', data, offset+4)[0]
            return data[offset+8:offset+8+size]
    raise ValueError(tag)


def source_integral(ndv, alpha):
    """Algebraic GGX visibility + Frostbite diffuse, independently vectorized.

    Original shader uses 4096 samples, this exact integer hash, these Hammersley
    rotations and binary32 constants. Accumulation is sequential float32.
    """
    ndv, alpha = F(ndv), F(alpha)
    vx = np.sqrt(F(1)-ndv*ndv)
    seed = int(F(F(vx*F(.5)+F(.5))*F(4294967296)))
    seed = ((seed ^ 0xa3c59ac3)*0x9e3779b9) & 0xffffffff
    seed = ((seed ^ (seed >> 16))*0x9e3779b9) & 0xffffffff
    seed = ((seed ^ (seed >> 16))*0x9e3779b9) & 0xffffffff
    rotation = F(seed)*F(exact_float(0x2f800000))
    samples = np.arange(4096, dtype=np.uint32)
    reverse = np.zeros(4096, dtype=np.uint32)
    for bit in range(12):
        reverse |= ((samples >> bit) & 1) << (11-bit)
    u = np.mod(samples.astype(np.float32)*F(1/4096)+rotation, F(1))
    v = np.mod(reverse.astype(np.float32)*F(1/4096)+F(exact_float(0x3efe7c95)), F(1))
    a2 = alpha*alpha
    h_z = np.sqrt((F(1)-u)/(F(1)+(a2-F(1))*u))
    h_xy = np.sqrt(np.maximum(F(0), F(1)-h_z*h_z))
    phi = v*F(exact_float(0x40c90fdb))
    h_x, h_y = h_xy*np.cos(phi), -h_xy*np.sin(phi)
    vdh_raw = vx*h_x+ndv*h_z
    l_x, l_y, l_z = F(2)*vdh_raw*h_x-vx, F(2)*vdh_raw*h_y, F(2)*vdh_raw*h_z-ndv
    ndl = np.clip(l_z/np.sqrt(l_x*l_x+l_y*l_y+l_z*l_z), F(0), F(1))
    vdh, ndh = np.clip(vdh_raw, F(0), F(1)), np.minimum(h_z, F(1))
    denominator = ndl*np.sqrt(a2+(F(1)-a2)*ndv*ndv)+ndv*np.sqrt(a2+(F(1)-a2)*ndl*ndl)
    visibility = np.where((ndh > 0) & (vdh > 0) & (ndl > 0),
        F(2)*ndv*ndl/denominator*vdh/(ndv*ndh), F(0))
    one_minus = F(1)-vdh
    fresnel = (one_minus*one_minus)*(one_minus*one_minus)*one_minus
    spec_scale, spec_bias = (F(1)-fresnel)*visibility, fresnel*visibility

    u, v = np.mod(u+F(.5), F(1)), np.mod(v+F(.5), F(1))
    radius, phi = np.sqrt(u), v*F(exact_float(0x40c90fdb))
    l_x, l_y, l_z = radius*np.cos(phi), -radius*np.sin(phi), np.sqrt(F(1)-u)
    inverse_length = F(1)/np.sqrt(l_x*l_x+l_y*l_y+l_z*l_z)
    l_x, l_z = l_x*inverse_length, l_z*inverse_length
    ldh2 = F(.5)*(F(1)+vx*l_x+ndv*l_z)
    roughness = np.sqrt(alpha)
    fd90 = roughness*(F(.5)+F(2)*ldh2)
    no_l = F(1)-l_z
    scatter_l = F(1)+(fd90-F(1))*(no_l*no_l)*(no_l*no_l)*no_l
    no_v = F(1)-ndv
    scatter_v = F(1)+(fd90-F(1))*(no_v*no_v)*(no_v*no_v)*no_v
    diffuse = scatter_l*scatter_v*(F(1)+F(exact_float(0xbeaced5a))*roughness)
    return np.array([np.cumsum(value, dtype=np.float32)[-1]/F(4096)
                     for value in (spec_scale, spec_bias, diffuse)], dtype=np.float32)


if __name__ == '__main__':
    raw = (OUT/'native-fg-128.rgba16f.bin').read_bytes()
    run = json.loads((OUT/'warp-execution.json').read_text())
    assert hashlib.sha256(raw).hexdigest() == run['sha256']
    assert len(raw) == 128*128*8
    pixels = np.frombuffer(raw, dtype='<f2').astype(np.float32).reshape(128,128,4)
    assert np.isfinite(pixels).all() and (pixels[:,:,3] == 0).all()
    assert (pixels[:,:,:3] >= 0).all() and (pixels[:,:,:3] <= 1.1).all()
    dx_matches = {}
    for stage in ('vs_5_0', 'ps_5_0'):
        # Compiler metadata/checksums differ; instructions are independent copies.
        left = shader_chunk(OUT/('dx11-'+stage+'.dxbc'), b'SHEX')
        right = shader_chunk(OUT/('dx12-'+stage+'.dxbc'), b'SHEX')
        dx_matches[stage] = left == right
        assert left == right
    checks = []
    for y in (0,1,8,32,64,96,120,126,127):
        for x in (0,1,8,32,64,96,120,126,127):
            expected = source_integral((x+.5)/128, (y+.5)/128)
            observed = pixels[y,x,:3]
            delta = np.abs(expected-observed)
            checks.append({'pixel':[x,y], 'uv':[(x+.5)/128,(y+.5)/128],
                           'independentIntegral':expected.tolist(), 'nativeWarp':observed.tolist(),
                           'maxError':float(delta.max())})
    report = {'evidenceId':'BF2-NATIVE-FG-VALIDATION-001', 'sha256':run['sha256'],
              'dx11Dx12InstructionStreamsIdentical':dx_matches,
              'pixelCount':16384, 'integrationSamplesPerPixel':4096,
              'channelMinimum':pixels.min((0,1)).tolist(), 'channelMaximum':pixels.max((0,1)).tolist(),
              'independentChecks':checks, 'maximumError':max(row['maxError'] for row in checks),
              'limitations':['Integral algebra evaluated independently in NumPy float32; GPU/WARP fused MAD, transcendental approximations and half-float rounding can differ.',
                             'Original shader executable output is retained; this independent model does not replace those pixels.']}
    (OUT/'validation.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({k:v for k,v in report.items() if k not in ('independentChecks','limitations')}, indent=2))
    assert report['maximumError'] < .001, report['maximumError']
