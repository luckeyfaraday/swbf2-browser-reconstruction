"""Independent native text-DXBC arithmetic comparison for emissive Master1UV."""
import ast,json,math,pathlib,random,re
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/master1uv-emissive-shader'
# Reuse only the independent interpreter and compact nonemissive equation definitions.
# Do not execute the other family's verification or mutate its evidence.
tree=ast.parse((ROOT/'tools/materials/master1uv-test.py').read_text())
exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x,(ast.FunctionDef,ast.ClassDef))],type_ignores=[]),'<shared-math>','exec'))
shader=(OUT/'5ffbbd02c2.asm').read_text();report=json.loads((OUT/'material-analysis.json').read_text())
prefix=shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines()
color=shader[shader.index('mad_sat r0.w, r5.w'):shader.index('mad r0.xyz, r1.xyzx, cb1[0]')].strip().splitlines()
rng=random.Random(292172631);max_error=0;cases=4500;low=high=0
for case in range(cases):
 uv=[rng.uniform(-20,20)for _ in range(2)];pos=[rng.uniform(-500,500)for _ in range(3)];normal=[rng.uniform(-1,1)for _ in range(3)];length=math.sqrt(sum(v*v for v in normal));normal=[v/length for v in normal]
 cb=report['materials'][case%15]['constants'];m=Machine(uv,pos,normal,cb);m.run(prefix);smooth=m.reg['r1'][3];world_normal=m.reg['r2'][:3]
 mask=sat(sample(5,uv)[2]*1.111111-.111111);low+=mask==0;high+=mask>.9
 m.run(color);observed=[*m.reg['o1'][:3],smooth,*world_normal,m.reg['o2'][1],*[v*cb[0][0]for v in m.reg['r1'][:3]]]
 base=formula(uv,pos,normal,cb[3:]);expected=[*[mix(base[j],cb[2][j],mask)for j in range(3)],*base[3:8],*[mask*cb[1][j]*cb[0][0]for j in range(3)]]
 error=max(abs(a-b)for a,b in zip(observed,expected));assert error<1e-9,(case,error,observed,expected);max_error=max(max_error,error)
# Exercise native sample swizzles with independent blue/alpha edges and colored emission.
original_sample=sample;edge_cases=0
for blue in [0,.099,.1,.1001,.5,1,1.2]:
 outputs=[]
 for alpha in [0,.5,1]:
  def sample(register,uv):
   value=original_sample(register,uv)
   if register==5:value[2],value[3]=blue,alpha
   return value
  cb=[v[:]for v in report['materials'][0]['constants']];cb[1]=[.2,.5,.9,0]
  m=Machine([.4,.7],[1,2,3],[0,1,0],cb);m.run(prefix);m.run(color)
  observed=[*m.reg['o1'][:3],*[v*cb[0][0]for v in m.reg['r1'][:3]]]
  base=formula([.4,.7],[1,2,3],[0,1,0],cb[3:]);mask=sat(blue*1.111111-.111111)
  expected=[*[mix(base[j],cb[2][j],mask)for j in range(3)],*[mask*cb[1][j]*cb[0][0]for j in range(3)]]
  assert max(abs(a-b)for a,b in zip(observed,expected))<1e-9
  outputs.append(observed);edge_cases+=1
 assert outputs[0]==outputs[1]==outputs[2]
sample=original_sample
assert low>300 and high>300
result={'evidenceId':'LOCAL-MASTER1UV-EMISSIVE-EQUATIONS-001','parentEvidenceId':report['evidenceId'],'shader':'5ffbbd02c2','cases':cases,'maxAbsoluteError':max_error,'zeroEmissionCases':low,'highEmissionCases':high,'channelEdgeCases':edge_cases,'coverage':'All15 exact source constant sets; base color and emission blend, smoothness, normalized world normal under identity TBN, metalness and linear emission RGB; distinct UV-dependent texture channels.','limitations':['Independent text-DXBC interpreter, not native execution or IEEE32/FMA emulation.','Text disassembler literals use six decimals on both sides; production GLSL retains exact native float32 literals.','Native SH/BRDF, texture filtering and packed tangent parity are verified separately or remain unresolved.']}
(OUT/'equation-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
