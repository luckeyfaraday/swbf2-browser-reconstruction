"""Independent DXBC arithmetic comparisons for the packed Catwalk2 shader."""
import ast,json,math,pathlib,random
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/catwalk2-shader'
report=json.loads((OUT/'material-analysis.json').read_text())
tree=ast.parse((ROOT/'tools/materials/master1uv-test.py').read_text())
nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in ('Machine','sample','sat','mix')]
scope={'math':math,'re':__import__('re')}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'shared-dxbc-interpreter','exec'),scope)
Machine,sample=scope['Machine'],scope['sample']
shader=(OUT/'2b6d233517.asm').read_text()
prefix=shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines()
rng=random.Random(2105226254);max_error=0;cases=3000
for case in range(cases):
    uv=[rng.uniform(-50,50)for _ in range(2)];pos=[rng.uniform(-1000,1000)for _ in range(3)]
    cb=report['materials'][case%30]['constants']
    machine=Machine(uv,pos,[0,1,0],cb)
    machine.reg.update({'v2':[1,0,0,uv[1]],'v3':[0,1,0,0],'v4':[0,0,1,0]})
    machine.run(prefix)
    machine.run(['mul o1.xyz, r3.zzzz, r4.xyzx'])
    base,detail,grunge=sample(2,uv),sample(3,[uv[j]*cb[0][j]for j in range(2)]),sample(4,[pos[0]*.1,pos[2]*.1])
    xy=[2*v-1 for v in detail[:2]]
    n=[xy[0]+2*base[0]-1,xy[1]+2*base[1]-1,math.sqrt(max(1-sum(v*v for v in xy),0))]
    length=math.sqrt(sum(v*v for v in n));n=[v/length for v in n]
    expected=[*[base[2]*v for v in grunge[:3]],base[3]*grunge[3]*detail[2],*n]
    observed=[*machine.reg['o1'][:3],machine.reg['r1'][3],*machine.reg['r2'][:3]]
    error=max(abs(a-b)for a,b in zip(expected,observed));assert error<1e-10,(case,error)
    max_error=max(max_error,error)
forward=(OUT/'798255efd6.asm').read_text()
ops=['mul_sat r1.w, r2.z, r4.w','add r5.xy, -r1.wwww, l(1.000000, 0.937500, 0.000000, 0.000000)']
assert all(op in forward for op in ops)
result={'evidenceId':'LOCAL-CATWALK2-EQUATIONS-001','parentEvidenceId':report['evidenceId'],'pixelShader':report['pixelShader'],
        'cases':cases,'maxAbsoluteError':max_error,'forwardShader':'798255efd6','forwardRoughnessOperations':ops,
        'coverage':'All30 exact UV-scale selections; UV0 and source-world XZ sampling; packed base blue as color; triple-product smoothness; detail-normal Z reconstruction and normalized sum.',
        'limitations':['Static independent text-disassembly arithmetic interpreter, not native execution, float32/FMA bit identity or GPU sampling.']}
(OUT/'equation-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
