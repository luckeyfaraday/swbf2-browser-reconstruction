"""Controlled inputs for the unchanged original rifle particle compute shaders."""
import hashlib
import itertools
import json
import math
import random
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'exports/rifle-trail/particle-warp'
OUT.mkdir(exist_ok=True)
graph_path = next((ROOT/'exports/rifle-trail/ebx').glob('*EG_BlasterBolt_Walrus_Generic*json'))
effect_path = next((ROOT/'exports/rifle-trail/ebx').glob('*FX_BlasterBolt_Rifle_Red*json'))
graph = next(o for o in json.loads(graph_path.read_text(encoding='utf-8'))['asset']['objects'] if o['$type'].endswith('.EmitterGraph'))
entity = next(o for o in json.loads(effect_path.read_text(encoding='utf-8'))['asset']['objects'] if o['$type'].endswith('.EmitterGraphEntityData'))
overrides = {p['PropertyId']: p['Value'] for p in entity['EmitterGraphParams']}
params = [[overrides.get(p['PropertyId'], p['Value'])[a] for a in 'xyzw'] for p in graph['EmitterGraphParams']]

def floats(target, offset, *values):
    struct.pack_into('<'+'f'*len(values), target, offset, *values)

def properties(case, age):
    b = bytearray(912)
    angle = case['angle']; c, s = math.cos(angle), math.sin(angle)
    # Orthonormal source matrix, local Y is particle travel direction.
    ct, st = math.cos(case.get('tilt', 0)), math.sin(case.get('tilt', 0))
    axes = [[c, -s*ct, s*st], [s, c*ct, -c*st], [0, st, ct]]
    trans = [case['origin'][i] + axes[i][1]*700*age for i in range(3)]
    for matrix in [0, 64, 128]:
        for row in range(3): floats(b, matrix+row*16, *axes[row], trans[row])
        floats(b, matrix+48, 0, 0, 0, 1)
    floats(b,192,age,0,.25,case.get('life',100000))
    struct.pack_into('<III',b,208,0,1,1)
    struct.pack_into('<II',b,248,0,88)
    for i, vector in enumerate(params): floats(b,272+i*16,*vector)
    if 'defaultSpeed' in case: floats(b,368,case['defaultSpeed'])
    floats(b,496,case['mode'])
    floats(b,784,case['speed'],0,0,0)
    floats(b,800,*case['fallback'],0)
    floats(b,816,*case['muzzle'],0)
    return b

cases=[]
for angle, speed, muzzle_kind, mode, depth in itertools.product([0,.71],[1,700],['unset','separate'],[0,1,2,3,4,5],[0,1]):
    origin=[.1,.2,.3]
    muzzle=[1,1,1] if muzzle_kind=='unset' else [-.15,-.25,.1]
    cases.append(dict(angle=angle,speed=speed,muzzle=muzzle,fallback=[1,1,1],mode=mode,depth=depth,origin=origin,dt=1/60,time=1.234))
# Explicit fallback-vector and zero-velocity branches, with two frame sizes.
for dt, fallback in itertools.product([1/90,1/30],[[1,1,1],[-.5,-.5,.1]]):
    cases.append(dict(angle=.31,speed=0,muzzle=[1,1,1],fallback=fallback,mode=0,depth=0,origin=[.1,.2,.3],dt=dt,time=2.345))
rng=random.Random(0x2017)
for i in range(48):
    cases.append(dict(angle=rng.uniform(-3,3),tilt=rng.uniform(-1,1),speed=rng.choice([1,0,80,700]),
        muzzle=[-.15,-.25,.1],fallback=[1,1,1],mode=i%6,depth=i%2,origin=[.1,.2,.3],
        dt=rng.choice([1/90,1/60,1/30]),time=rng.uniform(0,100),defaultSpeed=100 if i%7==0 else 0))
for life in [0,-1]:
    cases.append(dict(angle=.3,speed=700,muzzle=[1,1,1],fallback=[1,1,1],mode=0,depth=0,
        origin=[.1,.2,.3],dt=1/60,time=0,life=life))
steps=16
data=bytearray(struct.pack('<4I',0x31505752,len(cases),steps,0))
for case in cases:
    data += struct.pack('<f',case['depth'])+properties(case,0)
    cb=bytearray(128);struct.pack_into('<II',cb,0,0,1);floats(cb,8,case['time'],case['dt']);data+=cb
    for step in range(1,steps+1):
        age=step*case['dt'];data+=properties(case,age)
        cb=bytearray(624);floats(cb,0,case['time']+age,case['dt'])
        for row in range(4): floats(cb,16+row*16,*[float(row==column) for column in range(4)])
        data+=cb
(OUT/'input.bin').write_bytes(data)
document={'evidenceId':'BF2-RIFLE-PARTICLE-WARP-001','cases':cases,'steps':steps,'sourceGraphParams':params,
 'sources':[{'file':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [graph_path,effect_path]],
 'limitations':['Graph override matching by PropertyId and graph-order GPU packing are reconstructed input bindings; shader reads/outputs are original.',
 'Synthetic matrices, travel, time, effect parameters and depth; unused previous/inverse matrices are intentionally identical.']}
(OUT/'inputs.json').write_text(json.dumps(document,indent=2),encoding='utf-8')
print(json.dumps({'cases':len(cases),'steps':steps,'bytes':len(data)}))
