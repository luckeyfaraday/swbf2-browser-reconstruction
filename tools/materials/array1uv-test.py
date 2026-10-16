"""Independent one-UV array equations checked against original DXBC text."""
import ast,json,math,pathlib,random,re
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/array1uv-shader'
report=json.loads((OUT/'material-analysis.json').read_text());scope={'math':math,'re':re}
tree=ast.parse((ROOT/'tools/materials/master1uv-test.py').read_text());nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))and n.name in('Machine','sat','mix')]
exec(compile(ast.Module(body=nodes,type_ignores=[]),'shared-dxbc-interpreter','exec'),scope);Machine=scope['Machine']
def sample(register,uv):
 # Source t2 uses sampler s1 (U wrap,V clamp); s0 wraps both coordinates.
 uv=[uv[0]%1,max(0,min(1,uv[1]))if register==2 else uv[1]%1]
 return [.5+.49*math.sin(register*.739+channel*1.913+uv[0]*(channel+1)*6.373+uv[1]*4.197)for channel in range(4)]
scope['sample']=sample
def array_sample(coords):
 return sample(3+min(9,max(0,math.floor(coords[2]+.5)))*.461,coords[:2])
scope['array_sample']=array_sample
tree=ast.parse((ROOT/'tools/materials/array2uv-test.py').read_text());nodes=[n for n in tree.body if isinstance(n,ast.ClassDef)and n.name=='ArrayMachine'];exec(compile(ast.Module(body=nodes,type_ignores=[]),'array-instruction-extension','exec'),scope);ArrayMachine=scope['ArrayMachine']
shader=(OUT/'dfa7a16109.asm').read_text();prefix=shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines();color=['mul r1.xyz, r3.xyzx, r4.zzzz','add o1.xyz, r1.xyzx, r1.xyzx'];assert all(x in shader for x in color)
rng=random.Random(666991456);max_error=0;cases=3900;layers=set()
for case in range(cases):
 uv=[rng.uniform(-12,12)for _ in range(2)];cb=[v[:]for v in report['materials'][case%13]['constants']]
 if case%7==0:cb[1][0]=rng.uniform(-2,6)
 m=ArrayMachine(uv,[0,0,0],[1,0,0],cb);m.reg.update({'v2':[1,0,0,uv[1]],'v3':[0,1,0,0],'v4':[0,0,1,0]});m.run(prefix);smooth=m.reg['r1'][3];normal=m.reg['r5'][:3];metal=m.reg['r2'][3];m.run(color)
 nam=sample(2,uv);base=sample(4,uv);detail=array_sample([uv[j]*cb[0][j]for j in range(2)]+[nam[2]*10]);xy=[2*v-1 for v in nam[:2]];n=[xy[j]+(2*detail[j]-1)*cb[1][0]for j in range(2)]+[math.sqrt(max(0,1-sum(v*v for v in xy)))];length=math.sqrt(sum(v*v for v in n));n=[v/length for v in n]
 expected=[*[2*v*detail[2]for v in base[:3]],2*base[3]*detail[2],*n,nam[3]];observed=[*m.reg['o1'][:3],smooth,*normal,metal];error=max(abs(a-b)for a,b in zip(expected,observed));assert error<1e-10,(case,error);max_error=max(max_error,error);layers.add(min(9,max(0,math.floor(nam[2]*10+.5))))
assert len(layers)==10
result={'evidenceId':'LOCAL-ARRAY1UV-EQUATIONS-001','parentEvidenceId':report['evidenceId'],'pixelShader':report['pixelShader'],'cases':cases,'maxAbsoluteError':max_error,'arrayLayersTested':sorted(layers),'coverage':'All13 source constants, single source UV, all10 array layers, base/detail-blue color and smoothness products, normal-only unsaturated detail weight including native2/3, metallic NAM alpha. Explicit wrap/clamp sampling fixtures.','limitations':['Static disassembly arithmetic, not native execution, float32/FMA identity or GPU filter parity.']}
(OUT/'equation-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
