"""Original PropsNonmetal PS material/SH replay and unchanged WARP comparison."""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/propsnonmetal-shader'
SPEC = importlib.util.spec_from_file_location('volcanic', Path(__file__).with_name('volcanic-object-equations.py'))
E = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(E)
E.LITERALS = E.P.Machine(OUT / '1e3d99cec3.dxbc')
SHADER = E.LITERALS.asm
SHA = lambda value: hashlib.sha256(value).hexdigest()


def compact(uv, position, frame, coefficients, mutation=None):
    base, normal = E.sample(2, uv), E.sample(3, uv)
    tangent = [normal[0] * 2 - 1, normal[1] * 2 - 1]
    tangent.append(math.sqrt(max(0, 1 - E.dot(tangent, tangent))) if mutation != 'normalBlue' else 2 * normal[2] - 1)
    world = E.unit([E.dot(row, tangent) for row in frame])
    smoothness = base[3] if mutation != 'wrongSmoothness' else normal[3]
    view = E.unit([camera - value for camera, value in zip([7,3,2], position)])
    lighting = E.prelighting(coefficients, world, view, smoothness, 0 if mutation == 'noBroadenedSpecular' else 1)
    sky = max(0, coefficients[0][3] + sum(world[i] * coefficients[i+1][3] for i in range(3)))
    return [*base[:3], smoothness, *world, sky, *lighting]


def original(uv, position, frame, coefficients):
    machine = E.Machine(uv, position, frame[0], [[0]*4 for _ in range(4)])
    machine.coefficients = coefficients
    machine.reg['v5'] = [0,0,0,0]
    machine.reg['cb2[40]'] = [1,0,0,0]
    for i in range(3):
        machine.reg[f'v{i+2}'][:3] = frame[i]
    machine.run(SHADER[SHADER.index('add r0.xyz, -v1'):SHADER.index('ge r0.xy,')].strip().splitlines())
    return [*machine.reg['r3'], *machine.reg['r2'][:3], machine.reg['o2'][3], *machine.reg['o3'][:3]]


def replay():
    rng = random.Random(0x1e3d99)
    maximum = 0
    mutations = {name: 0 for name in ['normalBlue','wrongSmoothness','noBroadenedSpecular']}
    for index in range(2000):
        uv = [rng.uniform(-5,5),rng.uniform(-5,5)]
        position = [rng.uniform(-50,50) for _ in range(3)]
        frame = [[rng.uniform(.5,1.5) if i==j else rng.uniform(-.5,.5) for j in range(3)] for i in range(3)]
        coefficients = [[rng.uniform(20,200) if band==0 else rng.uniform(-15,15) for _ in range(3)] + [rng.uniform(-.2,.4)] for band in range(9)]
        a,b = original(uv,position,frame,coefficients),compact(uv,position,frame,coefficients)
        error = max(abs(x-y) for x,y in zip(a,b))
        assert error < 1e-8, (index,error)
        maximum = max(maximum,error)
        for mutation in mutations:
            wrong = compact(uv,position,frame,coefficients,mutation)
            mutations[mutation] += max(abs(x-y) for x,y in zip(b,wrong)) > 1e-5
    result = {'evidenceId':'BF2-PROPSNONMETAL-EQUATIONS-001','cases':2000,'maximumAbsoluteError':maximum,'mutationDetections':mutations,
        'literalBits':E.LITERALS.literals,'sharedSHHelper':'Exact compact Volcanic prelighting at scale1, final normalized source world normal and CS alpha smoothness.',
        'limits':['CPU double precision instruction replay, not original hardware execution or filtering.','Positive-specular zero dominant direction/opposing half-vector retains native undefined normalization.']}
    (OUT/'equation-validation.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


def fixture():
    rng = random.Random(0x1e3d99)
    records=[]
    for index in range(96):
        frame=[[rng.uniform(.5,1.5) if i==j else rng.uniform(-.35,.35) for j in range(3)] for i in range(3)]
        frame[0]=[v*(-1 if index%3==0 else 1) for v in frame[0]]
        position=[rng.uniform(-12,12) for _ in range(3)]
        textures=[[rng.uniform(.05,.95) for _ in range(4)] for _ in range(4)]
        coefficients=[[rng.uniform(20,200) if band==0 else rng.uniform(-15,15) for _ in range(3)]+[rng.uniform(-.2,.4)] for band in range(9)]
        values=sum(frame,[])+position+[.25,.75]+[0]*16+sum(textures,[])+sum(coefficients,[])
        assert len(values)==82
        records.append(struct.pack('<82f',*values))
    raw=struct.pack('<III',0x314f5650,len(records),82)+b''.join(records)
    (OUT/'warp-input.bin').write_bytes(raw)
    print(json.dumps({'cases':len(records),'inputSha256':SHA(raw)}))


def warp():
    inputs,outputs=(OUT/'warp-input.bin').read_bytes(),(OUT/'warp-output.bin').read_bytes()
    report=json.loads((OUT/'warp-execution.json').read_text())
    assert report['inputSha256']==SHA(inputs) and report['outputSha256']==SHA(outputs)
    assert report['pixelShaderSha256']==SHA((OUT/'1e3d99cec3.dxbc').read_bytes())
    count=struct.unpack_from('<I',inputs,4)[0]
    assert count==report['cases']==96 and len(outputs)==count*16*4
    maximum,relative=0,0
    lane_maximum=[0]*16
    for index in range(count):
        v=list(struct.unpack_from('<82f',inputs,12+index*82*4))
        frame=[v[i:i+3] for i in [0,3,6]]
        textures=[v[i:i+4] for i in range(30,46,4)]
        coefficients=[v[i:i+4] for i in range(46,82,4)]
        E.sample=E.scope['sample']=lambda register,uv:textures[register-2]
        result=compact(v[12:14],v[9:12],frame,coefficients)
        reference=original(v[12:14],v[9:12],frame,coefficients)
        assert max(abs(x-y) for x,y in zip(result,reference))<1e-8
        x,y,z=result[4:7]
        if abs(z)>=abs(x) and abs(z)>=abs(y):face,u,w=(5 if z<0 else 4),(-x if z<0 else x),-y
        elif abs(y)>=abs(x):face,u,w=(3 if y<0 else 2),x,(-z if y<0 else z)
        else:face,u,w=(1 if x<0 else 0),(z if x<0 else -z),-y
        target=[u*.5+.5,w*.5+.5,result[3],0,*result[:3],face*E.constant('0.166667'),0,0,.5,result[7],*result[8:11],0]
        for lane,(actual,expected) in enumerate(zip(struct.unpack_from('<16f',outputs,index*64),target)):
            error=abs(actual-expected)
            assert error<5e-4+5e-5*abs(expected),(index,lane,actual,expected,error)
            maximum=max(maximum,error);relative=max(relative,error/max(1,abs(expected)));lane_maximum[lane]=max(lane_maximum[lane],error)
    result={'evidenceId':'BF2-PROPSNONMETAL-PS-WARP-CHECK-001','nativePixelShaderExecuted':True,'backend':'D3D11 CPU WARP',
        'inputSha256':SHA(inputs),'outputSha256':SHA(outputs),'pixelShaderSha256':report['pixelShaderSha256'],'cases':count,'comparedScalars':count*16,
        'maximumAbsoluteError':maximum,'maximumRelativeWithUnitFloor':relative,'maximumAbsolutePerMrtLane':lane_maximum,
        'sharedSHHelper':'Volcanic compact prelighting equations at scale1 reproduce this original PS; source final normal is normalized here.',
        'limits':report['limitations']}
    (OUT/'warp-validation.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--prepare',action='store_true');parser.add_argument('--warp',action='store_true');args=parser.parse_args()
    fixture() if args.prepare else warp() if args.warp else replay()
