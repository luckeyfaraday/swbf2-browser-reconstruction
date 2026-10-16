"""Compare compact ceiling equations to an independent disassembly interpreter."""
import ast, json, math, pathlib, random

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/ceiling-shader'
report = json.loads((OUT / 'material-analysis.json').read_text())
# Reuse only the generic arithmetic interpreter and analytic texture fixture.
# AST selection deliberately avoids running the Master1UV test or changing its files.
tree = ast.parse((ROOT / 'tools/materials/master1uv-test.py').read_text())
nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in ('Machine', 'sample', 'sat', 'mix')]
scope = {'math': math, 're': __import__('re')}
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'shared-dxbc-interpreter', 'exec'), scope)
Machine, sample, sat = scope['Machine'], scope['sample'], scope['sat']
shader = (OUT / '1fb4d25b38.asm').read_text()
prefix = shader[shader.index('add r0.xyz, -v1'):shader.index('ld_indexable(buffer)')].strip().splitlines()
suffix = shader[shader.index('mul r0.w, cb1[2]'):shader.index('ge r0.xy')].strip().splitlines()
rng = random.Random(1075960127)
max_error = 0
cases = 2000
for case in range(cases):
    uv = [rng.uniform(-50, 50) for _ in range(2)]
    cb = report['materials'][case % 20]['constants']
    machine = Machine(uv, [0,0,0], [0,1,0], cb)
    machine.reg.update({'v2': [1,0,0,uv[1]], 'v3': [0,1,0,0], 'v4': [0,0,1,0]})
    machine.run(prefix)
    normal, smoothness = machine.reg['r4'][:3], machine.reg['r1'][3]
    lighting = [rng.uniform(0, 500) for _ in range(3)]
    exposure = rng.uniform(.0001, .003)
    machine.reg['r0'][:3] = lighting
    machine.reg['cb2[40]'] = [exposure,0,0,0]
    machine.run(suffix)
    q = [u * cb[0][0] for u in uv]
    metal, n = sample(3, q), sample(4, [v * 2 for v in q])
    mask = sat(sample(2, uv)[0] * 1.111111 - .111111)
    xy = [2*n[0]*n[3]-1, 2*n[1]-1]
    expected_n = [*xy, math.sqrt(max(1-sum(x*x for x in xy),0))]
    length = math.sqrt(sum(x*x for x in expected_n))
    expected_n = [x/length for x in expected_n]
    color = [v + mask*(1-v) for v in cb[4][:3]]
    emission = [mask*v*cb[2][0]*cb[3][0] for v in cb[1][:3]]
    expected = [*expected_n,2*metal[1]**1.5,*color,.5*metal[0],*[(l+e)*exposure for l,e in zip(lighting,emission)]]
    observed = [*normal,smoothness,*machine.reg['o1'][:3],machine.reg['o2'][1],*machine.reg['o3'][:3]]
    error = max(abs(a-b) for a,b in zip(expected,observed))
    assert error < 1e-10, (case,error)
    max_error = max(max_error,error)
result = {'evidenceId': 'LOCAL-CEILING-EQUATIONS-001', 'parentEvidenceId': report['evidenceId'],
          'pixelShader': report['pixelShader'], 'cases': cases, 'maxAbsoluteError': max_error,
          'coverage': 'All 20 exact constant sets; UV-dependent packed sampling; normalized final normal with identity TBN; raw smoothness; color; native scalar; emission added to random prelighting before source global output scale.',
          'limitations': ['Static text-disassembly arithmetic interpreter, not native execution, bit-exact IEEE32/FMA or GPU texture sampling.',
                          'Interpreter comparisons use disassembler six-decimal literals; GLSL uses exact bytecode float literals.']}
(OUT / 'equation-validation.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
