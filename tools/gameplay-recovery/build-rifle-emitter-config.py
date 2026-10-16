"""Retain selected installed graph values; runtime producer choices stay separate."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = ROOT/'exports/rifle-trail/ebx'
graph_path = next(source.glob('*EG_BlasterBolt_Walrus_Generic*json'))
effect_path = next(source.glob('*FX_BlasterBolt_Rifle_Red*json'))
graph = next(o for o in json.loads(graph_path.read_text(encoding='utf-8'))['asset']['objects'] if o['$type'].endswith('.EmitterGraph'))
effect = next(o for o in json.loads(effect_path.read_text(encoding='utf-8'))['asset']['objects'] if o['$type'].endswith('.EmitterGraphEntityData'))
overrides = {p['PropertyId']: p['Value'] for p in effect['EmitterGraphParams']}
params = [[overrides.get(p['PropertyId'], p['Value'])[axis] for axis in 'xyzw'] for p in graph['EmitterGraphParams']]
assert len(params) <= 32 and graph['ParticleDataByteStride'] == 88
assert graph['ParticleMaxCount']['High'] == 1 and graph['ZBufferEnable'] is False
document = {
    'schemaVersion': 1, 'evidenceId': 'BF2-RIFLE-GPU-BINDINGS-001',
    'emitterStride': 912, 'particleStride': 88, 'graphParams': params,
    'particleLife': graph['ParticleLifeSpan']['High'], 'particleCount': graph['ParticleMaxCount']['High'],
    'effectLimit': effect['MaxActiveInstanceCount']['High'], 'depthTest': graph['ZBufferEnable'],
    'drawPass': graph['DrawPass']['name'], 'sortMode': graph['SortMode']['name'],
    'sources': [{'file': p.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in [graph_path, effect_path]],
    'observed': 'Original graph defaults with selected red rifle effect overrides matched by PropertyId; one particle per emitter, 88-byte state, foreground pass with ZBufferEnable=false.',
    'inferred': 'Browser maps current projectile endpoint/direction/speed and launch origin to emitter transform, scalar speed and muzzle fields; graph order is used for the recovered GPU property slots. First presentation spawns at the current endpoint then simulates using the already elapsed projectile age; later updates use elapsed simulation time, and stopped trails retain the existing two-presentation lifecycle.',
    'limitations': ['Native effect-parameter producers, camera-relative world origin, complete frame scheduling and native overflow replacement order remain unverified.',
        'Additive HDR compositing, double-sided rasterization, explicit MRT2-vs-opaque depth resolve and native global40 z/w=1 remain provisional; original pixel equations and textures are retained without exposure compensation.']
}
out = ROOT/'web/public/assets/rifle-emitter.json'
out.write_text(json.dumps(document, indent=2), encoding='utf-8')
print(json.dumps({'graphVectors': len(params), 'particleLife': document['particleLife'], 'effectLimit': document['effectLimit'], 'bytes': out.stat().st_size}))
