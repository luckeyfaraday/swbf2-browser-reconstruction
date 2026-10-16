"""Independent text-DXBC arithmetic verification, not native GPU execution."""
import ast,json,math,pathlib,random,re
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/corvette-damage-shader'
tree=ast.parse((ROOT/'tools/materials/master1uv-test.py').read_text());definitions=[x for x in tree.body if isinstance(x,(ast.FunctionDef,ast.ClassDef))]
code=ast.unparse(ast.Module(body=definitions,type_ignores=[])).replace('coord[:2]','coord[:3]')
exec(compile(code,'<shared-interpreter>','exec'))
OriginalMachine=Machine
class Machine(OriginalMachine):
 def read(self,operand):
  match=re.search(r'cb1\[r1.w \+ 0\]',operand)
  if match:operand=operand.replace(match[0],f'cb1[{int(self.reg["r1"][3])}]')
  return super().read(operand)
def sample(register,uv):
 layer=uv[2]if register==5 else 0
 return [.5+.45*math.sin(register*.739+c*1.913+uv[0]*(c+1)*.373+uv[1]*.197+layer*.47)for c in range(4)]
def formula(uv0,uv1,damage,layer):
 dirt=sample(2,[v*6 for v in uv1]);normal=sample(3,uv0);base=sample(4,uv0);detail=sample(5,[v*3 for v in uv1]+[layer]);wreck=sample(6,[v*2 for v in uv1]);weight=damage*(1+wreck[3])
 smooth=mix(2*mix(1.2*dirt[0],base[0],.529)*mix(dirt[0],detail[2],.527),.8,.767);smooth=mix(smooth,1.4*wreck[2],weight)
 xy=[2*mix(normal[j],wreck[j],weight)-1 for j in range(2)];n=[xy[j]+2*detail[j]-1 for j in range(2)]+[math.sqrt(max(0,1-sum(v*v for v in xy)))];length=math.sqrt(sum(v*v for v in n));n=[v/length for v in n]
 color=[mix(base[j]*mix(dirt[j],base[j],.573),wreck[3],weight)for j in range(3)]
 return [*color,smooth,*n,normal[2]],weight
shader=(OUT/'d92fda6613.asm').read_text();report=json.loads((OUT/'material-analysis.json').read_text());prefix=shader[shader.index('add r0.xyz, -v2'):shader.index('ld_indexable(buffer)')].strip().splitlines();color=shader[shader.index('add r1.xyz, -r2.xyzx'):shader.index('mul o3.xyz')].strip().splitlines()
rng=random.Random(2730669534);max_error=0;over_one=0;cases=3600;layers=set()
for case in range(cases):
 uv0=[rng.uniform(-4,4)for _ in range(2)];uv1=[rng.uniform(-10,10)for _ in range(2)];damage=rng.random();index=case%8
 cb=[v[:]for v in report['materials'][case%6]['constants']]
 # Alternate original defaults with synthetic nonzero lookup entries to verify
 # the shader's dynamic table indexing independently of currently zero defaults.
 if (case//8)%2:cb[index][0]=case%2
 layer=cb[index][0];layers.add(layer);m=Machine(uv0,[1,2,3],[0,1,0],cb)
 m.reg.update({'v1':[damage,0,0,1],'v2':[1,2,3,uv1[0]],'v3':[1,0,0,uv1[1]],'v4':[0,1,0,uv0[0]],'v5':[0,0,1,uv0[1]],'v6':[index,0,0,0]});m.run(prefix)
 smooth=m.reg['r1'][3];normal=m.reg['r4'][:3];metal=m.reg['r5'][2];m.run(color);observed=[*m.reg['o1'][:3],smooth,*normal,metal];expected,weight=formula(uv0,uv1,damage,layer);over_one+=weight>1
 error=max(abs(a-b)for a,b in zip(observed,expected));assert error<1e-10,(case,error,observed,expected);max_error=max(max_error,error)
assert over_one>500 and layers=={0,1}
result={'evidenceId':'LOCAL-CORVETTE-DAMAGE-EQUATIONS-001','parentEvidenceId':report['evidenceId'],'cases':cases,'maxAbsoluteError':max_error,'unsaturatedDamageCases':over_one,'arrayLayersTested':sorted(layers),'coverage':'Separate base/tiled UV, all five texture register channels, dynamic eight-entry layer lookup, unclamped damage color/smoothness/normal blend, normalized identity-TBN normal, original metalness.','limitations':['Independent six-decimal text-DXBC arithmetic interpreter, not native execution or IEEE32/FMA emulation.','Nonzero layer table fixtures are synthetic validation inputs; current source material defaults all select layer0.','Native sampler, packed tangent parity and vertex conversion remain separate.']}
(OUT/'equation-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
