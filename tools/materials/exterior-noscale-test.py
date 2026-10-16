"""Native DXBC arithmetic comparisons, including non-orthogonal rotated TBNs."""
import ast,json,math,pathlib,random
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/exterior-noscale-shader'
report=json.loads((OUT/'material-analysis.json').read_text())
tree=ast.parse((ROOT/'tools/materials/master1uv-test.py').read_text())
nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))and n.name in ('Machine','sample','sat','mix')]
scope={'math':math,'re':__import__('re')};exec(compile(ast.Module(body=nodes,type_ignores=[]),'shared-dxbc-interpreter','exec'),scope)
Machine,sample=scope['Machine'],scope['sample']
shader=(OUT/'87f18d3646.asm').read_text();prefix=shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines()
color=shader[shader.index('add r1.xyz, -cb1[1]'):shader.index('mul r0.xyz, r2.zzzz')].strip().splitlines()
norm=lambda v:[x/math.sqrt(sum(a*a for a in v))for x in v]
rng=random.Random(1764561980);cases=3200;max_error=0;nonunit=0
for case in range(cases):
    uv=[rng.uniform(-30,30)for _ in range(2)];pos=[rng.uniform(-1000,1000)for _ in range(3)]
    # Arbitrary non-orthogonal frames also cover interpolation/skew, so a
    # mistaken tangent-axis sum cannot accidentally pass an identity-frame test.
    frame=[norm([rng.uniform(-1,1)for _ in range(3)])for _ in range(3)]
    cb=report['materials'][case%4]['constants'];machine=Machine(uv,pos,[0,1,0],cb)
    for n,row in enumerate(frame,2):machine.reg[f'v{n}']=[*row,uv[1]if n==2 else 0]
    machine.run(prefix);smoothness=machine.reg['r4'][0];prelighting=machine.reg['r5'][:3];ao=machine.reg['r2'][2]
    machine.run(color)
    b,d=sample(2,uv),sample(3,[uv[j]*cb[0][j]for j in range(2)])
    xy=[2*v-1 for v in b[:2]];base=[*xy,math.sqrt(max(1-sum(x*x for x in xy),0))];detail=[2*v-1 for v in d[:3]]
    world=lambda v:norm([sum(row[j]*v[j]for j in range(3))for row in frame])
    bw,dw=world(base),world(detail);pn=[bw[0]+dw[0],bw[1]+dw[1],bw[2]]
    c=[2*d[3]*(cb[1][j]+b[3]*(cb[2][j]-cb[1][j]))for j in range(3)];response=2*(1-b[3])*d[3]
    observed=[*machine.reg['o1'][:3],smoothness,machine.reg['o2'][1],ao,*prelighting,*norm(prelighting)]
    expected=[*c,response*cb[3][0],response*cb[4][0],b[2],*pn,*norm(pn)]
    error=max(abs(a-b)for a,b in zip(expected,observed));assert error<1e-10,(case,error)
    max_error=max(max_error,error);nonunit+=abs(sum(x*x for x in pn)-1)>.01
assert nonunit>3000
result={'evidenceId':'LOCAL-EXTERIOR-NOSCALE-EQUATIONS-001','parentEvidenceId':report['evidenceId'],'pixelShader':report['pixelShader'],'cases':cases,'maxAbsoluteError':max_error,
        'nonunitPrelightingCases':nonunit,'coverage':'All4 exact constant sets, source UV sampling, color/smoothness/metalness/AO, independent arbitrary rotated/skewed TBNs, normalized component normals, WORLD XY mask, unnormalized SH normal and normalized G-buffer normal.',
        'limitations':['Static text-disassembly arithmetic interpreter, not native execution, bit-exact float32/FMA or GPU sampling.']}
(OUT/'equation-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
