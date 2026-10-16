"""Independent interpreter checks both original blaster pixel shader variants."""
import ast,json,math,pathlib,random,re
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/rifle-trail/render-shaders'
tree=ast.parse((ROOT/'tools/materials/master1uv-test.py').read_text());defs=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))];code=ast.unparse(ast.Module(body=defs,type_ignores=[]))
code=code.replace("elif op == 'max':", "elif op == 'min':\n                    result = [min(x,y) for x,y in zip(*a)]\n                elif op == 'frc':\n                    result = [x-math.floor(x) for x in a[0]]\n                elif op == 'round_pi':\n                    result = [math.ceil(x) for x in a[0]]\n                elif op == 'max':")
code=code.replace('math.log2(x) for x in a[0]','(math.log2(x) if x>0 else -math.inf) for x in a[0]')
exec(compile(code,'<independent-interpreter>','exec'))
def formula(v,screen,inv,camera,multiplier,global40,fade):
 uv=v[8];rad=[(x-math.floor(x))*2-1 for x in uv[:2]];disc=max(1-math.sqrt(sum(x*x for x in rad)),0)**2*sample(4,uv[:2])[0]*(sample(5,[screen[j]*inv[j]for j in range(2)])[0]+.1)
 side=sample(2,[max(.01,min(.99,uv[0])),.5-abs(uv[1]-.5)])[3]*3;top=sat((sample(3,uv[:2])[3]-.01)*1.01);shape=mix(top,side,v[1][0])
 distance=sat((math.sqrt(sum((v[6][j]-camera[j])**2 for j in range(3)))-.2)*10);segment=sat((v[1][2]-v[7][0])*v[1][1])*sat((v[7][0]-v[1][3])*v[1][1]);core=math.sqrt(shape)*segment;body=shape*v[7][1]*.3*distance*segment;opacity=body*v[7][2];gate=math.ceil(sat(v[5][3]));coverage=sat(mix(opacity,disc*.9,gate))
 phase=sat(opacity+v[3][3]*(1-opacity-sat(v[7][0])))**v[2][3];first=[mix(v[2][j],v[4][j],v[4][3])for j in range(3)];second=[mix(v[3][j],v[5][j],v[4][3])for j in range(3)];color=[mix(second[j],first[j],phase)for j in range(3)];factor=global40[3]+(1-global40[3])*.25
 rgb=[coverage*mix(max(core*multiplier[j]*5*factor*color[j]*v[7][3],0),v[5][3]*v[7][2]*(first[j]+second[j])*factor,gate)*fade*global40[2]for j in range(3)]
 return [*rgb,0,screen[2],1,0,coverage]
programs={}
for name in ['5f93c17d04','abf28c9265']:
 s=(OUT/(name+'.asm')).read_text();programs[name]=s[s.index('frc r0.xy'):s.index('ret ')].strip().splitlines()
rng=random.Random(4035194024);max_error=0;cases=4000;branches=[0,0];distance_ranges=[0,0,0]
for case in range(cases):
 v={n:[rng.uniform(.1,4)for _ in range(4)]for n in range(1,9)};v[1]=[case%2,rng.uniform(.1,10),rng.uniform(.5,3),rng.uniform(-2,0)];v[2][3]=rng.uniform(.1,8);v[4][3]=rng.random();v[5][3]=-.25 if case%3==0 else rng.uniform(.01,1);v[7]=[rng.uniform(-1,2),rng.uniform(.2,2),rng.uniform(.1,3),rng.uniform(.1,2)];v[8]=[rng.uniform(-2,3),rng.uniform(-2,3),0,0]
 camera=[1,2,3];distance=[.1,.25,10][case%3];v[6]=[camera[0]+distance,camera[1],camera[2],0];screen=[rng.uniform(0,1280),rng.uniform(0,720),rng.random(),0];inv=[1/1280,1/720];global40=[0,0,rng.uniform(.01,3),rng.random()];multiplier=[rng.uniform(.1,2)for _ in range(3)];fade=rng.random();branches[v[5][3]>0]+=1;distance_ranges[case%3]+=1
 for name,lines in programs.items():
  m=Machine([0,0],[0,0,0],[0,1,0],[[*multiplier,1]]);m.reg.update({f'v{n}':values[:]for n,values in v.items()});m.reg['v0']=screen;m.reg['cb2[1]']=[0,0,*inv];m.reg['cb2[37]']=[*camera,0];m.reg['cb2[40]']=global40
  if name=='abf28c9265':m.reg['v9']=v[8];m.reg['v8']=v[7];m.reg['v7']=v[6];m.reg['v6']=[0,0,0,1-fade]
  m.run(lines);observed=[*m.reg['o0'],*m.reg['o2']];expected=formula(v,screen,inv,camera,multiplier,global40,fade if name=='abf28c9265'else 1);error=max(abs(a-b)for a,b in zip(observed,expected));assert error<1e-9,(case,name,error,observed,expected);max_error=max(max_error,error)
result={'evidenceId':'LOCAL-BLASTER-BOLT-EQUATIONS-001','cases':cases,'shaderEvaluations':cases*2,'maxAbsoluteError':max_error,'ordinaryAndFlareCases':branches,'nearRampFarCases':distance_ranges,'coverage':'Both native pixel shaders; distinct analytic RGBA texture samples, folded UVs, radial/screen mask, segment/distance fades, color/power mix, flare gate, radiance and auxiliary depth/coverage outputs.','limitations':['Independent six-decimal text-DXBC arithmetic, not native GPU or bit-exact FMA execution.','Inputs are synthetic register fixtures; this does not establish original particle-to-VS binding or renderer blending/compositing.']}
(OUT/'render-material-equation-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
