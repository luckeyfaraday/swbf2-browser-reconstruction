"""Validate and publish bounded direct-light/IES evidence without game execution."""
import collections
import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
source = (ROOT/'tools/materials/native-dfg-pe.py').read_text()
ns = {'__file__': str(ROOT/'tools/materials/native-dfg-pe.py')}
exec(source[:source.index('names =')], ns)
data, base, offset = ns['data'], ns['image_base'], ns['to_offset']
assert hashlib.sha256(data).hexdigest() == 'd350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4'

def read(va, size):
    at = offset(va-base)
    return data[at:at+size]

assert struct.unpack('<Q', read(0x144dee0f0,8))[0] == 0x14340b188
assert read(0x14340b188,23).rstrip(b'\0') == b'RenderFormat_R16_FLOAT'
assert struct.unpack('<I', read(0x144dee100,4))[0] == 30
assert struct.unpack('<Q', read(0x144df0e40,8))[0] == 0x1434097f0
assert struct.unpack('<H', read(0x144df0e4a,2))[0] == 24
assert struct.unpack('<H', read(0x144df0e62,2))[0] == 28
assert b'\xc7\x43\x18\x80\x00\x00\x00' in read(0x142de2b00,47)
assert b'\xc7\x43\x1c\x40\x00\x00\x00' in read(0x142de2b00,47)
assert b'\xc7\x44\x24\x20\x1e\x00\x00\x00' in read(0x140a87360,124)

ranges = [(0x140f85240,0x140f85f9e),(0x140f86150,0x140f8630d),
          (0x140f85fa0,0x140f86143),(0x1464afe30,0x1464aff08),
          (0x14144f1c0,0x14144f2f0),(0x14145e550,0x14145e69f),
          (0x140a87360,0x140a873dc),(0x141453c30,0x141453ce0),
          (0x14144b3d0,0x14144b5ec),(0x142de2b00,0x142de2b2f)]
functions = [{'start':hex(a),'endExclusive':hex(b),'sha256':hashlib.sha256(read(a,b-a)).hexdigest(),
              'decompilation':f'exports/lighting/dfg-native-functions/{a:x}.c'} for a,b in ranges]
lights = json.loads((ROOT/'web/public/assets/source-lights.json').read_text())['lights']
ies_lights = [v for v in lights if v['properties'].get('IESProfile')]
assert len(ies_lights) == 53
for light in ies_lights:
    ref = light['properties']['IESProfile']
    assert ref['$external'] == '6ebdd766-34cc-11e7-ae3d-ae12865b6fab'
    assert ref['classGuid'] == 'a0573a2a-e928-fed7-45df-68775c56324e'
folder = ROOT/'exports/lighting/direct-ies'
ebx = json.loads(next((folder/'ebx').glob('*.json')).read_text())
assert ebx['entry']['type'] == 'IesProfileAsset'
assert ebx['asset']['objects'][0]['SourceResource']['$resource'] == '12614494969977180257'
resource = (folder/'raw/12614494969977180257.res').read_bytes()
assert hashlib.sha256(resource).hexdigest() == '9bc7c5e110883ae386307917222666023482daf9a537c0063415d2f8b334a45b'
assert len(resource) == 32804
size, scalar4, scalar8, relative = struct.unpack_from('<IffQ',resource)
assert size == 128 and relative == 32 and struct.unpack_from('<I',resource,32800)[0] == 12
payload = resource[relative:32800]
assert len(payload) == size*size*2
values = [v[0] for v in struct.iter_unpack('<e',payload)]
assert all(len(set(values[i*size:(i+1)*size])) == 1 for i in range(size))
output = ROOT/'web/public/assets/lighting'
output.mkdir(exist_ok=True)
name = 'source-ies-lamp-01.r16f.bin'
(output/name).write_bytes(payload)
manifest = {'evidenceId':'BF2-NATIVE-DIRECT-LIGHT-001', 'sourceAsset':ebx['entry'],
  'sourceClassGuid':ebx['asset']['root'], 'sourceResourceId':'12614494969977180257',
  'sourceResourceSha256':hashlib.sha256(resource).hexdigest(),
  'nativeFormat':{'value':30,'name':'RenderFormat_R16_FLOAT','enumMetadataAddress':'0x144dee0f0'},
  'width':size,'height':size,'mipCount':1,'channels':1,'url':f'/assets/lighting/{name}',
  'payloadBytes':len(payload),'payloadSha256':hashlib.sha256(payload).hexdigest(),
  'byteOrder':'little-endian','sourcePayloadOffset':relative,'flipY':False,
  'sourceHeaderScalars':{'offset4':scalar4,'offset8':scalar8,'meaning':'Native color scalar: mask ? Intensity*IntensityMultiplier*offset4/offset8 : offset4*IESMultiplier; then unit=Luminance. Applied to light color, not texels. Physical header labels remain unknown.'},
  'producerEvidenceId':'BF2-NATIVE-DIRECT-PRODUCER-002',
  'coordinates':'u=atan2(localUp,localLeft)/(2*pi); v=0.5*localForward+0.5; light-to-surface normalized direction.',
  'sampler':{'sourceName':'g_linearLongitudeWrapSampler','binding':'s2','level':0,
             'browser':'Linear min/mag, Repeat U, Clamp V. Exact native sampler descriptor not recovered; Clamp V remains inferred.'},
  'rowLongitudeInvariant':True, 'minimum':min(values),'maximum':max(values),
  'selectedMapLightCount':len(ies_lights),
  'limitations':['Raw source profile, consumer and color conversion are proven. Physical header labels and actual native sampler descriptor remain unresolved.',
                 'No native frame or browser GPU test was run for this standalone loader.']}
(output/'source-ies.json').write_text(json.dumps(manifest,indent=2))
summary = {'evidenceId':manifest['evidenceId'],'sourceExecutableSha256':hashlib.sha256(data).hexdigest(),
  'functions':functions,'shaders':json.loads((ROOT/'exports/lighting/direct-shaders/manifest.json').read_text()),
  'lightCount':len(lights),'types':dict(collections.Counter(v['properties']['$type'] for v in lights)),
  'nonzeroAttenuationOffsetCount':sum(v['properties'].get('AttenuationOffset',0)!=0 for v in lights),
  'iesMultiplierCounts':dict(collections.Counter(str(v['properties']['IESMultiplier']) for v in ies_lights)),
  'ies':manifest,
  'distance':'max(1-(distanceSquared*inverseRadiusSquared)^2,0)^2 / max(distanceSquared+attenuationOffset,float32(0.0001))',
  'cone':'scale=1/max(cos(innerDegrees*pi/360)-cos(outerDegrees*pi/360),float32(.001)); offset=-cos(outerDegrees*pi/360)*scale; saturate(cosine*scale+offset)^2',
  'producerEvidenceId':'BF2-NATIVE-DIRECT-PRODUCER-002',
  'unresolved':['Runtime property overrides, activation and per-view fades/order.',
                'Source area BRDF and actual selected native frame permutation.',
                'Shadow atlas construction/quality selection and native IES sampler descriptor.']}
(ROOT/'exports/lighting/direct-light-evidence.json').write_text(json.dumps(summary,indent=2))
print(json.dumps({'functions':len(functions),'lights':len(lights),'iesLights':len(ies_lights),'publishedBytes':len(payload),'range':[min(values),max(values)]}))
