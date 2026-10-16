"""Compare recovered projection/filter equations to unchanged full-CS WARP output."""
from pathlib import Path
import hashlib
import importlib.util
import json
import math
import struct

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('kernel',Path(__file__).with_name('native-shadow-kernel.py'))
kernel=importlib.util.module_from_spec(spec);spec.loader.exec_module(kernel)
FOLDER=ROOT/'exports/lighting/native-shadow-warp'
doc=json.loads((FOLDER/'execution.json').read_text())
raw=(FOLDER/'native-cases.rgba32f.bin').read_bytes()
assert hashlib.sha256(raw).hexdigest()==doc['payloadSha256']
pixels=struct.unpack('<'+str(len(raw)//4)+'f',raw)
baseline=struct.unpack('<256f',(FOLDER/'baseline.rgba32f.bin').read_bytes())
f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]

def expected(case,x,y,quantize_linear=False):
    p=[f(f(.3)*f((x+.5)/4-1)),f(f(.3)*f(1-(y+.5)/4)),-2,1]
    rows=case['rows'];q=[sum(a*b for a,b in zip(rows[i:i+4],p)) for i in range(0,16,4)]
    q=[v/q[3] for v in q[:3]]
    u=(q[0]*.5+.5)*case['atlas'][2]+case['atlas'][0]
    v=(-q[1]*.5+.5)*case['atlas'][3]+case['atlas'][1]
    if max(abs(q[0]),abs(q[1]),1-q[2])>1 or u<0:return 1
    texels=doc['patterns'][case['pattern']]['depth']
    def compare(ix,iy):
        depth=texels[max(0,min(15,iy))*16+max(0,min(15,ix))]
        return float(q[2]>depth)
    if int(case['quality'])==1:
        sx=u*16+.5;sy=v*16+.5;bx=math.floor(sx);by=math.floor(sy)
        weights=kernel.expected_weights(sx-bx,sy-by)
        value=sum(weights[j][i]*compare(bx-3+i,by-3+j) for j in range(6) for i in range(6))/61
    elif q[2]>=1:value=1
    else:
        sx=u*16-.5;sy=v*16-.5;bx=math.floor(sx);by=math.floor(sy);fx=sx-bx;fy=sy-by
        # Diagnostic only: D3D implementation precision, not native shader math.
        if quantize_linear:fx=math.floor(fx*256)/256;fy=math.floor(fy*256)/256
        value=sum(compare(bx+i,by+j)*wx*wy for i,wx in [(0,1-fx),(1,fx)] for j,wy in [(0,1-fy),(1,fy)])
    return 1+case['dimmer']*(value-1)

def validate():
    maxima={True:0,False:0};quantized=0;worst=[];count=0
    for case in doc['cases']:
        for y in range(8):
            for x in range(8):
                at=(y*8+x)*4;native=pixels[case['offset']//4+at]/baseline[at]
                predicted=expected(case,x,y);error=abs(native-predicted)
                kind=int(case['quality'])==1;maxima[kind]=max(maxima[kind],error)
                quantized=max(quantized,abs(native-expected(case,x,y,True)))
                if error>2e-5:worst.append({'case':case['index'],'x':x,'y':y,'quality':case['quality'],'native':native,'ideal':predicted,'error':error})
                count+=1
    report={'evidenceId':'BF2-NATIVE-SHADOW-CONSUMER-VALIDATION-001','samples':count,
        'maxQuality1Error':maxima[True],'maxBilinearIdealError':maxima[False],
        'maxWithDiagnostic8BitBilinearFractions':quantized,'largeResidualCount':len(worst),'largestResiduals':sorted(worst,key=lambda x:-x['error'])[:12],
        'limitations':['The diagnostic 8-bit fraction comparison is not a browser approximation or a claim of universal driver precision.',
            'Validates controlled unchanged native CS consumer output; original caster/depth producer is outside the fixture.']}
    (ROOT/'exports/lighting/native-shadow-consumer-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    assert maxima[True]<2e-5
    # Bilinear comparison is 1-Lipschitz in each fractional coordinate. The
    # independently observed WARP floor-to-8-bits diagnostic bounds this
    # implementation's residual by 2/256, without changing source arithmetic.
    assert maxima[False]<2/256
    assert quantized<2e-5
if __name__=='__main__':validate()
