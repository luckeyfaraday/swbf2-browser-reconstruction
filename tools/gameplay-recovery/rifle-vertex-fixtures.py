"""Original mesh vertices + retained WARP particles for original VS execution."""
import hashlib
import json
import math
from pathlib import Path
import struct
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'exports/rifle-trail/vertex-warp';OUT.mkdir(exist_ok=True)
mesh=ROOT/'exports/rifle-trail/render-material-vertex'
manifest=json.loads((mesh/'manifest.json').read_text(encoding='utf-8'))['records'][0]
attrs={row['usage']:row for row in manifest['extraAttributes']}
pos=(mesh/attrs['Pos']['file']).read_bytes();uv=(mesh/attrs['TexCoord0']['file']).read_bytes()
source=ROOT/'exports/rifle-trail/particle-warp'
records=(source/'input.bin').read_bytes();particles=(source/'output.bin').read_bytes()
metadata=json.loads((source/'inputs.json').read_text(encoding='utf-8'));steps=metadata['steps']
selected=[(c,s,None) for c in [0,12,24,36,48,60,72,84,96,97,100,106,112,130,147] for s in [0,2,8]]
# Exercise the near-camera flare with unchanged native particle/property data.
# The original fixed cameras leave every flare inactive; retain them and add
# positions around the actual segment midpoint at multiple angular/distance gates.
for c,s in [(12,2),(12,8),(36,2),(60,8),(97,8),(106,8),(130,8),(147,8)]:
    for direction in [(1,2,3),(-2,1,-1),(1,-3,2),(-1,-2,-3)]:
        for distance in [0.5,2,8,19,21]:
            selected.append((c,s,(direction,distance)))
vertices=manifest['vertexCount'];record_size=4+912+128+steps*(912+624)
data=bytearray(struct.pack('<4I',0x31565752,len(selected),vertices,0))
for i in range(vertices):data+=pos[i*12:i*12+12]+uv[i*8:i*8+8]
cases=[]
for index,(c,s,near) in enumerate(selected):
    case=metadata['cases'][c];begin=16+c*record_size+4
    if s:begin+=912+128+(s-1)*(912+624)
    emitter=bytearray(records[begin:begin+912])
    struct.pack_into('<I',emitter,208,0);struct.pack_into('<I',emitter,216,1);struct.pack_into('<II',emitter,248,0,88)
    particle=particles[(c*(steps+1)+s)*88:(c*(steps+1)+s+1)*88]
    cb1=bytearray(48);cb2=bytearray(608)
    time=case['time']+case['dt']*s;struct.pack_into('<f',cb2,0,time)
    for row in range(3):struct.pack_into('<4f',cb2,(2+row)*16,*[float(column==row) for column in range(4)])
    for row in range(4):struct.pack_into('<4f',cb2,(14+row)*16,*[float(column==row) for column in range(4)])
    camera=[10,-5,7] if index%2 else [4,12,-3]
    if near:
        values=struct.unpack('<16f12e',particle)
        up=values[4:7];up_length=math.sqrt(sum(x*x for x in up));up=[x/up_length for x in up]
        width,length=struct.unpack_from('<2f',emitter,272)
        segment_start=max(-length,-values[22]-width*.15)
        midpoint=[values[12+i]+up[i]*segment_start*.5 for i in range(3)]
        direction,distance=near;norm=math.sqrt(sum(x*x for x in direction))
        camera=[midpoint[i]+direction[i]*distance/norm for i in range(3)]
    struct.pack_into('<3f',cb2,37*16,*camera)
    data+=emitter+particle+cb1+cb2;cases.append({'particleCase':c,'step':s,'time':time,'camera':camera,
        'cameraProbe':{'direction':near[0],'distance':near[1]} if near else 'original-fixed-offset'})
(OUT/'input.bin').write_bytes(data)
(OUT/'inputs.json').write_text(json.dumps({'evidenceId':'BF2-RIFLE-VERTEX-WARP-001','cases':cases,'vertices':vertices,
    'sourceInputsSha256':hashlib.sha256(records).hexdigest(),'sourceParticlesSha256':hashlib.sha256(particles).hexdigest(),
    'positionSha256':hashlib.sha256(pos).hexdigest(),'uvSha256':hashlib.sha256(uv).hexdigest(),
    'limitations':['Synthetic explicit CB1/CB2; identity camera basis/VP and offset camera position are arithmetic probes, not a coherent native camera capture.']},indent=2),encoding='utf-8')
print(json.dumps({'cases':len(selected),'vertices':vertices,'bytes':len(data)}))
