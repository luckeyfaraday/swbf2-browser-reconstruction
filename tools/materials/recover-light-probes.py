"""Decode the installed map's paired Enlighten RES files, with bounded assertions.

No extraction or installation modification is performed. Run from any directory.
The two input RES files are logical decompressed resources from bf2-extract raw.
"""
import hashlib
import json
import pathlib
import struct
import uuid

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting'
PUBLIC = ROOT / 'web/public/assets'
EVIDENCE = 'BF2-NATIVE-PROBES-001'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    static_path = OUT / 'raw/2761799507903659695.res'
    dynamic_path = OUT / 'raw-dynamic/8785653264462149711.res'
    static = static_path.read_bytes()
    dynamic = dynamic_path.read_bytes()
    assert len(static) == 4267048 and len(dynamic) == 1725376
    assert static[:8] == dynamic[:8] == struct.pack('<II', 5232, 4908)
    count, coefficient_offset = struct.unpack_from('<II', static, 8)
    payload_end = struct.unpack_from('<Q', static, 24)[0]
    assert coefficient_offset == 32 and count == 29632
    assert payload_end == coefficient_offset + count * 144 == len(static) - 8
    assert struct.unpack_from('<2I', static, payload_end) == (12, 24)
    coefficients = np.frombuffer(static, dtype='<f4', count=count*36, offset=32).reshape(count, 9, 4)
    assert np.isfinite(coefficients).all()
    assert (coefficients[:, 4:, 3] == 0).all()
    assert coefficients[:, 0, 3].min() >= 0 and coefficients[:, 0, 3].max() <= 1

    # Header sections independently meet at their exact declared pointers.
    instance_count = struct.unpack_from('<I', dynamic, 40)[0]
    instance_offset, atlas_offset = struct.unpack_from('<2Q', dynamic, 48)
    volume_count = struct.unpack_from('<I', dynamic, 76)[0]
    volume_offset = struct.unpack_from('<Q', dynamic, 80)[0]
    assert instance_offset + instance_count * 32 == atlas_offset
    assert atlas_offset + instance_count * 32 == volume_offset
    assert instance_count == 17703 and volume_count == 194
    position_start = volume_offset + volume_count * 240

    # Independent typed EBX corroboration: exact matrix, grid resolution and priority.
    ebx_volumes = []
    for path in (ROOT / 'exports/map-initial').glob('*/ebx/*.json'):
        text = path.read_text(encoding='utf-8-sig')
        if '"$type":"FrostySdk.Ebx.LightProbeVolumeData"' not in text:
            continue
        doc = json.loads(text)
        for obj in doc['asset']['objects']:
            if obj.get('$type') != 'FrostySdk.Ebx.LightProbeVolumeData':
                continue
            tr = obj['Transform']
            matrix = [tr[row][axis] for row in ('right','up','forward','trans') for axis in ('x','y','z')]
            ebx_volumes.append((matrix, [obj['Xres'],obj['Yres'],obj['Zres']], obj, str(path.relative_to(ROOT))))

    volumes = []
    next_probe = 0
    maximum_grid_error = 0
    ebx_matches = 0
    for index in range(volume_count):
        offset = volume_offset + index * 240
        matrix = list(struct.unpack_from('<16f', dynamic, offset+16))
        inverse = list(struct.unpack_from('<16f', dynamic, offset+80))
        dims = list(struct.unpack_from('<3I', dynamic, offset+180))
        priority, size, start, flags = struct.unpack_from('<4I', dynamic, offset+192)
        pointer = struct.unpack_from('<Q', dynamic, offset+208)[0]
        assert size == int(np.prod(dims)) and start == next_probe
        assert pointer == position_start + start*16
        points = np.frombuffer(dynamic, dtype='<f4', offset=pointer, count=size*4).reshape(size,4)
        assert np.isfinite(points).all() and (points[:,3] == 0).all()
        regular = flags == 0xffff0000
        assert regular or flags == 0xffff0001
        grid_error = None
        if regular:
            indices = np.arange(size)
            cells = np.column_stack((indices%dims[0], (indices//dims[0])%dims[1], indices//(dims[0]*dims[1])))
            matrix_np = np.array(matrix).reshape(4,4).T
            predicted = ((cells+.5)/np.array(dims)-.5) @ matrix_np[:3,:3].T + matrix_np[:3,3]
            grid_error = float(np.max(np.abs(predicted-points[:,:3])))
            assert grid_error < .0015
            maximum_grid_error = max(maximum_grid_error, grid_error)
            # Stored matrix rows have a padding zero in place of homogeneous W.
            forward4 = matrix_np.copy(); forward4[3,3] = 1
            inverse4 = np.array(inverse).reshape(4,4).T; inverse4[3,3] = 1
            assert np.max(np.abs(inverse4@forward4-np.eye(4))) < .0005
        matches=[]
        flat = [matrix[j] for j in range(16) if j%4 != 3]
        for ebx_matrix, ebx_dims, obj, source in ebx_volumes:
            if dims == ebx_dims and np.max(np.abs(np.array(flat)-ebx_matrix)) < .0001:
                assert priority == obj['Priority']+1
                matches.append({'file':source,'objectId':obj['$id'],'priority':obj['Priority'],'blendDistance':obj['BlendDistance']})
        ebx_matches += bool(matches)
        volumes.append({
            'index':index,'guid':str(uuid.UUID(bytes_le=dynamic[offset:offset+16])),
            'recordOffset':offset,'matrix':matrix,'inverse':inverse,'resolution':dims,
            'priorityEncoded':priority,'priority':priority-1,'probeStart':start,'probeCount':size,
            'regular':regular,'blendDistance':struct.unpack_from('<f',dynamic,offset+176)[0],
            'positionOffset':pointer,'positionBounds':{'min':points[:,:3].min(axis=0).tolist(),'max':points[:,:3].max(axis=0).tolist()},
            'localBounds':{'min':list(struct.unpack_from('<3f',dynamic,offset+144)),'max':list(struct.unpack_from('<3f',dynamic,offset+160))},
            'gridPositionMaximumErrorMeters':grid_error,'ebxMatches':matches,
            **({'positions':points[:,:3].tolist()} if not regular else {}),
        })
        next_probe += size
    assert next_probe == count and position_start + count*16 == 1653776
    assert sum(v['probeCount'] for v in volumes if not v['regular']) == 14
    assert ebx_matches >= 40
    # Retain every native float, including the first four sky-visibility channels.
    binary = static[32:payload_end]
    PUBLIC.mkdir(exist_ok=True)
    (PUBLIC/'source-probes.bin').write_bytes(binary)
    limitations = [
        'Storage layout, positions and volume metadata are validated against paired source resources and typed EBX; native execution was not observed.',
        'Using stored nine float4 values directly in the recovered GPU polynomial is strongly supported by layout and sky-visibility channels, but CPU-to-GPU packing was not decompiled.',
        'Highest priority then smallest volume, trilinear sampling, mesh-bounds center selection and equal-priority handling are browser reconstruction policies; native selection/blending is not recovered.',
        'Seven irregular probe sets are preserved but not selected by the browser sampler; 187 regular volumes remain available.',
        'Native exposure, indirect specular, sky contribution, lightmap atlas and dynamic Enlighten updates remain separate work.',
    ]
    report={'evidenceId':EVIDENCE,'source':{'staticResourceId':'2761799507903659695','dynamicResourceId':'8785653264462149711','staticSha256':sha(static),'dynamicSha256':sha(dynamic),'profileHead':1930263},
        'format':{'componentsPerProbe':36,'coefficientCount':9,'channelsPerCoefficient':4,'encoding':'little-endian-float32','basis':['1','x','y','z','3*y*y-1','x*y','y*z','x*z','x*x-z*z'],'colorUnits':'unscaled native values; exposure not baked by exporter'},
        'coefficientUrl':'/assets/source-probes.bin','coefficientSha256':sha(binary),'probeCount':count,'volumes':volumes,'limitations':limitations}
    (PUBLIC/'source-probes.json').write_text(json.dumps(report,separators=(',',':')),encoding='utf-8')
    evidence={'evidenceId':EVIDENCE,'staticResource':str(static_path.relative_to(ROOT)),'dynamicResource':str(dynamic_path.relative_to(ROOT)),**report['source'],
        'checks':{'coefficientPayloadBytes':len(binary),'finiteFloatCount':count*36,'volumeCount':volume_count,'regularVolumes':sum(v['regular'] for v in volumes),'irregularProbeCount':14,'probeCountSum':next_probe,'contiguousPositionPointers':True,'exactEbxVolumeMatches':ebx_matches,'maximumRegularGridErrorMeters':maximum_grid_error,'trailingBandAlphaAllZero':True,'skyConstantRange':[float(coefficients[:,0,3].min()),float(coefficients[:,0,3].max())]},
        'shaderBasisEvidence':{'path':'exports/materials/floor-shader/13ddb144d2.asm','lineStart':67,'lineEnd':95,'note':'The normal is unnormalized in native floor prelighting. Generic browser path evaluates a unit world normal.'},'limitations':limitations}
    (OUT/'probe-recovery.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    print(json.dumps(evidence['checks'],indent=2))


if __name__ == '__main__':
    main()
