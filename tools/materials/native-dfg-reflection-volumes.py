"""Pin native reflection runtime-record packing and CPU ordering evidence.

Reads the original executable and retained shader disassembly. No target execution,
frame capture, EBX-to-runtime interpretation, or shared renderer edits.
"""
import os
import hashlib
import json
import pathlib
import re
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = pathlib.Path(os.environ.get('BF2_GAME_DIR', 'C:/Games/Star Wars - Battlefront 2'), 'starwarsbattlefrontii.exe')
data = SOURCE.read_bytes()
digest = hashlib.sha256(data).hexdigest()
assert digest == 'd350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4'
pe = struct.unpack_from('<I', data, 0x3c)[0]
optional = pe + 24
base = struct.unpack_from('<Q', data, optional+24)[0]
count = struct.unpack_from('<H', data, pe+6)[0]
optional_size = struct.unpack_from('<H', data, pe+20)[0]
sections = [struct.unpack_from('<IIII', data, optional+optional_size+40*i+8) for i in range(count)]


def offset(address):
    rva = address-base
    _, start, size, raw = next(section for section in sections if section[1] <= rva < section[1]+section[2])
    return raw+rva-start


def source_bytes(address, size):
    at = offset(address)
    return data[at:at+size]


def exact_call(address, target):
    encoded = source_bytes(address, 5)
    assert encoded[0] == 0xe8 and address+5+struct.unpack_from('<i',encoded,1)[0] == target


exact_call(0x140f86693, 0x14024a620)
exact_call(0x140f866f0, 0x140249460)
exact_call(0x140fe8c66, 0x140f45b90)
assert source_bytes(0x140f8cfc0,8).hex() == '8b1239110f92c0c3'  # return uint(*a)<uint(*b)
constants = {'fadeEpsilon': (0x14301a304, .0001), 'radiusMargin': (0x14301a308, .01),
             'skySharpenMultiplier': (0x14301af28, 10),
             'sphereFourPi': (0x143302dec, 12.566370964050293), 'sphereThird': (0x143087ff4, .3333333432674408)}
constant_records = {}
for role,(address,value) in constants.items():
    decoded = struct.unpack('<f',source_bytes(address,4))[0]
    assert decoded == struct.unpack('<f',struct.pack('<f',value))[0]
    constant_records[role] = {'address':hex(address),'float32':decoded}

ranges = {
    'runtimeRecordToGpuRecord': (0x140f86570,0x140f86a92),
    'normalizeBasisAndRepairHandedness': (0x14024a620,0x14024a795),
    'rigidInverse': (0x140249460,0x1402495b7),
    'cullAndAssignVolumeKey': (0x140f7f7d0,0x140f7fc34),
    'sortAndUploadMainPath': (0x140f8fb00,0x140f9087f),
    'ascendingUnsignedKeyComparator': (0x140f8cfc0,0x140f8cfc8),
    'allocationWithoutMainSortPath': (0x140f7f120,0x140f7f2db),
    'deferredDispatchCopiesGpuRecords': (0x140f45b90,0x140f4736f),
    'renderPassCopiesExposureInputs': (0x140fe87d0,0x140fe8c8e),
    'runtimeRecordUpdate': (0x140daf810,0x140dafb17),
}
functions = [{'role':role,'start':hex(start),'endExclusive':hex(end),
              'fileOffset':offset(start),'bytes':end-start,
              'sha256':hashlib.sha256(source_bytes(start,end-start)).hexdigest(),
              'disassembly':None if role=='ascendingUnsignedKeyComparator' else f'exports/lighting/dfg-native-functions/{start:x}.c'}
             for role,(start,end) in ranges.items()]

shader_path = ROOT/'exports/lighting/dfg-reflection-shaders/local-type4.dxbc'
assert hashlib.sha256(shader_path.read_bytes()).hexdigest() == '37dcf31fe69ffa9afef92b320e9208b74049210d16d4a967f3bde425be5c33d5'
assembly = shader_path.with_suffix('.asm').read_text()
fields = [
    ('pos',0,'runtime.position-cameraOrigin'),
    ('sqrAttenuationRadius',12,'(sphere ? extent.x+expand+.01 : length(extent+expand)+.01)^2'),
    ('invTransform',16,'three rows of rigid inverse after basis normalization and camera-origin subtraction'),
    ('extend',64,'runtime[0x40].xyz; EBX scale linkage unresolved'),
    ('textureIndex',76,'float(uint16(runtime+0x90))'),
    ('extendPlusExpandDistance',80,'extent+runtime[0xbc]'),
    ('invInfluenceFadeDistance',92,'1/max(runtime[0xb8],float32(.0001))'),
    ('sideFadePositive',96,'runtime[0x60].xyz'),
    ('influenceFadeDistance',108,'runtime[0xb8]'),
    ('sideFadeNegative',112,'runtime[0x70].xyz'),
    ('IBLType',124,'float(int32(runtime+0x98)); zero=sphere, other=box'),
    ('localOffset',128,'runtime[0x50].xyz; EBX LocalOffset conversion unresolved'),
    ('influenceExpandDistance',140,'runtime[0xbc]'),
    ('influenceFadeExtend',144,'runtime[0x80].xyz-(sphere?extent:extent+expand)'),
    ('skipSkyVisibilityAsAO',156,'runtime.byte[0xa5] ? 0 : 1'),
    ('extendMinusFadeDistance',160,'extent+expand-fade'),
    ('skipSkyVisibilityAsMask',172,'runtime.byte[0xa6] ? 0 : 1'),
    ('skyVisibilityScale',176,'1+10*runtime[0xa8]'),
    ('skyVisibilityOffset',180,'-(skyVisibilityScale-1)*runtime[0xac]'),
    ('skipProxyReprojection',184,'runtime.byte[0xa4] ? 0 : 1'),
    ('unused',188,'0'),
]
for name,relative,_ in fields:
    match = re.search(r'\b'+name+r'\s*;\s*// Offset:\s*(\d+)',assembly)
    assert match and int(match[1]) == 704+relative, name

report = {
    'evidenceId':'BF2-NATIVE-REFLECTION-VOLUME-001','target':str(SOURCE),'targetSha256':digest,
    'runtimeRecordBytes':224,'shaderRecordBytes':192,'functions':functions,'constants':constant_records,
    'shader':{'path':str(shader_path.relative_to(ROOT)).replace('\\','/'),
              'sha256':hashlib.sha256(shader_path.read_bytes()).hexdigest(),'firstRecordConstantByteOffset':704},
    'fields':[{'name':name,'relativeByteOffset':relative,'producer':formula} for name,relative,formula in fields],
    'transform':{'sourceBasis':'three columns at runtime offsets0,16,32; translation at48',
                 'normalization':'each column / its length; right negated when dot(cross(right,up),forward)<0',
                 'relativeTranslation':'runtime.translation-renderContext.cameraOrigin',
                 'inverseRows':'[normalizedAxis.xyz,-dot(normalizedAxis,relativeTranslation)]',
                 'shear':'No Gram-Schmidt orthogonalization in original helper.'},
    'cpuOrder':{'key':'sphere: r*float32(4*pi)*r*r*float32(1/3); box: ex*2*2*ey*2*ez',
                'storage':'float32 at first4bytes of each8-byte cull entry; source index at+4; category bytes at+6,+7',
                'comparison':'unsigned32 ascending, identical to numeric ascending for finite positive keys',
                'scope':'Main path 0x140f8fb00 list param2[5], count at(*param2)+0x38, comparator0x140f8cfc0.',
                'limits':'Equal-key order, GPU tile-list order, selected runtime path and cap/visibility outcomes remain unobserved.'},
    'exposure':{'observed':'0x140fe87d0 copies renderPass+0x660 vec4; its fourth float becomes dispatch param4+0x68, then reciprocal g_invLrvExposureMultiplier.',
                'unknown':'The producer/type and selected value of that render-pass field are unresolved. Numeric offset matches in unrelated objects are not source associations.'},
    'browserHelper':'web/src/source-reflection-volume-data.js',
    'validation':'Seven Node tests, including1000 independent Three rigid-inverse comparisons. Scalar packing is algebraic with final float32 storage; not native instruction execution identity.',
    'boundaries':['No recovered path from an active EBX reflection entity into the224-byte runtime record.',
                  'Original source extent, offset, side-fade and influence-anchor unit conversions remain unresolved.',
                  'Runtime record basis does not yet prove baked cubemap capture basis relative to an EBX transform.',
                  'Static retained source programs and CPU paths; no captured original native frame.',
                  'The browser helper is standalone and has no imports from existing runtime modules.'],
}
out = ROOT/'exports/lighting/dfg-reflection-volumes.json'
out.write_text(json.dumps(report,indent=2))
print(json.dumps({'evidenceId':report['evidenceId'],'functions':len(functions),'shaderFields':len(fields),'output':str(out)}))
