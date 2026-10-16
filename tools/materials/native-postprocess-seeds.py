"""Bounded original PE seeds for color-cube construction and presentation."""
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'tools/materials/native-dfg-pe.py'
pe = {'__file__': str(source)}
exec(source.read_text(encoding='utf-8').split('names =')[0], pe)
data, base = pe['data'], pe['image_base']
names = ['ShaderProgram_ColorCubeInterpolateCS', 'ShaderProgram_MergeRenderPlanes',
         'GradingLutAsset', 'HdrColorGradingLut', 'ColorGradingEnable',
         'HdrColorGradingEnable', 'ColorCubeConstants', 'ColorCubeInterpolate',
         'PqToLinearLut', 'ColorGrading', 'UpdateColorGrading', 'HdrGradingEnable', 'GameRenderSettings',
         'colorCorrection']
seeds = []
for name in names:
    for match in re.finditer(rb'(?<=\x00)' + name.encode() + rb'(?=\x00)', data):
        at = match.start()
        seeds.append({'name': name, 'fileOffset': at,
                      'address': hex(base + pe['to_rva'](at)), 'ripLeaCandidates': [],
                      'absolutePointers': []})
by_address = {int(row['address'], 16): row for row in seeds}
for section in pe['sections']:
    if not section['characteristics'] & 0x20000000:
        continue
    region = data[section['offset']:section['offset'] + section['size']]
    for match in re.finditer(rb'[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]', region):
        offset, rva = section['offset'] + match.start(), section['rva'] + match.start()
        target = base + rva + 7 + struct.unpack_from('<i', data, offset + 3)[0]
        if target in by_address:
            by_address[target]['ripLeaCandidates'].append({'address': hex(base + rva),
                'bytes': data[offset:offset + 7].hex(), 'function': pe['function'](rva)})
for seed in seeds:
    needle = struct.pack('<Q', int(seed['address'], 16))
    seed['absolutePointers'] = [hex(base + pe['to_rva'](m.start()))
                               for m in re.finditer(re.escape(needle), data)]
programs = []
for name in names[:2]:
    identifier = 5381
    for value in name.encode():
        identifier = ((identifier * 33) ^ value) & 0xffffffff
    occurrences = []
    for match in re.finditer(re.escape(struct.pack('<I', identifier)), data):
        rva = pe['to_rva'](match.start())
        occurrences.append({'address': hex(base + rva), 'function': pe['function'](rva)})
    programs.append({'name': name, 'identifier': hex(identifier), 'occurrences': occurrences})
callers = []
targets = {0x140f47bf0, 0x140f61420, 0x141480d70, 0x140f6b130, 0x140f48190, 0x140f36170,
           0x1414872a0, 0x141476d80}
for section in pe['sections']:
    if not section['characteristics'] & 0x20000000:
        continue
    region = data[section['offset']:section['offset'] + section['size']]
    for match in re.finditer(rb'[\xe8\xe9]', region):
        index = match.start()
        if index + 5 > len(region):
            continue
        rva = section['rva'] + index
        target = base + rva + 5 + struct.unpack_from('<i', region, index + 1)[0]
        if target in targets:
            callers.append({'address': hex(base + rva), 'target': hex(target),
                            'function': pe['function'](rva)})
report = {'evidenceId': 'BF2-NATIVE-POSTPROCESS-SEEDS-001',
          'source': str(pe['TARGET']), 'sha256': hashlib.sha256(data).hexdigest(),
          'seeds': seeds, 'programIdentifiers': programs, 'callCandidates': callers,
          'limitations': ['Static file evidence only.',
              'Byte-pattern LEA matches require instruction-boundary corroboration.',
              'Metadata names do not establish selected runtime paths.']}
output = ROOT / 'exports/lighting/native-postprocess-seeds.json'
output.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'programs': programs, 'callCandidates': callers}, indent=2))
