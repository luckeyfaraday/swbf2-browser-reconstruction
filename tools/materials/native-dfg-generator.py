"""Extract exact named FG generator stages from the shipped program database."""
import ctypes
import hashlib
import json
import pathlib
import re
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
source = ROOT/'exports/lighting/dfg-shaderprogramdb/0.res'
data = source.read_bytes()
out = ROOT/'exports/lighting/dfg-generator'
out.mkdir(exist_ok=True)
library = ctypes.WinDLL('C:/Windows/System32/d3dcompiler_47.dll')
disassemble = library.D3DDisassemble
disassemble.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint,
                       ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
disassemble.restype = ctypes.c_long


def assembly(bytecode):
    buffer = ctypes.create_string_buffer(bytecode)
    blob = ctypes.c_void_p()
    result = disassemble(buffer, len(bytecode), 0, None, ctypes.byref(blob))
    assert result >= 0, hex(result & 0xffffffff)
    table = ctypes.cast(blob, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    pointer = ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)(table[3])(blob)
    size = ctypes.WINFUNCTYPE(ctypes.c_size_t, ctypes.c_void_p)(table[4])(blob)
    text = ctypes.string_at(pointer, size).rstrip(b'\0').decode()
    ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(table[2])(blob)
    return text


records = []
for path in (b'Dx11/PBRComputePreIntegratedFG', b'Dx12/PBRComputePreIntegratedFG'):
    for match in re.finditer(re.escape(path)+b'\0', data):
        at = match.end()
        length = struct.unpack_from('<I', data, at)[0]
        bytecode = data[at+4:at+4+length]
        assert bytecode[:4] == b'DXBC' and struct.unpack_from('<I', bytecode, 24)[0] == length
        text = assembly(bytecode)
        stage = next(line for line in text.splitlines() if re.fullmatch(r'[pvhdgc]s_[0-9]_[0-9]', line))
        name = path[:4].decode().lower()+'-'+stage
        (out/(name+'.dxbc')).write_bytes(bytecode)
        (out/(name+'.asm')).write_text(text)
        records.append({'sourceName': path.decode(), 'nameOffset': match.start(),
                        'bytecodeOffset': at+4, 'bytecodeBytes': length,
                        'stage': stage, 'file': name+'.dxbc',
                        'sha256': hashlib.sha256(bytecode).hexdigest()})
assert len(records) == 4
program_hash = 5381
for value in b'ShaderProgram_PBRComputePreIntegratedFG':
    program_hash = ((program_hash*33) ^ value) & 0xffffffff
assert program_hash == 0xc416e8c3
hash_entries = [m.start() for m in re.finditer(re.escape(struct.pack('<I', program_hash)), data)]
assert len(hash_entries) == 2
assert all(struct.unpack_from('<I', data, at+4)[0] == 122 for at in hash_entries)
report = {'evidenceId': 'BF2-NATIVE-FG-GENERATOR-001',
          'sourceResource': str(source.relative_to(ROOT)).replace('\\', '/'),
          'sourceSha256': hashlib.sha256(data).hexdigest(),
          'nativeDrawFunction': '0x141567e60',
          'programName': 'ShaderProgram_PBRComputePreIntegratedFG',
          'programNameHash': hex(program_hash), 'hashTableOffsets': hash_entries,
          'hashTableValues': [122, 122], 'stages': records,
          'limitations': ['Stage records are length-delimited original DXBC with exact source program names.',
                         'Full database loader table semantics are not yet independently decoded.',
                         'Original DXBC is disassembled offline, not executed.']}
(out/'manifest.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
