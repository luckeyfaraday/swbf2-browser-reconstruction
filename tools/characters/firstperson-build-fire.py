"""Publish decoded source firing tracks with explicit browser playback policy."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source_path = ROOT / 'exports/characters/firstperson-dct/decoded-clips.json'
source = json.loads(source_path.read_text())
crosscheck = json.loads((source_path.parent / 'reference-comparison.json').read_text())
assert len(crosscheck['comparisons']) == 3
assert all(c['exactBytes'] and c['maxAbsoluteError'] == 0 for c in crosscheck['comparisons'])
weapons = []
for name, weapon_id in [('E11', 'primary'), ('A280', 'rebel-a280')]:
    clips = []
    for clip in source['clips']:
        if f'_1p_{name}_' not in clip['sourceName']:
            continue
        assert clip['additive']
        fps = clip['controller']['FPS']
        time_scale = clip['controller']['TimeScale']
        ticks = clip['sourceKeyTimes']
        assert fps > 0 and time_scale > 0
        clips.append({
            'id': clip['sourceAnimationKey'], 'sourceName': clip['sourceName'],
            'additive': True, 'sourceKeyTimes': ticks,
            'sourceTiming': {'fps': fps, 'timeScale': time_scale},
            'durationSeconds': (ticks[-1] - ticks[0]) / fps * time_scale,
            'tracks': [{'bone': t['bone'], 'property': t['property'], 'sourceDofId': t['sourceDofId'],
                        'values': [v[:4 if t['property'] == 'rotation' else 3] for v in t['rawVec4']]}
                       for t in clip['tracks']],
            'sourceRawSamplesSha256': clip['validation']['rawSamplesSha256'],
        })
    assert clips
    weapons.append({'weaponId': weapon_id, 'sourceWeaponName': name, 'clips': clips})
policy = {
    'nativeExecutionObserved': False,
    'timing': 'seconds = (sourceTick - firstTick) / sourceFPS * sourceTimeScale; TimeScale is treated as a duration multiplier as an explicit reconstruction choice.',
    'composition': 'Three AdditiveAnimationBlendMode: local translation = base + delta; local quaternion = base * normalized delta. Native multiplication order and weights are unresolved.',
    'variation': 'Deterministic source-order cycling per accepted shot: E11 fire01; A280 fire02 then fire03. Native variation selection is unresolved.',
    'retrigger': 'Each accepted shot stops the previous fire action and restarts the selected source clip at zero.',
    'basePose': 'Idle and sprint use the recovered static source poses with immediate selection; native transition graph is unresolved.',
}
document = {
    'schemaVersion': 1, 'weapons': weapons, 'policy': policy,
    'provenance': {'evidenceId': 'BF2-FIRSTPERSON-FIRE-PLAYBACK-001',
                   'sourceEvidenceId': source['evidenceId'], 'crosscheckEvidenceId': crosscheck['evidenceId'],
                   'sourceBankSha256': source['sourceBankSha256'], 'sourceRig': source['sourceRig'],
                   'decodedDocumentSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
                   'observed': 'Original DCT samples, controller FPS/TimeScale/key ticks and named first-person rig channels; all 46,008 decoded floats match the independent upstream decoder.',
                   'inferred': policy, 'limitations': source['limitations']},
}
out = ROOT / 'web/public/assets/firstperson-fire.json'
out.write_text(json.dumps(document, separators=(',', ':')))
print(json.dumps({'file': str(out), 'bytes': out.stat().st_size, 'weapons': [
    {'weaponId': w['weaponId'], 'clips': [{'name': c['sourceName'], 'duration': c['durationSeconds'], 'tracks': len(c['tracks'])} for c in w['clips']]}
    for w in weapons]}, indent=2))
