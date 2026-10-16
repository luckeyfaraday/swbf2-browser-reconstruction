"""Bounded static direct-light producer evidence; original executable is read only."""
import collections
import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
ns = {'__file__': str(ROOT/'tools/materials/native-dfg-pe.py')}
exec((ROOT/'tools/materials/native-dfg-pe.py').read_text().split('names =')[0], ns)
data, base, offset = ns['data'], ns['image_base'], ns['to_offset']
assert hashlib.sha256(data).hexdigest() == 'd350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4'

def read(va, size):
    at = offset(va-base)
    return data[at:at+size]

def q(va): return struct.unpack('<Q', read(va,8))[0]

def text(va):
    at = offset(va-base)
    return data[at:data.index(0,at)].decode()

def fields(va, is_struct=False):
    count = struct.unpack('<H',read(va+0x22,2))[0]
    table = q(va+(0x50 if is_struct else 0x30))
    return {text(q(table+24*i)): (q(table+24*i+8)>>16)&65535 for i in range(count)}

schemas = {}
for name, va, kind in [('DataBusPeer',0x144a2fa00,False),
    ('PbrSphereLightEntityData',0x144b884b0,False),('PbrSpotLightEntityData',0x144b86eb0,False),
    ('PbrSphereLightDynamicState',0x144b765b0,True),('PbrSpotLightDynamicState',0x144b76850,True)]:
    assert text(q(va)) == name
    schemas[name] = {'address':hex(va),'fields':fields(va,kind)}
assert schemas['DataBusPeer']['fields']['Flags'] == 0x18
chains = {
 'sphere': {'Color':[0x70,0,0x50,0x40,16], 'Intensity':[0xb0,0x40,0x80],
   'AttenuationRadius':[0xb8,0x48,0x88,0x70,12], 'AttenuationOffset':[0xbc,0x4c,0x90,0x74,28],
   'Dimmer':[0xe0,0x70,0x8c], 'SphereRadius':[0xa8,0x38,0xf8,0xac4]},
 'spot': {'Color':[0x70,0,0x50,0x40,16], 'Intensity':[0xc0,0x50,0x80],
   'AttenuationRadius':[0xc8,0x58,0x88,0x70,12], 'AttenuationOffset':[0xcc,0x5c,0x90,0x74,28],
   'Dimmer':[0xf0,0x80,0x8c], 'DiscRadius':[0xa8,0x38,0xf8,0xab8],
   'InnerAngle':[0xac,0x3c,0xfc,0xabc,80], 'OuterAngle':[0xb0,0x40,0x100,0xac0,84]},
}
for shape, properties in chains.items():
    for name, values in properties.items():
        assert schemas[f'Pbr{shape.title()}LightEntityData']['fields'][name] == values[0]
        assert schemas[f'Pbr{shape.title()}LightDynamicState']['fields'][name] == values[1]
for address, value in [(0x144df9958,0),(0x144df9970,1)]:
    assert struct.unpack('<I',read(address+16,4))[0] == value
assert text(q(0x144df9958)) == 'LightUnitType_LuminousPower'
assert text(q(0x144df9970)) == 'LightUnitType_Luminance'

ranges = [
 (0x14103ea30,0x14103f054),(0x142d928f0,0x142d9321f),(0x142d933a0,0x142d93d84),
 (0x142d2d220,0x142d2d382),(0x142d2dce0,0x142d2de5e),
 (0x14019deb0,0x14019df41),(0x140196360,0x14019639d),
 (0x140df6870,0x140df6b17),(0x140df6b20,0x140df6dd6),
 (0x140f34180,0x140f34248),(0x140f34250,0x140f34354),
 (0x140d879e0,0x140d88823),(0x140f8ce10,0x140f8ce23),
 (0x140f7b620,0x140f7b63a),(0x140f7b640,0x140f7b672),
 (0x140f7b6a0,0x140f7b6bd),(0x140f7b6c0,0x140f7b6dd),
 (0x140f85240,0x140f85f9e),(0x140f86150,0x140f8630d),
]
functions = []
for start,end in ranges:
    file = ROOT/f'exports/lighting/dfg-native-functions/{start:x}.c'
    assert file.exists()
    functions.append({'start':hex(start),'endExclusive':hex(end),
      'sha256':hashlib.sha256(read(start,end-start)).hexdigest(), 'decompilation':str(file.relative_to(ROOT))})
# Independent instruction-byte checks for the two relevant dynamic defaults.
assert b'\x48\xc7\x81\x94\x00\x00\x00\x00\x00\x80\x3f' in read(0x142d2d220,354)
assert b'\x48\xc7\x81\xa4\x00\x00\x00\x00\x00\x80\x3f' in read(0x142d2dce0,382)
constants = {hex(a):struct.unpack('<f',read(a,4))[0] for a in
  [0x14301ee78,0x14301ee88,0x14301ee8c,0x143302dec,0x14303cae8,0x14301a308,
   0x143302df0,0x14302cd08,0x14301eea0,0x14301eea4,0x14301eea8]}
assert [constants[hex(a)] for a in [0x14301eea0,0x14301eea4,0x14301eea8]] == [1,1,1]
lights_path = ROOT/'web/public/assets/source-lights.json'
lights = json.loads(lights_path.read_text())['lights']
groups, eligible = collections.Counter(), []
for light in lights:
    p = light['properties']; kind = p['$type'].split('.')[-1]
    if kind not in ['PbrSphereLightEntityData','PbrSpotLightEntityData']: reason='unsupported-shape-or-unit'
    elif p.get('SphereRadius',p.get('DiscRadius')) != 0 or p['LightUnit']['value']==1: reason='finite-area-emitter'
    elif p['CastShadows']['value']!=5 and p['CastShadowsEnable']: reason='shadow-quality-unresolved'
    elif (p['Flags']>>27)&3: reason='property-overrides-unresolved'
    else:
        reason='supported';eligible.append(light)
    groups[reason]+=1
assert groups == {'supported':217,'finite-area-emitter':4,'shadow-quality-unresolved':52,
                  'property-overrides-unresolved':49,'unsupported-shape-or-unit':18}
identities = [f"{v['fileGuid']}/{v['classGuid']}/{v['route']}" for v in eligible]
assert len(set(identities)) == 217
report = {'evidenceId':'BF2-NATIVE-DIRECT-PRODUCER-002','sourceExecutableSha256':hashlib.sha256(data).hexdigest(),
 'schemas':schemas,'fieldChains':chains,
 'chainColumns':['EntityData offset','DynamicState offset','staging offset','runtime record offset','GPU offset (transformed where documented)'],
 'functions':functions,'constants':constants,
 'sourceLightsSha256':hashlib.sha256(lights_path.read_bytes()).hexdigest(), 'classificationCounts':dict(groups),
 'eligibleKinds':dict(collections.Counter(v['properties']['$type'].split('.')[-1] for v in eligible)),
 'eligibleIesCount':sum(bool(v['properties']['IESProfile']) for v in eligible),'eligibleIdentities':identities,
 'punctualPredicate':'source radius == 0 && source LightUnit != Luminance(1), before IES overrides unit.',
 'iesIntensity':'mask ? (Intensity*IntensityMultiplier)*header[4]/header[8] : header[4]*IESMultiplier; force unit1; multiply Color and Dimmer.',
 'radiometry':'unit1 keeps scalar; other units divide scalar by area*pi. Sphere punctual area4; spot punctual area1; finite sphere4*pi*r*r; finite disc pi*r*r.',
 'spotAngles':'outer=clamp(sourceOuter,1,179); inner=min(sourceInner,sourceOuter-float32(.001)); then native cosine ramp.',
 'limitations':['Static initial/exported values only. Resolver/context and later entity property connections were not executed.',
   'Conservative selector excludes descriptors with source Flags bits27/28; absence of those bits does not prove later runtime activation.',
   'Native finite/punctual record flag proven; exact view list insertion/permutation choice not observed.',
   'Source finite area BRDF, native shadow quality/atlas, per-view fades/order remain unwired.',
   'Old mid-function artifacts 140d87b30.c and 140fcb090.c are superseded; they are not evidence in this report.']}
(ROOT/'exports/lighting/direct-producer-evidence.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'functions':len(functions),'counts':dict(groups),'eligibleIes':report['eligibleIesCount']}))
