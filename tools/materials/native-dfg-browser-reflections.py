"""Publish verified native cubemaps without changing any pixel bytes."""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
source = json.loads((ROOT / 'exports/lighting/dfg-reflection-recovery.json').read_text())
public = ROOT / 'web/public/assets'
output = public / 'source-reflections'
output.mkdir(parents=True, exist_ok=True)


def matrix(transform):
    return [value for column in ('right', 'up', 'forward', 'trans')
            for value in [*[transform[column][axis] for axis in 'xyz'],
                          1 if column == 'trans' else 0]]


assert sum((ROOT / p['sourceChunkPath']).stat().st_size for p in source['extractedPayloads']) < 100 * 1024**2
payloads = []
by_hash = {}
volume_payload_ids = {}
for recovered in source['extractedPayloads']:
    raw = (ROOT / recovered['sourceChunkPath']).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == recovered['sourceChunkSha256']
    assert len(raw) == sum(s['bytes'] for s in recovered['subresources'])
    binding = {k: recovered[k] for k in ('volumeId', 'textureFileGuid', 'textureInstanceGuid')}
    if recovered['sourceChunkSha256'] in by_hash:
        prior = by_hash[recovered['sourceChunkSha256']]
        assert prior['width'] == recovered['metadata']['width'] and prior['mipCount'] == recovered['metadata']['mipCount']
        prior['textureBindings'].append(binding)
        volume_payload_ids[recovered['volumeId']] = prior['id']
        continue
    name = recovered['volumeId'] + '.rgba16f.bin'
    (output / name).write_bytes(raw)
    metadata = recovered['metadata']
    payloads.append({
        'id': recovered['volumeId'],
        'url': '/assets/source-reflections/' + name,
        'byteLength': len(raw), 'sha256': recovered['sourceChunkSha256'],
        'width': metadata['width'], 'height': metadata['height'],
        'mipCount': metadata['mipCount'], 'faceCount': metadata['depth'],
        'pixelFormat': metadata['pixelFormat'], 'layout': recovered['sourceLayout'],
        'textureFileGuid': recovered['textureFileGuid'],
        'textureInstanceGuid': recovered['textureInstanceGuid'],
        'resourceId': metadata['resourceId'], 'chunkGuid': metadata['chunkGuid'],
        'sourceChunkPath': recovered['sourceChunkPath'],
        'textureBindings': [binding],
        'subresources': recovered['subresources'],
    })
    by_hash[recovered['sourceChunkSha256']] = payloads[-1]
    volume_payload_ids[recovered['volumeId']] = payloads[-1]['id']
volumes = []
for volume in source['volumes']:
    volume_id = volume['$id']
    volumes.append({
        'id': volume_id,
        'shape': 'sphere' if 'Sphere' in volume['$type'] else 'box',
        'enabled': volume['Enabled'], 'visible': volume['IsVisible'],
        'mode': volume['Mode']['name'], 'matrix': matrix(volume['Transform']),
        'payloadId': volume_payload_ids.get(volume_id),
        'bakedTexture': volume['BakedTexture'],
        'sourceProperties': {k: v for k, v in volume.items() if k not in {
            '$type', '__Id', '__InstanceGuid', '$id', 'Transform', 'BakedTexture',
            'Enabled', 'IsVisible', 'Mode'}},
    })
document = {
    'version': 1, 'evidenceId': source['evidenceId'],
    'sourceLevel': source['sourceLevel'], 'sourceLayer': source['sourceLayer'],
    'layerRoot': source['layerRoot'],
    'levelReference': {
        'id': source['levelReference']['$id'],
        'excluded': source['levelReference']['Excluded'],
        'blueprint': source['levelReference']['Blueprint'],
        'matrix': matrix(source['levelReference']['BlueprintTransform']),
    },
    'coordinateSystem': 'Source absolute XYZ; browser world preserves these axes and origin.',
    'payloads': payloads, 'volumes': volumes,
    'policy': {
        'radiometry': 'Original linear RGBA binary16, scale 1; no gamma conversion or 8-bit clamp.',
        'orientationInference': 'Native face indices 0..5 interpreted as +X,-X,+Y,-Y,+Z,-Z with unchanged source rows. Three render-target cube convention suppresses its external-image X reflection. Native capture alignment has not been observed.',
        'selectionInference': 'Enabled visible baked volumes in the active layer; choose smallest containing available volume using local box [-1,+1] or sphere radius 1. No nearest-volume fallback. Native extents and overlap weights remain unresolved.',
        'filteringInference': 'Three PMREM from native mip 0 only; all original source mip levels retained (87 cubes with six mips, one with only mip 0). Native roughness-to-mip and DFG sampler are unresolved.',
        'limitations': 'All 88 active source volumes have recovered payloads. One camera-selected scene environment; per-object blending, influence fades, proxy reprojection and native specular BRDF are not reconstructed.',
    },
}
(public / 'source-reflections.json').write_text(json.dumps(document, indent=2) + '\n')
print(json.dumps({'volumes': len(volumes), 'payloads': len(payloads),
                  'payloadBytes': sum(p['byteLength'] for p in payloads)}))
