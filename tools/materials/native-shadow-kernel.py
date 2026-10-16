"""Independently interpret the unchanged DXBC shadow-filter arithmetic slice.

This scalar interpreter is source arithmetic evidence, not native execution.
The separate CPU WARP fixture executes the entire unchanged compute shader.
"""
from pathlib import Path
import hashlib
import json
import math
import re

ROOT=Path(__file__).resolve().parents[2]
ASM=ROOT/'exports/lighting/direct-shaders/type3.asm'
lines=ASM.read_text().splitlines()
first=next(i for i,v in enumerate(lines) if 'gather4_c_aoffimmi_indexable(-2,-2,0)' in v)
last=next(i for i,v in enumerate(lines[first:],first) if 'mul_sat r11.w' in v)
KERNEL_LINES=[v.strip() for v in lines[first:last+1]]
KERNEL=[
 [1,2,2,2,1],
 [2,3,4,3,2],
 [2,4,5,4,2],
 [2,3,4,3,2],
 [1,2,2,2,1],
]
assert sum(map(sum,KERNEL))==61

def interpret(fx,fy,gather):
    registers={'r12':[fx,fy,0,0],'r11':[0,0,.5,0]}
    def operand(text):
        if text.startswith('l('):
            v=[float(x) for x in text[2:-1].split(',')]
            return v*4 if len(v)==1 else v
        sign=-1 if text.startswith('-') else 1
        reg,mask=text.lstrip('-').split('.')
        return [sign*registers[reg]['xyzw'.index(c)] for c in mask.ljust(4,mask[-1])]
    for line in KERNEL_LINES:
        op,args=line.split(' ',1)
        args=re.split(r',\s*(?![^()]*\))',args)
        dst=args.pop(0)
        if op.startswith('gather4'):
            offset=re.search(r'aoffimmi_indexable\((-?\d+),(-?\d+),0\)',op)
            dx,dy=map(int,offset.groups()) if offset else (0,0)
            result=gather(dx,dy)
        else:
            values=[operand(v) for v in args]
            if op=='dp2':result=[sum(values[0][a]*values[1][a] for a in range(2))]*4
            else:
                result=[]
                for a in range(4):
                    v=[x[a] for x in values]
                    if op=='add': y=v[0]+v[1]
                    elif op in ('mul','mul_sat'): y=v[0]*v[1]
                    elif op=='mad': y=v[0]*v[1]+v[2]
                    else:raise ValueError(op)
                    result.append(max(0,min(1,y)) if op.endswith('_sat') else y)
        reg,mask=dst.split('.')
        registers.setdefault(reg,[0]*4)
        for c in mask:
            a='xyzw'.index(c);registers[reg][a]=result[a]
    # Assembly prints 1/61 as six decimal digits; undo that decimal display
    # rounding only for this algebraic coefficient comparison.
    return registers['r11'][3]/.016393/61

def basis_weights(fx,fy):
    out=[]
    for y in range(6):
        row=[]
        for x in range(6):
            # D3D GatherCmp component order: bottom-left, bottom-right,
            # top-right, top-left. Coordinates here index the 6x6 footprint.
            def gather(dx,dy):
                return [float((x,y)==p) for p in [(dx+2,dy+3),(dx+3,dy+3),(dx+3,dy+2),(dx+2,dy+2)]]
            row.append(interpret(fx,fy,gather)*61)
        out.append(row)
    return out

def expected_weights(fx,fy):
    out=[[0.]*6 for _ in range(6)]
    for y in range(5):
        for x in range(5):
            w=KERNEL[y][x]
            for dx,wx in [(0,1-fx),(1,fx)]:
                for dy,wy in [(0,1-fy),(1,fy)]:
                    out[y+dy][x+dx]+=w*wx*wy
    return out

def validate():
    maximum=0
    fixtures=[]
    for fx in [0,.01,.125,.25,.5,.75,.99,1]:
        for fy in [0,.03125,.125,.5,.875,1]:
            actual=basis_weights(fx,fy);expected=expected_weights(fx,fy)
            error=max(abs(actual[y][x]-expected[y][x]) for y in range(6) for x in range(6))
            maximum=max(maximum,error)
            assert error<1e-12,(fx,fy,error,actual,expected)
            fixtures.append({'fraction':[fx,fy],'weights':actual})
    doc={'evidenceId':'BF2-NATIVE-SHADOW-KERNEL-001','schemaVersion':1,
      'shaderSha256':hashlib.sha256((ROOT/'exports/lighting/direct-shaders/type3.dxbc').read_bytes()).hexdigest(),
      'assemblySlice':KERNEL_LINES,'kernel':KERNEL,'normalization':61,
      'basisCaseCount':len(fixtures)*36,'maxCoefficientError':maximum,'fixtures':fixtures,
      'meaning':'Nine original GatherCmp operations equal this 5x5 integer kernel bilinearly shifted onto a 6x6 comparison footprint.',
      'limitations':['Independent opcode interpretation validates algebra; original full-shader execution is a separate WARP fixture.',
        'Printed assembly normalization is rounded; coefficient validation removes only that textual rounding. Runtime uses the original float32 constant.']}
    (ROOT/'exports/lighting/native-shadow-kernel.json').write_text(json.dumps(doc,indent=2)+'\n')
    print(json.dumps({'basisCases':doc['basisCaseCount'],'maxCoefficientError':maximum}))
if __name__=='__main__':validate()
