"""Independent native text-DXBC arithmetic versus compact array equations."""
import ast,json,math,pathlib,random,re
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/array2uv-shader'
report=json.loads((OUT/'material-analysis.json').read_text());tree=ast.parse((ROOT/'tools/materials/master1uv-test.py').read_text())
nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))and n.name in('Machine','sample','sat','mix')];scope={'math':math,'re':re}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'shared-dxbc-interpreter','exec'),scope)
Machine=scope['Machine']
def sample(register,uv):
 return [.5+.49*math.sin(register*.739+channel*1.913+uv[0]*(channel+1)*.373+uv[1]*.197)for channel in range(4)]
scope['sample']=sample
def array_sample(coords):
 layer=min(9,max(0,math.floor(coords[2]+.5)))
 return [v for v in sample(3+layer*.461,coords[:2])]
class ArrayMachine(Machine):
 def run(self,lines):
  for line in lines:
   if line.startswith('sample_indexable(texture2darray)'):
    args=[x.strip()for x in re.split(r',\s*(?![^()]*\))',line.split(' ',1)[1])];name,mask=args[0].split('.');values=array_sample(self.read(args[1]))
    swizzle=args[2].split('.')[1]
    for c in mask:self.reg[name]['xyzw'.index(c)]=values['xyzw'.index(swizzle['xyzw'.index(c)])]
   else:super().run([line])
shader=(OUT/'52d055444c.asm').read_text();prefix=shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines()
color=['mul r1.xyz, r3.zzzz, r4.xyzx','mad r1.xyz, r1.xyzx, l(2.000000, 2.000000, 2.000000, 0.000000), -r4.xyzx','mad o1.xyz, r1.xyzx, r1.wwww, r4.xyzx']
assert all(line in shader for line in color)
rng=random.Random(2612997987);cases=4200;max_error=0;layers=set()
for case in range(cases):
 uv0=[rng.uniform(-12,12)for _ in range(2)];uv1=[rng.uniform(-2,3)for _ in range(2)];cb=[v[:]for v in report['materials'][case%14]['constants']]
 # Additional weights verify raw normal weight versus saturated response weight.
 if case%7==0:cb[1][0]=rng.uniform(-2,6)
 machine=ArrayMachine(uv1,[0,0,0],[1,0,0],cb);machine.reg.update({'v2':[1,0,0,uv1[1]],'v3':[0,1,0,uv0[0]],'v4':[0,0,1,uv0[1]]});machine.run(prefix)
 smooth=machine.reg['r2'][2];normal=machine.reg['r5'][:3];metal=machine.reg['r2'][3];machine.run(color)
 nam=sample(2,uv1);detail=array_sample([uv0[j]*cb[0][j]for j in range(2)]+[nam[2]*10]);base=sample(4,uv1);base_normal=sample(2,[max(0,min(1,v))for v in uv0]);xy=[2*v-1 for v in base_normal[:2]]
 n=[xy[j]+(2*detail[j]-1)*cb[1][0]for j in range(2)]+[math.sqrt(max(0,1-sum(v*v for v in xy)))];length=math.sqrt(sum(v*v for v in n));n=[v/length for v in n];w=max(0,min(1,cb[1][0]));factor=1+w*(2*detail[2]-1)
 expected=[*[v*factor for v in base[:3]],base[3]*factor,*n,nam[3]];observed=[*machine.reg['o1'][:3],smooth,*normal,metal]
 error=max(abs(a-b)for a,b in zip(expected,observed));assert error<1e-10,(case,error);max_error=max(max_error,error);layers.add(min(9,max(0,math.floor(nam[2]*10+.5))))
assert len(layers)==10
result={'evidenceId':'LOCAL-ARRAY2UV-EQUATIONS-001','parentEvidenceId':report['evidenceId'],'pixelShader':report['pixelShader'],'cases':cases,'maxAbsoluteError':max_error,'arrayLayersTested':sorted(layers),'coverage':'Two independent UV pairs, UV normal clamp, ten discrete array layers, tiled detail, CS multiplied by detail blue, saturated color/smoothness weight versus raw normal weight including native3/5, exact metallic alpha, unit world prelighting normal under identity frame.','limitations':['Static disassembly arithmetic; not native execution, float32/FMA identity or GPU filter equivalence.','UV0/UV1-to-native converted register association is explicitly inferred and not established by this numeric comparison.']}
(OUT/'equation-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
