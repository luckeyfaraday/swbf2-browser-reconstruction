"""Retain the selected-map lightmap scale and its native CPU/RVM provenance.

Only reads the installed PE and retained assets; never executes the game.
"""
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting'
EVIDENCE = 'BF2-NATIVE-STATIC-ATLAS-PREEXPOSURE-001'


def exposure_vector(value):
    """Native common-constant +0xa0: bake pre-exposure and reciprocal."""
    if not math.isfinite(value) or value == 0:
        raise ValueError('A finite nonzero bake exposure is required')
    value = struct.unpack('<f', struct.pack('<f', value))[0]
    reciprocal = struct.unpack('<f', struct.pack('<f', 1 / value))[0]
    return [value, reciprocal, 1.0, 1.0]


def recover():
    path = ROOT / 'tools/materials/native-dfg-pe.py'
    pe = {'__file__': str(path)}
    exec(path.read_text().split('names =')[0], pe)
    data = pe['data']
    # These are original machine-code operands, not decompiler type guesses.
    anchors = [
        (0x1415d44f1, '410f28b0a0000000', 'selector 28 copies float4 at common input +0xa0'),
        (0x1415d7581, '410f28b090000000', 'selector 8 copies float4 at common input +0x90'),
    ]
    checked = []
    for address, expected, meaning in anchors:
        raw = bytes.fromhex(expected)
        offset = pe['to_offset'](address - pe['image_base'])
        actual = data[offset:offset + len(raw)]
        assert actual == raw, (hex(address), actual.hex(), expected)
        checked.append({'address': hex(address), 'bytes': actual.hex(), 'meaning': meaning})

    database = OUT / 'raw-dynamic/8785653264462149711.res'
    payload = database.read_bytes()
    value = struct.unpack_from('<f', payload, 12)[0]
    assert payload[12:16].hex() == '0000803f'
    vector = exposure_vector(value)
    functions = {
        '140fc2380': 'Read first selected database resource payload +0x0c; default 1 when none exists.',
        '140db2f60': 'Fetch renderer lightmap scale and set render-context exposure slot 2.',
        '140da9450': 'Validate finite exposure and store slot 2 at render context +0x3218.',
        '140ff0180': 'Copy render-context +0x3218 to per-view +0x2d98.',
        '140d8af90': 'Pass per-view +0x2d98 as lightmap argument 7 to common-state preparation.',
        '140daa4c0': 'Call common-constant builder and publish its block into the parameter database.',
        '140d853b0': 'Write [argument7, 1/argument7, 1, 1] at common block +0xa0.',
        '1415cd6a0': 'Factory copies original 20-byte LegacyInstructionData records into executable RVM instruction object.',
        '1415d7710': 'Dispatch original instruction uint16 selector at byte +0x10; selector 28 calls 1415d44c0.',
        '1415d44c0': 'Copy exactly 16 bytes at source common block +0xa0 into output RVM slot.',
    }
    witnesses = []
    for address, meaning in functions.items():
        source = OUT / 'dfg-native-functions' / (address + '.c')
        witnesses.append({'address': '0x' + address, 'meaning': meaning,
                          'path': source.relative_to(ROOT).as_posix(),
                          'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
    enums = json.loads((OUT / 'dfg-native-enums.json').read_text())
    assert any(x['type'] == 'ShaderConstantFunction' and x['value'] == 28 and
               x['name'] == 'ShaderConstantFunction_LightMapPreExposure' for x in enums)
    report = {
        'schemaVersion': 1, 'evidenceId': EVIDENCE,
        'value': vector[1], 'nativeVector': vector,
        'sourceValue': value, 'sourceBitsLittleEndian': payload[12:16].hex(),
        'sourceByteOffset': 12, 'sourceResourceId': '8785653264462149711',
        'sourceDatabase': database.relative_to(ROOT).as_posix(),
        'sourceDatabaseSha256': hashlib.sha256(payload).hexdigest(),
        'selector': 28, 'selectorName': 'ShaderConstantFunction_LightMapPreExposure',
        'sourceCommonBlockByteOffset': 160,
        'consumer': {'shader': 'f789fdaafa', 'constant': 'cb2[41].y',
                     'expression': 'sample(t2, atlasUV).rgb * cb2[41].y',
                     'convention': 'Reciprocal of bake pre-exposure; the selected source vector is [1,1,1,1].'},
        'chain': witnesses, 'nativeMachineCodeAnchors': checked,
        'rvmRecordSemantics': 'The first uint32 is a scope/slot handle (low/high uint16); selector is uint16 at +0x10. Prior kind-5 / kind-0x25 labels were input slot indices, not dispatch opcodes.',
        'limitations': [
            'Static native producer, original database and shader evidence; no original-game frame capture.',
            'The selected map is proven to use 1.0. Do not reuse this scalar for a different database without reading its header and selection.',
            'The native shader also multiplies outgoing GBuffer radiance by current frame pre-exposure cb2[40].x; browser HDR remains unexposed until its separate presentation stage.',
            'Generic device constant-buffer packing is not reproduced here. The named original selector copies the complete source vector; all four lanes are exactly one for this map.',
        ],
    }
    return report


if __name__ == '__main__':
    report = recover()
    for destination in [OUT / 'static-atlas-preexposure.json',
                        ROOT / 'web/public/assets/lighting/static-atlas-preexposure.json']:
        destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'evidenceId': EVIDENCE, 'value': report['value'],
                      'nativeVector': report['nativeVector'], 'nativeWitnesses': len(report['chain'])}))
