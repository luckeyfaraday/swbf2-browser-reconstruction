"""Validate retained map atlas associations and tables without executing the game.

This emits evidence only. Companion scripts recover native instance hashes,
original radiosity UVs, shader bindings, sampler state and bake pre-exposure.
"""
import os
import hashlib
import json
import pathlib
import struct
import uuid

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting'
EVIDENCE = 'BF2-NATIVE-STATIC-ATLAS-001'
FIELDS = (
    'StaticIrradianceTexture', 'StaticDirectionTexture',
    'StaticDirectionTextureG', 'StaticDirectionTextureB',
    'StaticSkyVisibilityTexture',
)
# Pinned StarWarsIISDK.dll RenderFormat enum, queried using System.Enum.GetName.
# Its SHA-256 is independently pinned by tools/bf2-extract/Historical.cs.
FORMATS = {64: 'BC6U_FLOAT', 66: 'BC7_UNORM'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def model_lightmap_field():
    """Read only PE headers and the exact retained metadata witness addresses."""
    path = pathlib.Path(os.environ.get('BF2_GAME_DIR', 'C:/Games/Star Wars - Battlefront 2'), 'starwarsbattlefrontii.exe')
    with path.open('rb') as stream:
        def read_at(offset, size):
            stream.seek(offset)
            data = stream.read(size)
            assert len(data) == size
            return data

        pe = struct.unpack('<I', read_at(0x3c, 4))[0]
        assert read_at(pe, 4) == b'PE\0\0'
        section_count = struct.unpack('<H', read_at(pe + 6, 2))[0]
        optional_size = struct.unpack('<H', read_at(pe + 20, 2))[0]
        base = struct.unpack('<Q', read_at(pe + 48, 8))[0]
        sections = []
        for index in range(section_count):
            row = read_at(pe + 24 + optional_size + index * 40, 40)
            _, rva, size, offset = struct.unpack_from('<4I', row, 8)
            sections.append((rva, size, offset))

        def read_va(address, size):
            rva = address - base
            start, available, offset = next(s for s in sections if s[0] <= rva < s[0] + s[1])
            assert rva + size <= start + available
            return read_at(offset + rva - start, size)

        def pointer(address):
            return struct.unpack('<Q', read_va(address, 8))[0]

        def text_at(address):
            return read_va(address, 64).split(b'\0')[0].decode('ascii')

        descriptor = 0x144b77990
        field = 0x144dcc0b8
        assert text_at(pointer(descriptor)) == 'ModelStaticState'
        assert pointer(descriptor + 0x50) == 0x144dcbfe0
        assert text_at(pointer(field)) == 'LightmapHash'
        packed = pointer(field + 8)
        assert (packed >> 16) & 0xffff == 48
        field_type = text_at(pointer(pointer(pointer(field + 16))))
        assert field_type == 'Uint32'
        return {
            'type': 'ModelStaticState', 'typeDescriptorAddress': hex(descriptor),
            'fieldTableAddress': hex(pointer(descriptor + 0x50)), 'fieldName': 'LightmapHash',
            'fieldDescriptorAddress': hex(field), 'fieldOffset': 48,
            'fieldType': field_type, 'fieldDescriptorBytes': read_va(field, 24).hex(),
            'sourceExecutable': str(path),
            'bindingToDatabaseKey': 'Native producer140933db0 and lookup140fcb7e0 recovered; 5516 exact instance matches. See static-atlas-instance-matches.json.',
        }


def texture_header(raw):
    if len(raw) != 132:
        raise ValueError('Unexpected selected-map Texture RES header size')
    texture_type, pixel_format = struct.unpack_from('<2I', raw, 8)
    flags, width, height, depth, slices = struct.unpack_from('<5H', raw, 20)
    mip_count, first_mip = raw[30:32]
    mip_sizes = struct.unpack_from('<15I', raw, 48)
    chunk_size = struct.unpack_from('<I', raw, 108)[0]
    assert texture_type == 0 and (width, height, depth, slices) == (5232, 4908, 1, 1)
    assert (mip_count, first_mip) == (1, 0)
    assert pixel_format in FORMATS
    assert mip_sizes[0] == chunk_size == ((width + 3) // 4) * ((height + 3) // 4) * 16
    assert not any(mip_sizes[1:])
    return dict(textureType=texture_type, formatId=pixel_format,
                format=FORMATS[pixel_format], flags=flags, width=width,
                height=height, depth=depth, sliceCount=slices,
                mipCount=mip_count, firstMip=first_mip,
                chunkGuid=str(uuid.UUID(bytes_le=raw[32:48])),
                payloadBytes=chunk_size)


def atlas_table(raw):
    count = struct.unpack_from('<I', raw, 40)[0]
    instance_offset, atlas_offset = struct.unpack_from('<2Q', raw, 48)
    volume_offset = struct.unpack_from('<Q', raw, 80)[0]
    assert count == 17703 and instance_offset == 112
    assert instance_offset + 32 * count == atlas_offset
    assert atlas_offset + 32 * count == volume_offset
    records = []
    previous = -1
    for index in range(count):
        key, entries, pointer, reserved0, reserved1 = struct.unpack_from(
            '<IIQQQ', raw, instance_offset + index * 32)
        assert key > previous and entries == 1
        assert pointer == atlas_offset + index * 32
        assert reserved0 == reserved1 == 0
        previous = key
        records.append({'key': key, 'recordOffset': instance_offset + index * 32,
                        'atlasRecordOffset': pointer,
                        'values': list(struct.unpack_from('<8f', raw, pointer))})
    values = np.frombuffer(raw, dtype='<f4', offset=atlas_offset, count=count * 8).reshape(-1, 8)
    assert np.isfinite(values).all()
    assert not np.count_nonzero(values[:, [1, 2, 6, 7]])
    pixel_scales = values[:, [0, 3]] * [5232, 4908]
    scale_error = float(np.max(np.abs(pixel_scales - np.round(pixel_scales))))
    half_offsets = 2 * values[:, 4:6] * [5232, 4908]
    offset_error = float(np.max(np.abs(half_offsets - np.round(half_offsets))))
    assert scale_error < .00004 and offset_error < .001
    assert np.min(values[:, [0, 3]]) == 0
    # Some chart offsets are negative half pixels. Do not clamp or silently
    # interpret these records as independently usable axis-aligned rectangles.
    return records, {
        'instanceCount': count, 'instanceOffset': instance_offset,
        'atlasOffset': atlas_offset, 'volumeOffset': volume_offset,
        'recordStride': 32, 'strictlyIncreasingUniqueUint32Keys': True,
        'allEntryCountsOne': True, 'allPointersContiguous': True,
        'allReservedWordsZero': True, 'allOffDiagonalTermsZero': True,
        'maximumScaleIntegerPixelError': scale_error,
        'maximumOffsetHalfPixelError': offset_error,
        'zeroScaleRecordCount': int(np.any(values[:, [0, 3]] == 0, axis=1).sum()),
        'nativeMinimumValues': values.min(axis=0).tolist(),
        'nativeMaximumValues': values.max(axis=0).tolist(),
    }


def main():
    documents = {}
    for path in (OUT / 'graph/ebx').glob('*.json'):
        document = json.loads(path.read_text(encoding='utf-8-sig'))
        documents[document['entry']['guid']] = (path, document)
    source_path, source = documents['53c17a19-c90a-11e6-bf1d-a6092bb9b8be']
    source = next(o for o in source['asset']['objects'] if o['$type'].endswith('.StaticEnlightenData'))
    textures = []
    for field in FIELDS:
        ref = source[field]
        path, document = documents[ref['$external']]
        asset = next(o for o in document['asset']['objects'] if o['$id'] == ref['classGuid'])
        rid = asset['Resource']['$resource']
        header_path = OUT / 'static-atlas-headers' / (rid + '.res')
        header = texture_header(header_path.read_bytes())
        assert header['format'] == ('BC6U_FLOAT' if field == FIELDS[0] else 'BC7_UNORM')
        chunk = OUT / 'static-atlas-chunks' / (header['chunkGuid'] + '.chunk')
        assert chunk.stat().st_size == header['payloadBytes']
        textures.append({'sourceField': field, 'fileGuid': ref['$external'],
                         'classGuid': ref['classGuid'], 'resourceId': rid,
                         'ebx': str(path.relative_to(ROOT)),
                         'header': str(header_path.relative_to(ROOT)),
                         'headerSha256': digest(header_path),
                         'chunk': chunk.relative_to(ROOT).as_posix(), 'chunkSha256': digest(chunk), **header})
    dynamic_path = OUT / 'raw-dynamic/8785653264462149711.res'
    records, checks = atlas_table(dynamic_path.read_bytes())
    functions = ['140dac920', '140da52b0', '140fa27c0', '140fa5850', '1464b5a30', '1464b5da0']
    evidence = {
        'evidenceId': EVIDENCE,
        'selectedMapStaticData': str(source_path.relative_to(ROOT)),
        'staticDataSha256': digest(source_path),
        'dynamicDatabase': str(dynamic_path.relative_to(ROOT)),
        'dynamicDatabaseSha256': digest(dynamic_path),
        'staticDatabaseResourceId': source['DatabaseResource']['$resource'],
        'staticGen4Enable': source['StaticGen4Enable'],
        'formatEnumSource': {'path': 'tools/frosty-1.0.5.2/Profiles/StarWarsIISDK.dll',
                            'sha256': 'f5a57713170d210132464ccfb4c182a80e89c263e8455dbb0746f572e3b5f047',
                            'enum': 'FrostySdk.Ebx.RenderFormat', 'values': FORMATS},
        'textures': textures,
        'payloadBudgetBytes': sum(t['payloadBytes'] for t in textures),
        'payloadsExtracted': True,
        'connectedEvidence': {
            'nativeHashAndInstances': 'exports/lighting/static-atlas-instance-matches.json',
            'originalMeshUv': 'web/public/assets/lighting/static-atlas-uv.json',
            'shaderBindings': 'exports/lighting/static-atlas-shader-binding.json',
            'samplerBindings': 'exports/lighting/static-atlas-sampler-binding.json',
            'nativeMathValidation': 'exports/lighting/static-atlas-sample/math-validation.json',
            'preExposure': 'exports/lighting/static-atlas-preexposure.json',
        },
        'tableChecks': checks,
        'instanceBindingMetadata': model_lightmap_field(),
        'shaderWitness': {
            'path': 'exports/materials/floor-shader/f789fdaafa.asm',
            'sha256': digest(ROOT / 'exports/materials/floor-shader/f789fdaafa.dxbc'),
            'uvEquation': 'atlasUv = v1.xw * v3.zw + v3.xy',
            'textures': 'All eight floor function instances bind t2 irradiance, t3/t4/t5 RGB directions, t6 sky visibility through named native selectors18..22.',
            'normal': 'Normal is normalized before atlas direction evaluation.',
            'output': 'o3.rgb is directional diffuse plus baked dominant-direction specular, multiplied by cb2[40].x. o2.w receives t6.r.',
            'nativeSelection': 'Exact floor permutation, source fields, hash lookup and UV input layout recovered. No original-game active frame was captured.',
        },
        'nativeFunctionWitnesses': [{'address': '0x' + a,
                                    'path': 'exports/lighting/dfg-native-functions/' + a + '.c',
                                    'sha256': digest(OUT / 'dfg-native-functions' / (a + '.c'))}
                                   for a in functions],
        'limitations': [
            'This is static analysis and retained-data validation; no native frame was observed.',
            'Native baked-direction BRDF is source smoothness dependent and must replace the probe irradiance path, not be added twice.',
            'The matched native data includes zero-scale records and atlas-edge charts; retain native clamp addressing and exact source UVs.',
            'LightMapPreExposure is proven1.0 for this selected database. Presentation exposure is a separate stage.',
            'Sky visibility is not proven to be a direct-light shadow map and must not be multiplied into arbitrary direct lights.',
            'The native punctual shadow gate is recovered; native shadow projection, depth bias, filtering, cache population and renderer-quality values remain unresolved.',
        ],
    }
    assert evidence['payloadBudgetBytes'] < 150 * 1024 * 1024
    (OUT / 'static-atlas-evidence.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    (OUT / 'static-atlas-bindings.json').write_text(json.dumps({'evidenceId': EVIDENCE, 'records': records}, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'evidenceId': EVIDENCE, 'textures': len(textures), 'payloadBudgetBytes': evidence['payloadBudgetBytes'], **checks}, indent=2))


if __name__ == '__main__':
    main()
