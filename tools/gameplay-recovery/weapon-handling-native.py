"""Bounded static PE seeds for GunSway; file bytes, not target execution."""
import os
import bisect
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
TARGET = Path(os.environ.get('BF2_GAME_DIR', 'C:/Games/Star Wars - Battlefront 2'), 'starwarsbattlefrontii.exe')
DATA = TARGET.read_bytes()
PE = struct.unpack_from('<I', DATA, 0x3c)[0]
assert DATA[PE:PE+4] == b'PE\0\0'
OPTIONAL = PE + 24
BASE = struct.unpack_from('<Q', DATA, OPTIONAL+24)[0]
sections = []
for i in range(struct.unpack_from('<H', DATA, PE+6)[0]):
    at = OPTIONAL + struct.unpack_from('<H', DATA, PE+20)[0] + 40*i
    virtual, rva, size, offset = struct.unpack_from('<IIII', DATA, at+8)
    sections.append({'name': DATA[at:at+8].rstrip(b'\0').decode(), 'rva': rva,
                     'virtualSize': virtual, 'size': size, 'offset': offset,
                     'characteristics': struct.unpack_from('<I', DATA, at+36)[0]})


def address(offset):
    s = next(s for s in sections if s['offset'] <= offset < s['offset']+s['size'])
    return BASE + s['rva'] + offset - s['offset']


def offset(va):
    s = next(s for s in sections if s['rva'] <= va-BASE < s['rva']+s['size'])
    return s['offset'] + va-BASE-s['rva']


pdata_rva, pdata_size = struct.unpack_from('<II', DATA, OPTIONAL+112+3*8)
functions = sorted(struct.iter_unpack('<III', DATA[offset(BASE+pdata_rva):offset(BASE+pdata_rva)+pdata_size]))
starts = [row[0] for row in functions]


def function(va):
    i = bisect.bisect_right(starts, va-BASE)-1
    if i < 0 or not functions[i][0] <= va-BASE < functions[i][1]:
        return None
    start, end, unwind = functions[i]
    return {'start': hex(BASE+start), 'endExclusive': hex(BASE+end),
            'fileOffset': offset(BASE+start), 'bytes': end-start, 'unwindRva': hex(unwind)}


def pointers(va):
    return [m.start() for m in re.finditer(re.escape(struct.pack('<Q', va)), DATA)]


def main():
    terms = ['GunSwayData', 'GunSwayDispersionData', 'GunSwayRecoilData',
             'PowerOfDispersionRandom', 'NoFireTimeThreshold', 'GunSwayDispersionAction',
             'CameraRecoilData']
    seeds = []
    targets = {}
    for term in terms:
        for match in re.finditer(rb'(?<=\x00)' + term.encode() + rb'(?=\x00)', DATA):
            va = address(match.start())
            refs = pointers(va)
            seed = {'name': term, 'fileOffset': match.start(), 'address': hex(va),
                    'absolutePointers': [{'address': hex(address(p)), 'fileOffset': p} for p in refs]}
            seeds.append(seed)
            targets[va] = {'owner': term, 'kind': 'string', 'references': []}
            for p in refs:
                targets[address(p)] = {'owner': term, 'kind': 'string-pointer-slot', 'references': []}
    for s in sections:
        if not s['characteristics'] & 0x20000000:
            continue
        block = DATA[s['offset']:s['offset']+s['size']]
        # Candidate RIP-relative LEA/MOV; confirm boundaries during disassembly.
        for match in re.finditer(rb'[\x48-\x4f][\x8d\x8b][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]', block):
            p = s['offset']+match.start()
            va = address(p)
            target = va+7+struct.unpack_from('<i', DATA, p+3)[0]
            if target in targets:
                targets[target]['references'].append({'address': hex(va), 'bytes': DATA[p:p+7].hex(), 'pdataFunction': function(va)})
    report = {'evidenceId': 'BF2-WEAPON-HANDLING-NATIVE-SEEDS-001', 'target': str(TARGET),
              'sha256': hashlib.sha256(DATA).hexdigest(), 'imageBase': hex(BASE),
              'sections': sections, 'seeds': seeds,
              'ripCandidates': [{'address': hex(va), **row} for va, row in targets.items() if row['references']],
              'runtimeObserved': False,
              'limitations': ['Byte-pattern references require instruction-boundary confirmation.',
                'Reflection names and data references do not by themselves establish angular units or native equations.',
                'Only seven exact handling terms and their direct absolute pointer slots were followed.']}
    out = ROOT/'exports/weapon-handling-native'
    out.mkdir(exist_ok=True)
    (out/'seeds.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'seeds': seeds, 'ripCandidates': report['ripCandidates']}, indent=2))


if __name__ == '__main__':
    main()
