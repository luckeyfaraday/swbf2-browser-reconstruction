"""Independently check recovered native reflection sampling instruction slices."""
import importlib.util
import json
import math
import pathlib
import random
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT/'exports/lighting/dfg-reflection-shaders'


def interpret(lines, registers):
    def operand(text):
        if text.startswith('l('):
            values = [float(value) for value in text[2:-1].split(',')]
            return values * 4 if len(values) == 1 else values
        sign = -1 if text.startswith('-') else 1
        reg, mask = text.lstrip('-').split('.')
        return [sign * registers[reg]['xyzw'.index(c)] for c in mask.ljust(4, mask[-1])]
    for original in lines:
        line = re.sub(r'cb0\[r7.w \+ (\d+)\]', r'c\1', original)
        line = line.replace('cb0[1]', 'c1').replace('cb0[5]', 'c5')
        op, args = line.split(' ', 1)
        args = re.split(r',\s*(?![^()]*\))', args)
        dst = args.pop(0)
        values = [operand(arg) for arg in args]
        saturated = op.endswith('_sat')
        op = op.removesuffix('_sat')
        result = []
        for axis in range(4):
            v = [value[axis] for value in values]
            if op in ('mov', 'utof'): y = v[0]
            elif op == 'mul': y = v[0] * v[1]
            elif op == 'add': y = v[0] + v[1]
            elif op == 'mad': y = v[0] * v[1] + v[2]
            elif op == 'div': y = v[0] / v[1] if v[1] else float('inf')
            elif op == 'sqrt': y = math.sqrt(max(v[0], 0))
            elif op == 'rsq': y = 1 / math.sqrt(v[0]) if v[0] > 0 else float('inf')
            elif op == 'log': y = math.log2(v[0]) if v[0] > 0 else float('-inf')
            elif op == 'exp': y = 2 ** v[0]
            elif op in ('eq', 'ieq'): y = 1 if v[0] == v[1] else 0
            elif op == 'min': y = min(v)
            elif op == 'max': y = max(v)
            elif op == 'movc': y = v[1] if v[0] else v[2]
            elif op == 'dp3': y = sum(values[0][a] * values[1][a] for a in range(3))
            else: raise AssertionError((op, original))
            result.append(max(0, min(1, y)) if saturated else y)
        reg, mask = dst.split('.')
        registers.setdefault(reg, [0.] * 4)
        for c in mask:
            axis = 'xyzw'.index(c)
            registers[reg][axis] = result[axis]
    return registers


def section(lines, first, last):
    return lines[lines.index(first):lines.index(last)+1]


def normalize(vector):
    length = math.sqrt(sum(value*value for value in vector))
    return [value/length for value in vector]


def lerp(a, b, t):
    return [x + (y-x)*t for x,y in zip(a,b)]


def reflection_input(normal, view, roughness):
    nv = max(0, min(1, sum(n*v for n,v in zip(normal,view))))
    ray = [2*sum(n*v for n,v in zip(normal,view))*n-v for n,v in zip(normal,view)]
    alpha = roughness*roughness
    dominant = lerp(normal, ray, (1-alpha)*(alpha+math.sqrt(max(1-alpha,0))))
    cone = alpha * (min(2*nv,1)*(1-roughness)+roughness)
    return dominant, cone, nv, ray


def box_projection(position, direction, extent, offset, roughness, cone, skip, bias):
    near = [(-e-p)/d for e,p,d in zip(extent,position,direction)]
    far = [(e-p)/d for e,p,d in zip(extent,position,direction)]
    enter = max(min(a,b) for a,b in zip(near,far))
    exit_distance = min(max(a,b) for a,b in zip(near,far))
    if skip > 0: enter, exit_distance = 0, 1
    if enter >= exit_distance: return None
    hit = [p+exit_distance*d-o for p,d,o in zip(position,direction,offset)]
    distance = math.sqrt(sum(value*value for value in hit))
    a = max(0,min(1,max(roughness*roughness,skip)))
    weight = a*a*(3-2*a)
    projected_cone = cone * exit_distance / distance
    adjusted_cone = projected_cone + weight * (cone-projected_cone)
    return {'direction':lerp(hit,direction,weight),'mip':math.log2(1+bias*adjusted_cone),
            'exitDistance':exit_distance,'hit':hit,'blend':weight}


def run():
    lines = [line.strip() for line in (OUT/'local-type4.asm').read_text().splitlines()]
    dominant_code = section(lines, 'mad r3.x, -r1.z, r1.z, l(1.000000)', 'mul r5.y, r1.z, r4.y')
    box_code = section(lines, 'mad r14.xzw, r14.yyyy, r13.xxyz, r12.xxyz', 'log r11.w, r11.w')
    face_lines = (OUT/'convolve-specular.asm').read_text().splitlines()
    face_code = section(face_lines, 'utof r0.xy, vThreadID.xyxx', 'mul r0.xyz, r0.wwww, r0.xyzx')
    rng = random.Random(0xBF24)
    maximum, examples = 0., []
    for case in range(1000):
        n = normalize([rng.uniform(-1,1) for _ in range(3)])
        view = normalize([rng.uniform(-1,1) for _ in range(3)])
        roughness = rng.random()
        direction,cone,nv,ray = reflection_input(n,view,roughness)
        regs = {'r1':[0,0,roughness,0], 'r4':[nv,roughness*roughness,0,0],
                'r5':[0]+ray,'r7':n+[0]}
        result = interpret(dominant_code,regs)
        error = max(abs(x-y) for x,y in zip(result['r3'][:3]+[result['r5'][1]],direction+[cone]))
        maximum=max(maximum,error)
        extent=[rng.uniform(2,10) for _ in range(3)]
        position=[e*rng.uniform(-.85,.85) for e in extent]
        offset=[rng.uniform(-.1,.1) for _ in range(3)]
        skip=1 if case%5==0 else 0
        expected=box_projection(position,direction,extent,offset,roughness,cone,skip,32)
        assert expected
        raw={'r14':[0,expected['exitDistance'],0,0],'r13':direction+[0], 'r12':position+[0],
             'r4':[nv,roughness*roughness,0,0],'r5':[0,cone,0,0],
             'r1':[0,0,cone/(roughness*roughness),0],
             'c52':offset+[0],'c55':[0,0,skip,0],'c5':[32,0,0,0]}
        actual=interpret(box_code,raw)
        error=max(abs(x-y) for x,y in zip(actual['r13'][:3]+[actual['r11'][3]],expected['direction']+[expected['mip']]))
        maximum=max(maximum,error)
        if case<3:examples.append({'roughness':roughness,'cone':cone,'position':position,
                                  'extent':extent,'skipProxy':skip,**expected})
    assert maximum<1e-11,maximum
    face_error=0.
    for face in range(6):
        for px in [0,32,64,127]:
            for py in [0,32,64,127]:
                x,y=2*(px+.5)/128-1,2*(py+.5)/128-1
                expected=normalize([(1,-y,-x),(-1,-y,x),(x,1,y),(x,-1,-y),(x,-y,1),(-x,-y,-1)][face])
                actual=interpret(face_code,{'vThreadID':[px,py,face,0],'c1':[1/128,0,0,0]})['r0'][:3]
                face_error=max(face_error,max(abs(x-y) for x,y in zip(actual,expected)))
    assert face_error<1e-12,face_error
    report={'evidenceId':'BF2-NATIVE-REFLECTION-SAMPLING-001','cases':1000,
            'maximumAbsoluteError':maximum,'faceCases':96,'faceMaximumAbsoluteError':face_error,
            'examples':examples,
            'equations':{'dominantDirection':'mix(N,reflect(-V,N),(1-r^2)*(r^2+sqrt(1-r^2)))',
                         'angularRoughness':'r^2*mix(min(2*saturate(NdotV),1),1,r)',
                         'localMipmapBias':'2^(floor(log2(cubeResolution))-2); 128→32',
                         'boxProxy':'Local slab exit hit minus LocalOffset; blend toward local dominant ray by smoothstep(0,1,max(r^2,skipProxyReprojection)).',
                         'projectedRoughness':'mix(angularRoughness*exitDistance/length(hit),angularRoughness,proxyBlend)',
                         'lod':'log2(1+localMipmapBias*projectedRoughness)',
                         'overlap':'RGB+=remaining*mask*response*cubeRGB*inverseLRVExposure; remaining*=1-mask*cubeAlpha',
                         'cubeFaces':['(1,-y,-x)','(-1,-y,x)','(x,1,y)','(x,-1,-y)','(x,-y,1)','(-x,-y,-1)']},
            'limitations':['Source instruction slices interpreted as double-precision algebra, not native shader execution.',
                           'CPU construction of per-volume invTransform/extent/ordered tile list is not yet recovered.',
                           'LOD formula samples native prefiltered mips; it must not be applied to Three PMREM.',
                           'Standalone one-mip source cube may take runtime reconvolution path when it mismatches the local cube array.']}
    (OUT/'equation-validation.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({key:report[key] for key in ['evidenceId','cases','maximumAbsoluteError','faceCases','faceMaximumAbsoluteError']},indent=2))


if __name__=='__main__': run()
