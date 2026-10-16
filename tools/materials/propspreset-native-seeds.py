"""Bounded file-backed PE seeds for the native FG generator (no execution)."""
import os
import bisect
import hashlib
import json
import pathlib
import re
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
TARGET = pathlib.Path(os.environ.get('BF2_GAME_DIR', 'C:/Games/Star Wars - Battlefront 2'), 'starwarsbattlefrontii.exe')
data = TARGET.read_bytes()
pe = struct.unpack_from('<I', data, 0x3c)[0]
assert data[pe:pe+4] == b'PE\0\0'
section_count = struct.unpack_from('<H', data, pe+6)[0]
optional_size = struct.unpack_from('<H', data, pe+20)[0]
optional = pe + 24
assert struct.unpack_from('<H', data, optional)[0] == 0x20b
image_base = struct.unpack_from('<Q', data, optional+24)[0]
sections = []
for i in range(section_count):
    at = optional + optional_size + 40*i
    virtual_size, rva, size, offset = struct.unpack_from('<IIII', data, at+8)
    sections.append({'name': data[at:at+8].rstrip(b'\0').decode(),
                     'rva': rva, 'virtualSize': virtual_size,
                     'offset': offset, 'size': size,
                     'characteristics': struct.unpack_from('<I', data, at+36)[0]})


def to_rva(offset):
    section = next(s for s in sections if s['offset'] <= offset < s['offset']+s['size'])
    return section['rva'] + offset - section['offset']


def to_offset(rva):
    section = next(s for s in sections if s['rva'] <= rva < s['rva']+s['size'])
    return section['offset'] + rva - section['rva']


pdata_rva, pdata_size = struct.unpack_from('<II', data, optional+112+3*8)
pdata_offset = to_offset(pdata_rva)
functions = sorted(struct.iter_unpack('<III', data[pdata_offset:pdata_offset+pdata_size]))
starts = [entry[0] for entry in functions]


def function(rva):
    index = bisect.bisect_right(starts, rva) - 1
    if index < 0 or not functions[index][0] <= rva < functions[index][1]:
        return None
    start, end, unwind = functions[index]
    return {'start': hex(image_base+start), 'endExclusive': hex(image_base+end),
            'fileOffset': to_offset(start), 'bytes': end-start,
            'unwindRva': hex(unwind)}


names = [b'PermutationTreeCompressionEnabled', b'RvmSerializedDb_ns_RvmPermutationSet', b'RvmSerializedDb_ns_RvmPermutation', b'SvptExternalPermutation']
seeds=[]
for name in names:
 for match in re.finditer(rb'(?<=\x00)'+re.escape(name)+rb'(?=\x00)',data):
  offset=match.start();seeds.append({'name':name.decode(),'fileOffset':offset,'address':hex(image_base+to_rva(offset)),'xrefs':[]})
by_address={int(s['address'],16):s for s in seeds}
for section in sections:
 if not section['characteristics'] & 0x20000000:continue
 for match in re.finditer(rb'[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]',data[section['offset']:section['offset']+section['size']]):
  offset=section['offset']+match.start();rva=section['rva']+match.start();target=image_base+rva+7+struct.unpack_from('<i',data,offset+3)[0]
  if target in by_address:by_address[target]['xrefs'].append({'address':hex(image_base+rva),'function':function(rva)})
for seed in seeds:
 seed['pointerCandidates']=[hex(image_base+to_rva(m.start())) for m in re.finditer(re.escape(struct.pack('<Q',int(seed['address'],16))),data)]
out=ROOT/'exports/materials/propspreset-native';out.mkdir(exist_ok=True)
report={'evidenceId':'BF2-PROPSPRESET-NATIVE-SEEDS-001','target':str(TARGET),'targetSha256':hashlib.sha256(data).hexdigest(),'seeds':seeds,'limitations':['Byte pattern candidates require instruction corroboration; no target execution.']}
(out/'seeds.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(seeds,indent=2))
