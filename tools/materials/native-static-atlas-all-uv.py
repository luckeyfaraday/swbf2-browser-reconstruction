"""Select only matched map assets and existing browser LODs for source UV export."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
read = lambda path: json.loads((ROOT / path).read_text(encoding='utf-8'))
scene = read('web/public/assets/map.scene.json')
matches = read('exports/lighting/static-atlas-instance-matches.json')
lods = read('web/public/assets/source-lods.json')
selected = {row['assetId'] for row in matches['matched'] if row['values'][0] and row['values'][3]}
levels = {asset_id: {0} for asset_id in selected}
for asset in lods['assets']:
    if asset['assetId'] in levels:
        levels[asset['assetId']].update(level['level'] for level in asset['lods'])
lines = [asset['name'] + '|' + ','.join(map(str, sorted(levels[asset['id']])))
         for asset in scene['assets'] if asset['id'] in selected]
target = ROOT / 'exports/lighting/static-atlas-all-uv-names.txt'
target.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({'assets': len(lines), 'assetLods': sum(map(len, levels.values())), 'names': str(target)}))
