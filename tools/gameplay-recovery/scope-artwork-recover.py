"""Bounded, lossless recovery of the selected rifle HUD's authored vector data.

No native executable execution, texture approximation, or UI/runtime mutation.
The optional SVG adapter separately labels its circular-arc interpretation.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'exports/firstperson-scope-overlay/ebx'
OUT = ROOT / 'web/public/assets/scope-artwork.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(value):
    if isinstance(value, list):
        return [plain(x) for x in value]
    if not isinstance(value, dict):
        return value
    # Retain enum names/numbers, references and every authored numerical field.
    return {k: plain(v) for k, v in value.items() if k not in ['$type', '__InstanceGuid', '__Id']}


def read(pattern, directory=SOURCE):
    files = list(directory.glob(pattern))
    assert len(files) == 1, (pattern, files)
    path = files[0]
    data = json.loads(path.read_text())
    assert not data['asset']['errors']
    return path, data


def provenance(path, data):
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path),
            'fileGuid': data['asset']['fileGuid'], 'sourceName': data['entry']['name'],
            'sourceSha1': data['entry']['sha1']}


assets = {}
for path in sorted(SOURCE.glob('UI_Shapes*.json')):
    data = json.loads(path.read_text())
    obj, = data['asset']['objects']
    assert obj['$type'].endswith('.DiceUIVectorShapeAsset')
    for shape in obj['Shapes']:
        n = len(shape['TriangulatedPoints'])
        assert n == len(shape['TriangulatedColors']) == len(shape['TriangulatedExpansions'])
        assert len(shape['TriangulatedIndices']) % 3 == 0
        assert all(0 <= i < n for i in shape['TriangulatedIndices'])
    assets[data['asset']['fileGuid']] = {
        'source': provenance(path, data), 'rootInstanceGuid': data['asset']['rootInstanceGuid'],
        'layoutRect': plain(obj['LayoutRect']), 'name': obj['Name'],
        'shapes': plain(obj['Shapes'])}
assert len(assets) == 5

graphs = {}
for name, pattern in [('screen', '*CrosshairScopeRifleHudScreen__*'),
                      ('mainLogic', '*PF_Hud_CrosshairScope_MainLogic__*'),
                      ('weaponPrefab', '*PF_Hud_Weapon_Scope_Rifle__*'),
                      ('triggerInterval', '*PF_TriggerAtInterval__*')]:
    path, data = read(pattern, ROOT / 'exports/scope-artwork-trigger/ebx' if name == 'triggerInterval' else SOURCE)
    graphs[name] = {'source': provenance(path, data), 'root': data['asset']['root'],
                    'objects': {o['$id']: {'sourceType': o['$type'].split('.')[-1], **plain(o)}
                                for o in data['asset']['objects']}}

screen = graphs['screen']['objects']
elements = {}
for key, obj in screen.items():
    if obj['sourceType'] in ['VectorShapeElementData', 'RepeatShapeElementData']:
        assert obj['Shape']['$external'] in assets
        elements[obj['InstanceName']] = {'objectId': key, 'assetId': obj['Shape']['$external'], 'data': obj}
assert len(elements) == 9

palette_path, = (ROOT / 'exports/scope-artwork-palette/ebx').glob('*.json')
palette_data = json.loads(palette_path.read_text())
palette_obj, = [o for o in palette_data['asset']['objects'] if o['$type'].endswith('.UIColorPalette')]
palette_rows = [[plain(c) for c in row['Colors']] for row in palette_obj['Colors']]
assert len(palette_rows) == 4 and all(len(row) == 57 for row in palette_rows)
assert all(row[index] == palette_rows[0][index] for row in palette_rows for index in [0, 22, 24, 27])

doc = {
    'schemaVersion': 1, 'evidenceId': 'BF2-SCOPE-ARTWORK-001',
    'assets': assets, 'elements': elements, 'graphs': graphs,
    'palette': {'source': provenance(palette_path, palette_data), 'rows': palette_rows,
                'scopeIndicesIdenticalInEveryRow': [0, 22, 24, 27]},
    'layout': {'size': [1920, 1080], 'root': 'internal:62', 'scopeContainer': 'internal:22',
               'sourceLayerOrder': screen['internal:62']['Layers'],
               'sourceScopeElementOrder': screen['internal:22']['Elements']},
    'controlEvidence': {
        'mainLogicFraction': {'objectId': 'internal:5', 'riseVelocity': 6, 'fallVelocity': 8,
                             'useRealTimeClock': False, 'interpolation': 'Linear/EaseOut; UseVelocity=true'},
        'outlineAlpha': {'expression': 'fraction * outlineRandom', 'randomRange': [.18, .25],
                         'randomObject': 'mainLogic/internal:13', 'multiplyObject': 'mainLogic/internal:11',
                         'screenRoute': ['internal:7/0xeaa9e316', 'internal:12/Alpha']},
        'scannerAlpha': {'expression': 'fraction * scannerRandom', 'randomRange': [.73, 1],
                         'randomObject': 'mainLogic/internal:14', 'multiplyObject': 'mainLogic/internal:7'},
        'randomTrigger': {'prefab': 'triggerInterval', 'delayObject': 'triggerInterval/internal:2',
                          'delay': .01, 'clock': 'TimeDeltaType_World',
                          'gate': 'fraction > float32(.95)',
                          'route': 'Delay.Out -> RandomFloat.In and EventGate.In -> Delay.In',
                          'limitations': 'Original PRNG and native scheduler tick rounding are unresolved'},
        'containerVisible': {'expression': 'fraction > 0', 'object': 'mainLogic/internal:12'},
        'scopeStateThreshold': {'expression': 'fraction > float32(.95)', 'object': 'mainLogic/internal:8'},
        'backgroundAlpha': {'timelineCurve': 'screen/internal:26', 'time': [0, 1], 'value': [0, .85],
                            'target': 'screen/internal:13/Alpha', 'externalOverridePin': '0x3cf915c1',
                            'precedence': 'Native precedence between timeline and connected external override unresolved'},
        'outlineGlow': {'timelineCurve': 'screen/internal:27', 'time': [0, 1], 'value': [10, 1],
                        'target': 'screen/internal:12/GlowWidth',
                        'competingRoute': 'screen/internal:41 lerpf(1,4,smoothedDispersionAngle)',
                        'precedence': 'Native precedence between timeline and connected math output unresolved'},
        'scopeTransform': {'expression': 'scale(1 + DispersionAngle/10, 1 + DispersionAngle/10, 1)',
                           'input': 'screen/internal:63/0x29c841c6 (DispersionAngle)',
                           'math': 'screen/internal:48', 'interpolator': 'screen/internal:16',
                           'interpolation': 'Expo/EaseOut, duration .015, UseRealTimeClock=false',
                           'target': 'screen/internal:22/Transform', 'pivot': [.5, .5, 0]},
        'colorRouting': {'outlineAndIcons': 'screen/internal:54 selects palette22/24; selection comes from interface0x54d0e8b2',
                         'backgroundPaletteIndex': 27, 'resolvedPaletteColors': True},
    },
    'known': [
        'All five vector asset paths, corner radii, colors, widths, expansion vectors, and triangulated indices are copied numerically unchanged.',
        'All nine vector/repeat element defaults, complete screen/main-logic/prefab graph records and connections are retained.',
        'ScopeGlow and ScopeOutline are in the same dispersion-controlled container with identical 1920x1080 layout and identity default transforms.',
        'ScopeOutline width=.3, additive blend and glow1; ScopeGlow alpha blend and glow48/palette27; both default Alpha=0.',
    ],
    'inferred': [
        'Optional SVG circular arcs interpret each destination corner Radius as the incoming minor circular segment, with sweep from path winding. Authored dual-zoom circles and the outline straight joins support this, but no native path tessellator was executed.',
        'SVG rendering is a portable artwork preview; native UI glow/compositing and viewport expansion are not reproduced. Interpreting palette RGB as linear and converting to CSS sRGB is an explicitly selected browser adaptation.'
    ],
    'unresolved': [
        'Native draw-state and first-person weapon visibility are a separate recovery; this artifact changes neither.',
        'Native property priority between timeline curves and concurrent direct property connections.',
        'Random-generator algorithm/seed and native .01 world-clock delay scheduler rounding, native radial repetition and glow shader.',
        'The complete native viewport adaptation/expansion rule; source layout and expansion values remain retained.'
    ]
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(doc, separators=(',', ':')) + '\n')
print(json.dumps({'output': str(OUT.relative_to(ROOT)), 'bytes': OUT.stat().st_size,
                  'sha256': digest(OUT), 'assets': len(assets), 'shapes': sum(len(a['shapes']) for a in assets.values()),
                  'elements': len(elements)}))
