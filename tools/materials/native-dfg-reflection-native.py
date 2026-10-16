"""Verify bounded executable ranges linking reflection mip setup to shaders."""
import os
import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = pathlib.Path(os.environ.get('BF2_GAME_DIR', 'C:/Games/Star Wars - Battlefront 2'), 'starwarsbattlefrontii.exe')
data = SOURCE.read_bytes()
pe = struct.unpack_from('<I', data, 0x3c)[0]
count, optional_size = struct.unpack_from('<H', data, pe+6)[0], struct.unpack_from('<H', data, pe+20)[0]
optional = pe+24
base = struct.unpack_from('<Q', data, optional+24)[0]
sections = []
for index in range(count):
    at = optional+optional_size+index*40
    virtual, rva, size, offset = struct.unpack_from('<IIII', data, at+8)
    sections.append((rva,size,offset))


def offset(address):
    rva = address-base
    start,size,raw = next(section for section in sections if section[0] <= rva < section[0]+section[1])
    return raw+rva-start


def bytes_at(address, size):
    return data[offset(address):offset(address)+size]


ranges = {
    'deferredConstantsAndDispatch': (0x140f45b90,0x140f4736f),
    'resolutionToMipCount': (0x140f8c460,0x140f8c484),
    'mipCountToBias': (0x140f7b600,0x140f7b612),
    'filterConfiguration': (0x141562bb0,0x1415632dc),
    'mipToPerceptualRoughness': (0x14148ee10,0x14148ee7d),
    'perceptualRoughnessToAlpha': (0x141490960,0x141490965),
    'convolveDispatch': (0x141564d50,0x141564f9b),
    'bakedTextureReuseOrReconvolution': (0x140d85750,0x140d85b31),
}
assert bytes_at(0x140f7b600,18).hex() == 'b801000000ffc9d3e00f57c0f3480f2ac0c3'
assert bytes_at(0x141490960,5).hex() == 'f30f59c0c3'
assert struct.unpack('<f',bytes_at(0x14301a310,4))[0] == 2
assert struct.unpack('<f',bytes_at(0x143012f68,4))[0] == 1
assert bytes_at(0x143012fc0,4) == b'\0\0\0\x80'
thunk = bytes_at(0x141e73026,6)
assert thunk[:2] == b'\xff\x25'
iat_address = 0x141e73026+6+struct.unpack_from('<i',thunk,2)[0]
hint_name_rva = struct.unpack('<Q',bytes_at(iat_address,8))[0]
assert bytes_at(base+hint_name_rva+2,5) == b'powf\0'
assert bytes_at(0x141564e6a,5) == b'\xba'+struct.pack('<I',0x455c9474)
records = []
for role,(start,end) in ranges.items():
    records.append({'role':role,'start':hex(start),'endExclusive':hex(end),
                    'fileOffset':offset(start),'bytes':end-start,
                    'sha256':hashlib.sha256(bytes_at(start,end-start)).hexdigest(),
                    'decompilation':'exports/lighting/dfg-native-functions/'+hex(start)[2:]+'.c'})
levels = [{'mip':m,'perceptualRoughness':((2**m-1)/32)**.5,'alpha':(2**m-1)/32} for m in range(6)]
report = {'evidenceId':'BF2-NATIVE-REFLECTION-SAMPLING-001','target':str(SOURCE),
          'targetSha256':hashlib.sha256(data).hexdigest(),'functions':records,
          'powfThunk':{'address':'0x141e73026','iat':hex(iat_address),'hintNameRva':hex(hint_name_rva),'name':'powf'},
          'programHash':'0x455c9474','programName':'ShaderProgram_PBRConvolveSpecularCubeMapCompute',
          'equations':{'filterPerceptualRoughness':'sqrt((2^mip-1)/2^(mipCount-1))',
                       'filterAlpha':'(2^mip-1)/2^(mipCount-1)',
                       'resolutionToMipCount':'floor(log2(resolution))-1',
                       'localMipmapBias':'2^(mipCount-1)'},
          'source128MipLevels':levels,
          'limitations':['Static decompilation and exact original instruction checks, not native game execution.',
                         'Selected runtime local cube-array resolution and inverse LRV capture exposure are not captured.',
                         'Baked texture mips are copied only when dimensions and mipcount match; otherwise native code reconvolves.']}
(ROOT/'exports/lighting/dfg-reflection-shaders/native-executable.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'evidenceId':report['evidenceId'],'functions':len(records),'source128MipLevels':levels},indent=2))
