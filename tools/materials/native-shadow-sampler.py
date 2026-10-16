"""Verify the exact deferred-light sampler producer and DX11 conversion."""
from pathlib import Path
import hashlib
import json
import struct

ROOT = Path(__file__).resolve().parents[2]
seed = ROOT/'tools/materials/native-dfg-pe.py'
ns = {'__file__': str(seed)}
exec(seed.read_text().split('names =')[0],ns)
data, base, to = ns['data'], ns['image_base'], ns['to_offset']
assert hashlib.sha256(data).hexdigest() == 'd350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4'
def read(a,n):
    o=to(a-base)
    return data[o:o+n]

windows = [
 (0x140f45c22,'33f6','ESI is zero for native sampler construction'),
 (0x140f462bc,'8975f0c745f41000000048c745f801000000897500c645fc01c745e40200000048c745e802000000c745d802000000c745dc02000000c745e002000000','comparison sampler at RBP-28'),
 (0x140f4620a,'89b5a0000000c785a40000001000000048c785a80000000100000089b5b0000000c7859400000002000000c7859800000002000000c7859c0000000100000089b588000000c7858c00000002000000c7859000000002000000','IES sampler at RBP+88'),
 (0x140f46eee,'4c8d8d8800000041b802000000418bd7488bcfff9018030000488b074c8d4dd841b803000000418bd7488bcfff9018030000','bind IES s2 and comparison s3 through context+318'),
 (0x1415a42e1,'807f2400740dc70394000000c7431805000000','comparison-enabled forces D3D filter94 and GREATER5'),
 (0x14159b444,'488d05158aea01488907','DX11 context constructor installs exact vtable'),
 (0x140f46d89,'bababbf3f5','deferred compute program selector'),
 (0x142de7636,'81f9babbf3f57444','selector resolves to original DeferredTiledLightingCS name'),
]
for a,h,role in windows:
    assert read(a,len(bytes.fromhex(h)))==bytes.fromhex(h),role
program_name=b'ShaderProgram_DeferredTiledLightingCS\0'
assert read(0x14340f8e8,len(program_name))==program_name
assert struct.unpack('<Q',read(0x143443e60+0x318,8))[0]==0x1415b9e80
assert struct.unpack('<I',read(0x143329cf4,4))[0]==5 # compute stage
asm=(ROOT/'exports/lighting/direct-shaders/type3.asm').read_text()
for name,slot in [('g_linearLongitudeWrapSampler','s2'),('g_shadowmapSampler','s3')]:
    assert any(name in line and slot in line for line in asm.splitlines())

functions=[(0x140f45b90,0x140f4736f),(0x14159b3f0,0x14159b70e),
    (0x1415b9e80,0x1415b9ff4),(0x1415a41c0,0x1415a42ff),
    (0x1415affc0,0x1415b0068),(0x1415b17b0,0x1415b18c3)]
# The complete retained function hashes fix provenance even when an unwind
# range includes padding. Instruction windows above fix the semantic joins.
records=[]
for a,b in functions:
    p=ROOT/f'exports/lighting/dfg-native-functions/{a:x}.c'
    assert p.exists()
    records.append({'start':hex(a),'endExclusive':hex(b),'sha256':hashlib.sha256(read(a,b-a)).hexdigest(),'path':p.relative_to(ROOT).as_posix()})
doc={'evidenceId':'BF2-NATIVE-SHADOW-SAMPLER-001','schemaVersion':1,
 'sourceExecutableSha256':hashlib.sha256(data).hexdigest(),
 'programSelector':'0xf5f3bbba','program':'ShaderProgram_DeferredTiledLightingCS',
 'producer':'140f45b90','contextVtable':'0x143443e60','samplerMethodOffset':'0x318',
 'functions':records,'instructionAssertions':[{'address':hex(a),'hex':h,'role':r} for a,h,r in windows],
 'shadow':{'slot':3,'sourceWords':[2,2,2,2,2,0,0,16,1,1,0],
   'dx11':{'filter':148,'filterName':'COMPARISON_MIN_MAG_LINEAR_MIP_POINT','addressUVW':[3,3,3],
     'addressName':'CLAMP','mipLODBias':0,'maxAnisotropy':1,'comparisonFunc':5,'comparisonName':'GREATER',
     'borderColor':[0,0,0,0],'minLOD':0,'maxLOD':16},
   'comparison':'referenceDepth > storedDepth; equality fails',
   'quality1':'Nine GatherCmp offsets {-2,0,2} squared, explicit fractional weights; sampler filtering does not replace gather arithmetic',
   'otherQuality':'SampleCmpLevelZero with bilinear comparisons; referenceDepth >= 1 returns one'},
 'ies':{'slot':2,'sourceWords':[0,2,2,2,2,1,0,16,1,0,0],
   'dx11':{'filter':20,'filterName':'MIN_MAG_LINEAR_MIP_POINT','addressUVW':[1,3,3],
     'addressNames':['WRAP','CLAMP','CLAMP'],'comparisonFunc':8,'comparisonName':'ALWAYS','minLOD':0,'maxLOD':16}},
 'limitations':['Native sampler construction and exact named program association are proven; this is not an original frame capture.',
   'Hardware comparison/filter precision can differ from CPU arithmetic; original WARP shader validation is a separate fixture.',
   'No runtime shadow activation or native game execution.']}
(ROOT/'exports/lighting/native-shadow-sampler.json').write_text(json.dumps(doc,indent=2)+'\n')
print(json.dumps({'shadowFilter':doc['shadow']['dx11']['filterName'],'comparison':doc['shadow']['comparison'],'ies':doc['ies']['dx11']['addressNames']}))
