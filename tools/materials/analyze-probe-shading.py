"""Check recovered SH/prelighting algebra against an interpreter of source DXBC.

This interprets a small arithmetic slice of retained disassembly. It does not
execute the installed game, identify the active pass, or recover the DFG texture.
"""
import hashlib
import json
import math
import pathlib
import random
import re

ROOT=pathlib.Path(__file__).resolve().parents[2]
SHADERS=ROOT/'exports/materials/floor-shader'
AXES='xyzw'


def split_args(value):
    return [part.strip() for part in re.split(r',\s*(?![^()]*\))',value)]


def interpret(coefficients,normal,view,smoothness):
    registers={f'r{i}':[0.0]*4 for i in range(14)}
    registers.update({'v2':[0.0]*4,'r0':[*view,1.0],'r1':[*view,smoothness],
        'r3':[0.0,0.0,0.0,normal[1]**2],'r4':[normal[0],normal[1],0.0,-normal[2]]})
    source=(SHADERS/'13ddb144d2.asm').read_text().splitlines()
    start=next(i for i,line in enumerate(source) if line.startswith('ld_indexable') and 'r5.xyzw, v2.xxxx' in line)
    end=next(i for i,line in enumerate(source[start:],start) if line=='max r0.xyz, r0.xyzx, l(0.000000, 0.000000, 0.000000, 0.000000)')

    def read(value):
        negative=value.startswith('-');value=value.lstrip('-')
        absolute=value.startswith('|');value=value.strip('|')
        if value.startswith('l('):
            items=[float(v) for v in value[2:-1].split(',')]
            result=items*4 if len(items)==1 else items
        else:
            name,swizzle=value.split('.')
            result=[registers[name][AXES.index(axis)] for axis in swizzle]
            if len(result)==1:result*=4
        if absolute:result=[abs(v) for v in result]
        return [-v for v in result] if negative else result

    for line in source[start:end+1]:
        opcode,args=line.split(' ',1);dest,*args=split_args(args)
        name,mask=dest.split('.')
        if opcode.startswith('ld_indexable'):
            result=list(coefficients[int(read(args[0])[0])])
        else:
            inputs=[read(arg) for arg in args]
            op=opcode.removesuffix('_sat')
            if op in ('mul','add','iadd','mad','div','max','min'):
                result=[]
                for a,b,*rest in zip(*inputs):
                    result.append({'mul':lambda:a*b,'add':lambda:a+b,'iadd':lambda:a+b,'mad':lambda:a*b+rest[0],'div':lambda:a/b,'max':lambda:max(a,b),'min':lambda:min(a,b)}[op]())
            elif op in ('dp3','dp2'):
                n=int(op[-1]);result=[sum(a*b for a,b in zip(inputs[0][:n],inputs[1][:n]))]*4
            elif op=='sqrt':result=[math.sqrt(v) for v in inputs[0]]
            elif op=='rsq':result=[1/math.sqrt(v) if v else float('inf') for v in inputs[0]]
            elif op=='mov':result=inputs[0]
            else:raise AssertionError(opcode)
            if opcode.endswith('_sat'):result=[max(0,min(1,v)) for v in result]
        for axis in mask:registers[name][AXES.index(axis)]=result[AXES.index(axis)]
    return registers['r0'][:3],{'firstLine':start+1,'lastLine':end+1}


def dot(a,b):return sum(x*y for x,y in zip(a,b))
def normalize(v):return [x/math.sqrt(dot(v,v)) for x in v]
def saturate(v):return max(0,min(1,v))


def analytic(coefficients,normal,view,smoothness):
    x,y,z=normal;basis=[1,x,y,z,3*y*y-1,x*y,y*z,x*z,x*x-z*z]
    diffuse=[sum(coefficients[i][c]*basis[i] for i in range(9)) for c in range(3)]
    c0sum=sum(coefficients[0][:3])
    vector=[sum(coefficients[i][:3])*.233333/max(c0sum*.333333,.000010) for i in (1,2,3)]
    strength=math.sqrt(dot(vector,vector));light=normalize(vector);half=normalize([v+l for v,l in zip(view,light)])
    nv=abs(dot(normal,view))+.000010;nl=saturate(dot(normal,light));nh=saturate(dot(normal,half));lh=saturate(dot(light,half))
    alpha_squared=max((1-math.sqrt(smoothness)*strength)**2,.002)**2
    visibility=.5/(nl*math.sqrt(nv*nv*(1-alpha_squared)+alpha_squared)+nv*math.sqrt(nl*nl*(1-alpha_squared)+alpha_squared))
    distribution=alpha_squared/(1+nh*nh*(alpha_squared-1))**2
    fresnel=.25+.75*(1-lh)**5
    fade=max((.937500-smoothness)*1.066667,0)
    factor=visibility*distribution*fresnel*min(4*nl,1)*fade*fade*(3-2*fade)
    return [max(0,diffuse[c]+2.2*coefficients[0][c]*factor) for c in range(3)]


def main():
    rng=random.Random(1930263);maximum_error=0
    for _ in range(1000):
        coefficients=[[rng.uniform(50,500) if band==0 else rng.uniform(-20,20) for c in range(3)]+[0] for band in range(9)]
        normal=normalize([rng.uniform(-1,1),rng.uniform(.05,1),rng.uniform(-1,1)])
        normal[0]+=rng.uniform(-.2,.2);normal[2]+=rng.uniform(-.2,.2)
        view=normalize([rng.uniform(-1,1),rng.uniform(.05,1),rng.uniform(-1,1)])
        smoothness=rng.random()
        expected,lines=interpret(coefficients,normal,view,smoothness)
        actual=analytic(coefficients,normal,view,smoothness)
        error=max(abs(a-b) for a,b in zip(expected,actual));maximum_error=max(maximum_error,error)
        assert error<1e-7,(expected,actual,error)
    forward=(SHADERS/'d825be064c.asm').read_text()
    suffix='\n'.join(forward.splitlines()[-9:])
    assert 'mul r1.xyz, r1.yyyy, r2.xyzx' in suffix
    assert 'mul r1.xyz, r3.xyzx, r1.xyzx' in suffix
    assert 'mad r0.xyz, r0.xyzx, l(0.318310, 0.318310, 0.318310, 0.000000), r1.xyzx' in suffix
    assert 'add r5.xy, -r1.wwww, l(1.000000, 0.937500, 0.000000, 0.000000)' in forward
    assert 'mul r6.y, r5.x, r5.x' in forward
    result={
        'evidenceId':'BF2-PROBE-SHADING-002',
        'pixelShaders':{name:{'sha256':hashlib.sha256((SHADERS/f'{name}.dxbc').read_bytes()).hexdigest()} for name in ['13ddb144d2','d825be064c']},
        'arithmeticSlice':{'shader':'13ddb144d2',**lines,'randomCases':1000,'maximumAbsoluteError':maximum_error,'method':'independent analytic expression vs arithmetic interpreter of retained source disassembly; no native execution'},
        'forwardOutput':{'shader':'d825be064c','expression':'(direct * albedo / pi + max(SH + broadSpecular,0) * albedo * LUT.z) * cb2[40].z','sourceSuffix':suffix,'lutUV':['saturate(dot(normalize(N),V))','(1-smoothness)^2'],'lutRegister':'t2','lutPayloadRecovered':False},
        'materialCorrection':{'sourceEquationOutput':'smoothness, not perceptual roughness','threeRoughness':'1-clamp(sourceEquationOutput,0,1)','evidence':['d825be064c.asm:147 forms 1-s','d825be064c.asm:167 forms (1-s)^2 for LUT Y','d825be064c.asm:241 uses 1-0.337748*(1-s) in direct diffuse energy normalization']},
        'browserCorrection':{'nativeIndirectHasOneOverPi':False,'threeLambertHasOneOverPi':True,'irradianceInjectionScale': 'PI cancels Three BRDF_Lambert normalization; not an artistic gain','remainingDifference':'Three multiscattering attenuation vs native DFG diffuse LUT.z, and omitted broad specular'},
        'limitations':['Disassembler decimal constants are rounded; the analytic/interpreter comparison uses those same rounded literal values.','Native DFG LUT identity/content and active renderer pass remain unresolved.','The recovered broad specular algebra is not integrated into the browser until its BRDF combination is handled.','Source coefficient upload convention and native volume interpolation remain previously documented inferences.'],
    }
    (ROOT/'exports/lighting/probe-shading-analysis.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'evidenceId':result['evidenceId'],'validation':result['arithmeticSlice'],'materialCorrection':result['materialCorrection']},indent=2))


if __name__=='__main__':main()
