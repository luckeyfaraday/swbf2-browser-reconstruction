"""Independent source DXBC text arithmetic check for nonmetal emissive walls."""
import ast,json,math,pathlib,random,re
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'exports/materials/master1uv-emissive-nonmetal-shader'
tree=ast.parse((ROOT/'tools/materials/master1uv-test.py').read_text())
exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x,(ast.FunctionDef,ast.ClassDef))],type_ignores=[]),'<shared-math>','exec'))
shader=(OUT/'17069bc692.asm').read_text()
report=json.loads((OUT/'material-analysis.json').read_text())
prefix=shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines()
color=shader[shader.index('mul r0.w, cb1[0]'):shader.index('mad r0.xyz, r3.xyzx')].strip().splitlines()
scalar=['mov o2.xyz, l(0,0,0.500000,0)']
rng=random.Random(2996852712)
max_error=0;low=high=0;cases=3000

def check(uv,pos,normal,cb):
    m=Machine(uv,pos,normal,cb)
    m.run(prefix)
    smooth=m.reg['r1'][3];world_normal=m.reg['r2'][:3]
    m.run(color);m.run(scalar)
    observed=[*m.reg['o1'][:3],smooth,*world_normal,m.reg['o2'][1],*[v*m.reg['r0'][3] for v in m.reg['r3'][:3]]]
    mask=sat(sample(5,uv)[2]*1.111111-.111111)
    base=formula(uv,pos,normal,cb[4:])
    expected=[*[mix(base[j],cb[2][j],mask) for j in range(3)],*base[3:7],0,*[mask*cb[1][j]*cb[0][0]*cb[3][0] for j in range(3)]]
    error=max(abs(a-b) for a,b in zip(observed,expected))
    assert error<1e-9,(error,observed,expected)
    return error,mask,observed

for case in range(cases):
    uv=[rng.uniform(-20,20) for _ in range(2)]
    pos=[rng.uniform(-500,500) for _ in range(3)]
    normal=[rng.uniform(-1,1) for _ in range(3)];length=math.sqrt(sum(v*v for v in normal));normal=[v/length for v in normal]
    cb=[v[:] for v in report['materials'][0]['constants']]
    if case%3: cb[3][0]=rng.uniform(0,3);cb[1][:3]=[rng.random() for _ in range(3)]
    error,mask,_=check(uv,pos,normal,cb)
    max_error=max(max_error,error);low+=mask==0;high+=mask>.9
original_sample=sample;edges=0
for blue in [0,.099,.1,.1001,.5,1,1.2]:
    results=[]
    for alpha in [0,.5,1]:
        def sample(register,uv):
            value=original_sample(register,uv)
            if register==5:value[2],value[3]=blue,alpha
            return value
        cb=[v[:] for v in report['materials'][0]['constants']]
        cb[1][:3]=[.2,.5,.9];cb[3][0]=.3
        error,_,observed=check([.4,.7],[1,2,3],[0,1,0],cb)
        max_error=max(max_error,error);results.append(observed);edges+=1
    assert results[0]==results[1]==results[2]
sample=original_sample
for case in range(128):
    normal=[rng.uniform(-1,1) for _ in range(3)]
    length=math.sqrt(sum(v*v for v in normal));scale=rng.uniform(.15,.95)
    normal=[v/length*scale for v in normal]
    cb=[v[:] for v in report['materials'][0]['constants']];cb[3][0]=rng.uniform(0,3)
    error,_,_=check([rng.uniform(-20,20),rng.uniform(-20,20)],[1,2,3],normal,cb)
    max_error=max(max_error,error)
assert low>200 and high>200
result={'evidenceId':'LOCAL-MASTER1UV-EMISSIVE-NONMETAL-EQUATIONS-001','parentEvidenceId':report['evidenceId'],'shader':'17069bc692','cases':cases,'maxAbsoluteError':max_error,'zeroEmissionCases':low,'highEmissionCases':high,'channelEdgeCases':edges,'coverage':'Original section constants plus varied source emission multiplier/color; source UV-dependent texture reads/swizzles, layered color, smoothness, normalized normal, zero metalness and linear emission; blue/alpha edge independence.','limitations':['Independent text-DXBC interpreter, not native execution or IEEE32/FMA emulation.','Text-disassembly literals use six decimals on both sides; generated production GLSL retains exact source float32 literals.','Native tangent frame, prelighting and runtime pass selection remain separate.']}
result['nonunitInterpolatedNormalCases']=128
(OUT/'equation-validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result))
