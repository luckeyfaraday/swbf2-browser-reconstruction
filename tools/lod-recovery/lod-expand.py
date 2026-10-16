"""Prepare or merge the bounded native LOD delta without replacing first24 files."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lod-recovery'
parser = argparse.ArgumentParser()
parser.add_argument('phase', choices=['names', 'merge'])
args = parser.parse_args()
read = lambda path: json.loads(path.read_text(encoding='utf-8'))

if args.phase == 'names':
    audit = read(OUT / 'audit.json')
    baseline_path = OUT / 'render-lods-first24.json'
    if not baseline_path.exists():
        current = read(ROOT / 'web/public/assets/source-lods.json')
        assert len(current['assets']) == 24, 'First batch must be retained before expansion'
        baseline_path.write_text(json.dumps(current, indent=2), encoding='utf-8')
    baseline = read(baseline_path)
    ids = {row['assetId'] for row in baseline['assets']}
    delta = [row for row in audit['assets'] if row['assetId'] in audit['selectedAssetIds'] and row['assetId'] not in ids]
    assert len(delta) == audit['visibleSelection']['count']
    for level in (1, 2):
        selected = [row for row in delta if len(row['lods']) > level and row['lods'][level]['exactMaterialReuseEligible']]
        (OUT / f'lod{level}-extra-names.txt').write_text('\n'.join(row['name'] for row in selected) + '\n', encoding='utf-8')
        print(f'LOD{level}: {len(selected)} additional original meshes')
    known_groups = {read(path)['entry']['guid'] for path in (OUT / 'groups/ebx').glob('*.json')}
    missing = sorted({row['sourceLodGroup']['name'] for row in delta if row['sourceLodGroup']['$external'] not in known_groups})
    (OUT / 'groups-extra-names.txt').write_text('\n'.join(missing), encoding='utf-8')
    print(f'Additional group records: {len(missing)}')
else:
    for level in (1, 2):
        path = OUT / f'lod{level}/mesh.manifest.json'
        backup = OUT / f'lod{level}/mesh.manifest-first24.json'
        if not backup.exists():
            original = read(path)
            assert len(original['results']) == (24 if level == 1 else 22)
            backup.write_text(json.dumps(original, indent=2), encoding='utf-8')
        old = read(backup)
        delta_path = OUT / f'lod{level}-extra/mesh.manifest.json'
        new = read(delta_path)
        assert old['complete'] and new['complete'] and not old['errors'] and not new['errors']
        rows = {row['guid']: row for row in old['results']}
        for row in new['results']:
            assert row['guid'] not in rows, 'Delta cannot overwrite an existing source export'
            assert (delta_path.parent / row['file']).is_file()
            rows[row['guid']] = {**row, 'file': f'../lod{level}-extra/' + row['file']}
        old['results'] = list(rows.values())
        old['expandedFrom'] = {'deltaManifest': delta_path.relative_to(ROOT).as_posix(), 'baseManifest': backup.relative_to(ROOT).as_posix()}
        path.write_text(json.dumps(old, indent=2), encoding='utf-8')
        print(f'LOD{level}: {len(rows)} retained original exports')
