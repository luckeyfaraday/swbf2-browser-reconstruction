"""Pack original floor-chart BC blocks without resampling or changing texels."""
import hashlib
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting/static-atlas-floor'
read = lambda path: json.loads((ROOT / path).read_text(encoding='utf-8'))
sha = lambda value: hashlib.sha256(value).hexdigest()


def main():
    floor = read('web/public/assets/recovered-floor-materials.json')
    uv = read('web/public/assets/lighting/static-atlas-uv.json')
    matches = read('exports/lighting/static-atlas-instance-matches.json')
    sample = read('exports/lighting/static-atlas-sample/manifest.json')
    materials = {(row['assetId'], row['materialId']) for row in floor['materials']}
    records = [row for row in uv['records'] if (row['assetId'], row['sourceMaterialId']) in materials]
    bounds = {}
    for row in records:
        old = bounds.setdefault(row['assetId'], [[math.inf, math.inf], [-math.inf, -math.inf]])
        for axis in range(2):
            old[0][axis] = min(old[0][axis], row['uvBounds'][0][axis])
            old[1][axis] = max(old[1][axis], row['uvBounds'][1][axis])
    charts, instances = {}, []
    width, height = 5232, 4908
    for row in matches['matched']:
        if row['assetId'] not in bounds or not row['values'][0] or not row['values'][3]:
            continue
        sx, z0, z1, sy, ox, oy, z2, z3 = row['values']
        assert z0 == z1 == z2 == z3 == 0 and sx > 0 and sy > 0
        low, high = bounds[row['assetId']]
        # Keep all bilinear neighbors, then expand to ORIGINAL 4x4 BC blocks.
        # Clamp matches native s0; floor samples themselves stay inside0..1.
        # One ORIGINAL texel guard absorbs vertex/fragment float32 rounding at
        # analytical texel-center boundaries; never bleed into an adjacent chart.
        first_x = max(0, math.floor((ox + sx * low[0]) * width - .5) - 1)
        first_y = max(0, math.floor((oy + sy * low[1]) * height - .5) - 1)
        last_x = min(width - 1, math.ceil((ox + sx * high[0]) * width - .5) + 1)
        last_y = min(height - 1, math.ceil((oy + sy * high[1]) * height - .5) + 1)
        assert 0 <= first_x <= last_x < width and 0 <= first_y <= last_y < height
        crop = (first_x // 4 * 4, first_y // 4 * 4, (last_x // 4 + 1) * 4, (last_y // 4 + 1) * 4)
        key = tuple(row['values'])
        if key not in charts:
            charts[key] = {'index': len(charts), 'sourceTransform': row['values'], 'sourceCrop': list(crop),
                           'width': crop[2] - crop[0], 'height': crop[3] - crop[1], 'instances': []}
        else:
            assert charts[key]['sourceCrop'] == list(crop), 'Shared chart requires union of asset UV bounds'
        charts[key]['instances'].append(row['instanceIndex'])
        instances.append({key: row[key] for key in ('instanceIndex', 'assetId', 'key', 'atlasRecordOffset', 'values')})
        instances[-1]['chartIndex'] = charts[key]['index']
    # Browser-only shelf placement; retain whole compressed blocks unchanged.
    packed_width, x, y, row_height = 1024, 0, 0, 0
    ordered = sorted(charts.values(), key=lambda chart: (-chart['height'], -chart['width'], chart['index']))
    for chart in ordered:
        assert chart['width'] <= packed_width
        if x + chart['width'] > packed_width:
            x, y, row_height = 0, y + row_height, 0
        chart['packedOrigin'] = [x, y]
        x += chart['width']
        row_height = max(row_height, chart['height'])
    packed_height = (y + row_height + 7) // 8 * 8
    assert packed_width % 8 == packed_height % 8 == 0
    OUT.mkdir(parents=True, exist_ok=True)
    textures = []
    for texture in sample['textures']:
        source = (ROOT / 'exports/lighting/static-atlas-chunks' / (texture['chunkGuid'] + '.chunk')).read_bytes()
        assert sha(source) == texture['sourceChunkSha256'] and len(source) == width * height
        packed = bytearray(packed_width * packed_height)
        copied_blocks = 0
        for chart in ordered:
            left, top, right, bottom = chart['sourceCrop']
            dest_x, dest_y = chart['packedOrigin']
            count = chart['width'] // 4 * 16
            for offset_y in range(0, chart['height'], 4):
                source_at = ((top + offset_y) // 4 * (width // 4) + left // 4) * 16
                dest_at = ((dest_y + offset_y) // 4 * (packed_width // 4) + dest_x // 4) * 16
                packed[dest_at:dest_at+count] = source[source_at:source_at+count]
                assert packed[dest_at:dest_at+count] == source[source_at:source_at+count]
                copied_blocks += count // 16
        name = texture['sourceField'] + '.bc.bin'
        (OUT / name).write_bytes(packed)
        textures.append({key: texture[key] for key in ('sourceField', 'fileGuid', 'chunkGuid', 'sourceChunkSha256', 'format', 'dxgiFormat')})
        textures[-1].update({'cropFile': name, 'cropSize': [packed_width, packed_height], 'sha256': sha(packed),
                            'copiedOriginalBlocks': copied_blocks})
    for chart in charts.values():
        sx, _, _, sy, ox, oy, _, _ = chart['sourceTransform']
        left, top, _, _ = chart['sourceCrop']
        dx, dy = chart['packedOrigin']
        chart['packedTransform'] = [sx * width / packed_width, sy * height / packed_height,
                                    (ox * width - left + dx) / packed_width, (oy * height - top + dy) / packed_height]
    result = {'version': 1, 'evidenceId': 'BF2-NATIVE-FLOOR-ATLAS-PACKING-001',
              'sourceDimensions': [width, height], 'packedDimensions': [packed_width, packed_height],
              'sourceSceneSha256': matches['sceneSha256'], 'uvEvidence': uv['evidenceId'],
              'materials': [{'assetId': asset_id, 'materialId': material_id} for asset_id, material_id in sorted(materials)],
              'uvRecords': records, 'instances': instances,
              'charts': sorted(charts.values(), key=lambda chart: chart['index']), 'textures': textures,
              'policy': 'Original compressed blocks copied byte-for-byte. Source chart UV affine transform compensated for browser shelf placement; bilinear neighbors retained. No resampling or mip generation.',
              'limitations': ['Floor atlas variant only; runtime exposure and shader selection are separately established.',
                              'Floating coordinate arithmetic and hardware filtering need browser verification before runtime activation.']}
    (OUT / 'manifest.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'charts': len(charts), 'instances': len(instances), 'uvRecords': len(records),
                      'packedDimensions': result['packedDimensions'], 'fourFloatLayersBytes': packed_width * packed_height * 64}))


if __name__ == '__main__':
    main()
