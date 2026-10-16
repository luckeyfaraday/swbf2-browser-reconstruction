"""Independent disassembly arithmetic versus compact MetalOnly material math."""
import ast, json, math, pathlib, random

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/metalonly-shader'
report = json.loads((OUT / 'material-analysis.json').read_text())
tree = ast.parse((ROOT/'tools/materials/master1uv-test.py').read_text())
nodes = [n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in ('Machine','sample','sat','mix')]
scope = {'math':math,'re':__import__('re')}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'shared-dxbc-interpreter','exec'),scope)
Machine,sample,sat,mix = [scope[k] for k in ('Machine','sample','sat','mix')]
shader = (OUT/'85476b5805.asm').read_text()
prefix = shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines()
color = shader[shader.index('add r1.xyz, cb1[3]'):shader.index('mul r0.xyz, r6.zzzz')].strip().splitlines()

def formula(uv,pos,normal,cb):
    q = [uv[i]*cb[1][i] for i in range(2)]
    a,m,mn = sample(8,q),sample(6,q),sample(7,[v*2 for v in q])
    w,g,base = sample(3,uv),sample(2,[v*3 for v in q]),sample(4,uv)
    scratch,dirt,restore = w[0]*(.48+1.04*g[2]),2*w[1]*g[3],sat(2*g[1]*w[3]/cb[2][0])
    s0 = 2*m[1]**1.5
    s = mix(s0,.042311,scratch)
    s = mix(s,s0+1,dirt)
    s = mix(s,.007499,w[2])
    s = mix(s,.8*a[3],restore)
    grunge = mix(sample(5,[pos[0]*.1,pos[1]*.1])[1],sample(5,[pos[2]*.1,pos[1]*.1])[1],sat(2*abs(normal[0])-1))
    s = mix(s+.2,s,(1-grunge)*(1-abs(normal[1])))
    c = [mix(cb[4][j],cb[3][j],scratch) for j in range(3)]
    for target,weight in [([.171441]*3,dirt),(cb[0],w[2]),([.323143]*3,restore)]:
        c = [mix(v,target[j],weight) for j,v in enumerate(c)]
    detail = [2*mn[0]*mn[3]-1,2*mn[1]-1]
    detail = [mix(v,2*a[j]-1,sat(w[0]+w[1])) for j,v in enumerate(detail)]
    xy = [2*v-1 for v in base[:2]]
    n = [xy[0]+detail[0],xy[1]+detail[1],math.sqrt(max(1-sum(v*v for v in xy),0))]
    length = math.sqrt(sum(v*v for v in n))
    n = [v/length for v in n]
    scalar = .5*m[0]
    enhanced = sat(scalar+.7)
    scalar = mix(scalar,.15,scratch)
    scalar = mix(scalar,enhanced,dirt)
    scalar = mix(scalar,.9,restore)
    return [*c,s,*n,scalar,base[3]]

rng = random.Random(1443790615)
max_error,normal_clamp_cases = 0,0
cases = 3400
for case in range(cases):
    uv = [rng.uniform(-50,50) for _ in range(2)]
    pos = [rng.uniform(-1000,1000) for _ in range(3)]
    normal = [rng.uniform(-1,1) for _ in range(3)]
    # Interpolation of normalized source vertex normals need not be unit length.
    length = math.sqrt(sum(v*v for v in normal))/rng.uniform(.25,1)
    normal = [v/length for v in normal]
    cb = report['materials'][case % 17]['constants']
    machine = Machine(uv,pos,normal,cb)
    machine.run(prefix)
    smoothness,world_normal,ao = machine.reg['r1'][3],machine.reg['r2'][:3],machine.reg['r6'][2]
    machine.run(color)
    observed = [*machine.reg['o1'][:3],smoothness,*world_normal,machine.reg['o2'][1],ao]
    expected = formula(uv,pos,normal,cb)
    error = max(abs(a-b) for a,b in zip(observed,expected))
    assert error < 1e-10,(case,error,observed,expected)
    max_error = max(max_error,error)
    normal_clamp_cases += sum(sample(3,uv)[:2])>1
assert normal_clamp_cases>1000
result = {'evidenceId':'LOCAL-METALONLY-EQUATIONS-001','parentEvidenceId':report['evidenceId'],
          'pixelShader':report['pixelShader'],'cases':cases,'maxAbsoluteError':max_error,
          'normalBlendClampCases':normal_clamp_cases,
          'coverage':'All 17 exact constant sets; UV-dependent packed channels; world-position grunge with non-unit interpolated vertex normals; color; raw smoothness; normalized tangent normal; native o2.y scalar; AO; saturated wear normal blend.',
          'limitations':['Static text-disassembly arithmetic interpreter, not native execution, bit-exact IEEE32/FMA or GPU texture sampling.',
                         'Interpreter comparisons use disassembler six-decimal literals; GLSL uses exact bytecode float literals.']}
(OUT/'equation-validation.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
