"""Validate bounded native shadow producer evidence without target execution."""
import collections
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
seed = ROOT / 'tools/materials/native-dfg-pe.py'
ns = {'__file__': str(seed)}
exec(seed.read_text().split('names =')[0], ns)
data, base, to_offset = ns['data'], ns['image_base'], ns['to_offset']
source_hash = hashlib.sha256(data).hexdigest()
assert source_hash == 'd350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4'

def read(va, size):
    at = to_offset(va-base)
    return data[at:at+size]

def string(va):
    at = to_offset(va-base)
    return data[at:data.index(b'\0', at)].decode()

def retained(start, end, role):
    path = ROOT / f'exports/lighting/dfg-native-functions/{start:x}.c'
    assert path.is_file(), path
    return {'start': hex(start), 'endExclusive': hex(end), 'bytes': end-start,
            'sha256': hashlib.sha256(read(start, end-start)).hexdigest(),
            'decompilation': str(path.relative_to(ROOT)).replace('\\', '/'), 'role': role}

ranges = [
    (0x142d72180, 0x142d72823, 'WorldRenderSettings constructor defaults'),
    (0x140dac920, 0x140daca2c, 'Source cast level and requested resolution'),
    (0x140d879e0, 0x140d88823, 'Spot near/far, fade angles and unexpanded receiver matrix'),
    (0x140d9d100, 0x140d9d6ec, 'Spot source basis, view near/far and projection shape'),
    (0x140f75d50, 0x140f75de9, 'Exact 0xae0 light-record constructor and six initialized views'),
    (0x1414c6d50, 0x1414c6e8c, 'View defaults: right handed, finite far, reverse depth'),
    (0x140d79df0, 0x140d79f60, 'Leaf view copier preserves all projection flags'),
    (0x140d8cc00, 0x140d8d1cf, 'WorldRenderSettings filter quality to light-view descriptor'),
    (0x140f85240, 0x140f85f9e, 'Light-view descriptor to native GPU list builder'),
    (0x140f873a0, 0x140f87b63, 'Shadow matrix, quality, angle and request association'),
    (0x140db0fb0, 0x140db1244, 'WorldRenderSettings atlas size/cache/format configuration'),
    (0x140f51310, 0x140f513a3, 'Supported depth-format preference sequence'),
    (0x140f74fb0, 0x140f75112, 'Square atlas dimension from slot count/resolution'),
    (0x140f74b00, 0x140f74ba1, 'Atlas allocator construction'),
    (0x140f90b80, 0x140f91bf7, 'Allocated rectangle to exact GPU atlas UV and border FOV'),
    (0x140f76e20, 0x140f770ab, 'Framegraph LocalShadowAtlasTexture creation/import'),
    (0x140f714a0, 0x140f716fa, 'Allocated shadow views submitted to mesh draw processor'),
    (0x140f73c20, 0x140f73ddf, 'Local shadow draw task invokes the built mesh draw processor'),
    (0x1415d39d0, 0x1415d3ac8, 'Legacy shader constant selector 144 depth-bias wrapper'),
    (0x1415d1dc0, 0x1415d1e3c, 'Depth-bias vector from exact group tables and format bits'),
    (0x1415f6de0, 0x1415f7ada, 'Compact raster descriptor takes bias and slope from group tables'),
    (0x1415f2c50, 0x1415f2fb7, 'Named $RasterizerState key and compact raster descriptor type'),
    (0x1415e6ca0, 0x1415e70d4, 'Separate DX11 property list to raster descriptor'),
    (0x1415ec7f0, 0x1415ecbb4, 'DX11 CreateRasterizerState/CreateRasterizerState2 consumer'),
]
# Verify the declared endpoints against exact original unwind entries where available.
for a,b,_ in ranges:
    entry = ns['function'](a-base)
    if a != 0x140d79df0:  # Leaf, exact RET boundary verified in retained disassembly.
        assert entry is not None and int(entry['start'],16) == a
    # Multi-region functions can extend past their first unwind range.
    assert read(b-1,1), hex(b)

field_doc = json.loads((ROOT/'exports/lighting/native-shadow-world-settings-fields.json').read_text())
fields = {v['name']: v for v in field_doc['fields']}
expected = {'LocalLightShadowEnable': 0x485, 'LocalLightShadow16BitEnable': 0x486,
    'LocalLightShadowCacheEnable': 0x487, 'LocalLightShadowFilterQuality': 0x328,
    'LocalLightShadowResolutionLow': 0x32c, 'LocalLightShadowResolutionMedium': 0x330,
    'LocalLightShadowResolutionHigh': 0x334, 'LocalLightShadowResolutionUltra': 0x338,
    'LocalLightShadowAtlasSlotCount': 0x33c, 'LocalLightShadowAtlasSlotResolution': 0x340,
    'MaxShadowCount': 0x348, 'PunctualLightShadowLevel': 0x368}
for name, offset in expected.items():
    field = fields[name]
    assert field['offset'] == offset
    desc = int(field['descriptor'],16)
    assert string(struct.unpack('<Q',read(desc,8))[0]) == name
    assert struct.unpack('<H',read(desc+10,2))[0] == offset

ctor = read(0x142d72180,0x6a3)
defaults = {'LocalLightShadowFilterQuality': 1, 'LocalLightShadowResolutionLow': 256,
    'LocalLightShadowResolutionMedium': 512, 'LocalLightShadowResolutionHigh': 1024,
    'LocalLightShadowResolutionUltra': 2048, 'LocalLightShadowAtlasSlotCount': 32,
    'LocalLightShadowAtlasSlotResolution': 512, 'MaxShadowCount': 32}
for name,value in defaults.items():
    assert b'\xc7\x83'+struct.pack('<II',expected[name],value) in ctor
assert b'\xc7\x83\x84\x04\0\0\0\x01\x01\0' in ctor
defaults.update(LocalLightShadowEnable=True,LocalLightShadow16BitEnable=True,
                LocalLightShadowCacheEnable=False,PunctualLightShadowLevel=0)
assert read(0x140d8cfe1,13) == bytes.fromhex('418b802803000089834c050000')
assert struct.unpack('<4I',read(0x14332a080,16)) == (123,125,120,124)
formats = []
for value in [123,125,120,124,122]:
    desc = 0x144dee0f0+(value-30)*24
    assert struct.unpack('<I',read(desc+16,4))[0] == value
    formats.append({'value':value,'name':string(struct.unpack('<Q',read(desc,8))[0]),
                    'metadata':hex(desc)})

# Original executable tables and the floor-reachable RVM table are independent
# byte witnesses. This does not establish which caster permutation consumes them.
bias_bytes = read(0x14409a530, 17*4)
slope_bytes = read(0x14409a580, 17*4)
bias_values = list(struct.unpack('<17i', bias_bytes))
slope_values = list(struct.unpack('<17f', slope_bytes))
rvm_path = ROOT/'exports/materials/rvm/0.res'
with rvm_path.open('rb') as stream:
    stream.seek(5240864)
    rvm_bias = stream.read(136)
assert rvm_bias == bias_bytes+slope_bytes
bias_groups = []
for group in range(17):
    desc = 0x144df6e38+(group-11)*24
    assert struct.unpack('<I',read(desc+16,4))[0] == group
    name = string(struct.unpack('<Q',read(desc,8))[0])
    bias_groups.append({'group':group,'name':name,'metadata':hex(desc),
        'depthBias':bias_values[group],'slopeScaledDepthBias':slope_values[group]})
assert [(bias_values[i],slope_values[i]) for i in [11,12,13]] == [(-10,-4),(-1000,-4),(-1000,-4)]

light_path = ROOT/'web/public/assets/source-lights.json'
all_lights = json.loads(light_path.read_text())['lights']
lights = [l for l in all_lights if l['properties']['$type'].endswith('PbrSpotLightEntityData')
          and l['properties']['CastShadowsEnable'] and l['properties']['CastShadows']['value'] != 5]
assert len(lights) == 52
common = {'DiscRadius':0,'ShadowNearRadius':.2,'ShadowFarRadius':0,'ShadowDimmer':1,
          'ShadowFadeOutRange':10,'ShadowCacheUpdatePriority':0,'ShadowCacheUpdateCounter':0}
for light in lights:
    p = light['properties']
    assert all(p[k] == v for k,v in common.items())
    assert p['ShadowResolution']['value'] == 1 and p['CastShadows']['value'] == 0
identities = [{k:light[k] for k in ['fileGuid','classGuid','route']} for light in lights]
assert len({json.dumps(v,sort_keys=True) for v in identities}) == len(identities)
shader = ROOT/'exports/lighting/direct-shaders/type3.dxbc'
assert hashlib.sha256(shader.read_bytes()).hexdigest() == 'a61cab9738c12e1b993c32ff96dddc0f96c7942a6b4716aa4ef83e491c8c25b9'

out = {'evidenceId':'BF2-NATIVE-LOCAL-SHADOW-PRODUCER-001', 'schemaVersion':1,
    'sourceExecutableSha256':source_hash, 'functions':[retained(*v) for v in ranges],
    'settingsType':field_doc['descriptor'], 'settingsFields':{k:fields[k] for k in expected},
    'nativeConstructorDefaults':defaults, 'depthFormatPreference':formats,
    'depthBias':{'integerTable':'0x14409a530','slopeTable':'0x14409a580',
        'groups':bias_groups,'rvmBlock':'e77a8d9646','rvmOffset':5240864,
        'rvmBytes':136,'rvmSha256':hashlib.sha256(rvm_bias).hexdigest(),
        'tablesMatchRvmBytes':True,'formatToGroup':{'120':12,'121':12,'122':13,'123':11,'124':12,'125':13},
        'localProducer':['140db0fb0:configuration second word is ShaderDepthBiasGroup',
            '140f74fb0:wrapper+0x64','140f714a0:mesh draw descriptor depth-bias group'],
        'compactState':['1415f6de0:input+0x68 selects the original group tables',
            'descriptor+0 integer bias,+4 float clamp 0,+8 float slope',
            '1415f2c50:$RasterizerState key uses Dx12RvmRasterizerDesc'],
        'shaderConstant':'selector 144 -> 1415d39d0 -> 1415d1dc0 emits [bias,slope,depthFormatBits,0]',
        'selectedDx11Binding':'BF2-NATIVE-SHADOW-DX11-BIAS-001: descriptor+538 -> !dispatchListDepthBiasGroup -> all23 floor RVM builders -> 1415efd20 -> named DX11 raster properties',
        'selectedDx11Evidence':'exports/lighting/native-shadow-rvm-bias.json',
        'remainingEdge':'Native frame-selected caster shader/LOD and WebGL polygon-offset conversion are not established.'},
    'sourceLightDocument':{'path':str(light_path.relative_to(ROOT)).replace('\\','/'),
        'sha256':hashlib.sha256(light_path.read_bytes()).hexdigest()},
    'selectedPunctualShadowSpots':{'count':len(lights),'common':common,'identities':identities,
        'cacheEnabledCount':sum(l['properties']['ShadowCacheEnable'] for l in lights),
        'shadowMaxAngles':dict(collections.Counter(str(l['properties']['ShadowMaxAngle']) for l in lights)),
        'outerAngles':dict(collections.Counter(str(l['properties']['OuterAngle']) for l in lights))},
    'atlas':{'borderPixels':4,'nativeDefaultSide':3120,'sourceSlotCount':32,'sourceSlotResolution':512,
        'uv':'[(x+4)/size,(y+4)/size,(width-8)/size,(height-8)/size]',
        'casterFov':'2*atan((R+8)/R*tan(originalFov/2))'},
    'qualityBinding':['WorldRenderSettings+0x328','140d8cc00:lightView+0x54c',
        '140f85240','140f873a0:ShadowLightInfo+0xa4','type3:cb0[light*19+60].y'],
    'viewDefaults':{'recordConstructor':'0x140f75d50','recordBytes':2784,'firstViewOffset':224,
        'viewCount':6,'viewStride':240,'rightHanded':True,'reverseDepth':True,'infiniteFar':False,
        'backendDepthConvention':'view+eb copies rendererCaps+60; native base caps constructor zero, device override not captured.'},
    'excludedFalseAssociation':'140da1bd0 context+0xcf0/+0x54c is a different structure; not the local-light binding.',
    'limitations':['Native defaults are not an original runtime capture.',
        'Native depth-bias groups/tables, floor RVM to DX11 binding and comparison sampler are recovered separately; cross-API bias equivalence remains open.',
        'Atlas packing priorities, culling, cache scheduling and actual per-view light set remain unwired.',
        'No browser shadow activation or hardware GPU work performed.']}
(ROOT/'exports/lighting/native-shadow-producer.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'functions':len(ranges),'settingsFields':len(expected),'lights':len(lights),
                  'defaultAtlasSide':3120,'cacheLights':out['selectedPunctualShadowSpots']['cacheEnabledCount']}))
