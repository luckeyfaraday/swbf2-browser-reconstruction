"""Retain the selected rifle trail lifecycle and its original GPU artifacts.

Original particle execution evidence is retained separately in particle-warp.
Native frame/render-compositor parity remains unresolved.
"""
import hashlib
import importlib.util
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT/'exports/rifle-trail'
sha = lambda data: hashlib.sha256(data).hexdigest()

def source(path):
    data = path.read_bytes()
    document = json.loads(data)
    return document, {'file': path.relative_to(ROOT).as_posix(), 'sha256': sha(data),
                      'guid': document['entry']['guid']}

bullet, bullet_source = source(next((ROOT/'tools/gameplay-recovery/detail/ebx').glob('*BlasterProjectile_Default_Rifle*json')))
effect, effect_source = source(next((OUT/'ebx').glob('*FX_BlasterBolt_Rifle_Red*json')))
graph, graph_source = source(next((OUT/'ebx').glob('*EG_BlasterBolt_Walrus_Generic*json')))
b = next(o for o in bullet['asset']['objects'] if o['$type'].endswith('WSBulletEntityData'))
e = next(o for o in effect['asset']['objects'] if o['$type'].endswith('EffectEntityData'))
g = next(o for o in graph['asset']['objects'] if o['$type'].endswith('EmitterGraph'))
for key in ['TrailEffect1P', 'TrailEffect3P']:
    assert b[key]['$external'] == effect_source['guid']
    assert b[key]['classGuid'] == effect['asset']['rootInstanceGuid']
assert b['StopTrailEffectOnUnspawn'] is True and b['StopTrailEffectOnUnspawnFrameDelay'] == 2
assert g['KillOnStop'] is True
assert e['MaxActiveInstanceCount']['High'] == 30
spec = importlib.util.spec_from_file_location('gbuffer', ROOT/'tools/materials/native-dfg-gbuffer.py')
gbuffer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gbuffer)
shader_out = OUT/'shaders'; shader_out.mkdir(exist_ok=True)
programs = []
for kind, field in [('spawn', 'CompiledSpawnGraphComputeShader'), ('simulate', 'CompiledSimulateGraphComputeShader')]:
    rid = g[field]['$resource']; path = OUT/'raw/res'/f'{rid}.res'; raw = path.read_bytes()
    size = struct.unpack_from('<I', raw, 24)[0]; bytecode = raw[:size]
    assert bytecode[:4] == b'DXBC' and size <= len(raw)
    (shader_out/f'{kind}.dxbc').write_bytes(bytecode)
    (shader_out/f'{kind}.asm').write_text(gbuffer.assembly(bytecode), encoding='utf-8')
    programs.append({'stage': kind, 'resource': rid, 'source': path.relative_to(ROOT).as_posix(),
                     'sourceSha256': sha(raw), 'dxbcSha256': sha(bytecode), 'bytes': size, 'tailBytes': len(raw)-size})
launch = json.loads((ROOT/'web/public/assets/projectile-launch.json').read_text(encoding='utf-8'))
document = {
    'schemaVersion': 1,
    'weapons': [{'weaponId': row['weaponId'], 'sourceGuid': row['source']['guid']} for row in launch['weapons']],
    'stopOnUnspawn': b['StopTrailEffectOnUnspawn'], 'stopDelayFrames': b['StopTrailEffectOnUnspawnFrameDelay'],
    'effectMaxInstances': e['MaxActiveInstanceCount']['High'], 'particleKillOnStop': g['KillOnStop'],
    'provenance': {'evidenceId': 'BF2-RIFLE-TRAIL-001', 'sources': [bullet_source, effect_source, graph_source],
        'observed': 'Both selected rifles reference the same trail. Stop-on-unspawn delay is 2 frames; its graph kills particles when stopped. High-quality effect limit is 30.',
        'inferred': 'The browser retains visuals for two presented frames after immediate projectile retirement; native frame scheduling is not recovered. Retirement queue and active GPU emitter pool are bounded to the observed effect limit.',
        'limitations': ['Original spawn/simulate kernels, mesh vertex equations, pixel equations and four textures are integrated; original native execution comparisons are retained separately.',
                       'Native parameter producers, frame scheduling, HDR blend/exposure globals, depth-compositor details and overflow replacement order remain reconstructed; see rifle-emitter.json.']},
}
(ROOT/'web/public/assets/rifle-trail.json').write_text(json.dumps(document, indent=2), encoding='utf-8')
(shader_out/'manifest.json').write_text(json.dumps({'evidenceId': 'BF2-RIFLE-TRAIL-001', 'programs': programs,
    'limitations': ['This is the extraction manifest. Original WARP execution and browser GPU comparisons are retained in particle-warp and web/test-results; native frame cadence remains unresolved.']}, indent=2), encoding='utf-8')
print(json.dumps({'weapons': len(document['weapons']), 'retirementFrames': document['stopDelayFrames'], 'programs': len(programs)}))
