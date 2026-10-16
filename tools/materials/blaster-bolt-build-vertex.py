"""Translate the bounded original bolt VS, retaining exact immediate bit patterns.

The CPU evaluator is an independent numeric oracle candidate. GLSL keeps the
original buffer addressing through three explicit load hooks. Neither backend
chooses render state, camera conventions, or a native particle scheduling policy.
"""
import ctypes, hashlib, json, pathlib, re, struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIR = ROOT / 'exports/rifle-trail/render-shaders'
ASM = DIR / 'render-material-vs-hex.asm'

# Reproduce exact IEEE754 immediates instead of trusting six-decimal assembly.
source_dxbc=(DIR/'f8781d702f.dxbc').read_bytes()
lib=ctypes.WinDLL('C:/Windows/System32/d3dcompiler_47.dll');disassemble=lib.D3DDisassemble
disassemble.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_uint,ctypes.c_char_p,ctypes.POINTER(ctypes.c_void_p)];disassemble.restype=ctypes.c_long
blob=ctypes.c_void_p();raw_buffer=ctypes.create_string_buffer(source_dxbc)
hr=disassemble(raw_buffer,len(source_dxbc),0x80,None,ctypes.byref(blob))
if hr<0:raise RuntimeError(f'D3DDisassemble failed0x{hr&0xffffffff:08x}')
vtable=ctypes.cast(blob,ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
ptr=ctypes.WINFUNCTYPE(ctypes.c_void_p,ctypes.c_void_p)(vtable[3])(blob)
size=ctypes.WINFUNCTYPE(ctypes.c_size_t,ctypes.c_void_p)(vtable[4])(blob)
assembly=ctypes.string_at(ptr,size).rstrip(b'\0').decode('utf-8')
ctypes.WINFUNCTYPE(ctypes.c_ulong,ctypes.c_void_p)(vtable[2])(blob)
ASM.write_text(assembly)

def sha(b): return hashlib.sha256(b).hexdigest()
def split(s): return re.split(r',\s*(?![^()]*\))', s.strip())
def mask(s): return s.split('.')[-1] if '.' in s else 'xyzw'
def components(s): return ['xyzw'.index(c) for c in mask(s)]
def scalar_float(bits):
    v = struct.unpack('<f', struct.pack('<I', bits))[0]
    assert v == v and abs(v) != float('inf')
    return repr(v)

ops = []
for line in ASM.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith(('//', 'dcl_', 'vs_')): continue
    normalized = re.sub(r'^ld_structured_indexable\(structured_buffer, stride=\d+\)\(mixed,mixed,mixed,mixed\)', 'loadStructured', line)
    normalized = re.sub(r'^ld_raw_indexable\(raw_buffer\)\(mixed,mixed,mixed,mixed\)', 'loadRaw', normalized)
    op, _, args = normalized.partition(' ')
    ops.append((op, split(args) if args else [], line))

def operand(s, lane, kind, backend):
    neg = s.startswith('-')
    if neg: s = s[1:]
    absolute = s.startswith('|') and s.endswith('|')
    if absolute: s = s[1:-1]
    if s.startswith('l('):
        words = [int(v.strip(), 16) for v in s[2:-1].split(',')]
        word = words[lane if len(words) > 1 else 0]
        val = ('0x%08x' % word) + ('u' if backend == 'glsl' else '') if kind == 'u' else scalar_float(word)
    else:
        m = re.fullmatch(r'(r\d+|v\d+|o\d+|cb\d+\[\d+\])(?:\.([xyzw]+))?', s)
        assert m, s
        name, swizzle = m.groups(); swizzle = swizzle or 'xyzw'
        comp = 'xyzw'.index(swizzle[lane if len(swizzle) > 1 else 0])
        if backend == 'js':
            if name.startswith('cb'):
                cb, index = re.match(r'(cb\d+)\[(\d+)\]', name).groups()
                val = f'{cb}[{int(index)*4+comp}]'
                if kind == 'u': val = f'bits({val})'
            else: val = f'{name}.{kind}[{comp}]'
        else:
            val = name + '.' + 'xyzw'[comp]
            if name.startswith('cb'):
                if kind == 'u': val = f'floatBitsToUint({val})'
            elif kind == 'f': val = f'uintBitsToFloat({val})'
    if absolute: val = f'{"Math.abs" if backend == "js" else "abs"}({val})'
    if neg: val = f'(-({val}))'
    return val

def constructor(values, kind, backend):
    if backend == 'js': return '[' + ', '.join(values) + ']'
    if len(values) == 1: return values[0]
    return f'{"uvec" if kind == "u" else "vec"}{len(values)}(' + ', '.join(values) + ')'

def assign(dst, values, kind, backend):
    name = dst.split('.')[0]; cs = components(dst)
    if backend == 'js': return f'put({name}.{kind}, {cs}, {constructor(values,kind,backend)});'
    value = constructor(values, kind, backend)
    if kind == 'f': value = f'floatBitsToUint({value})'
    return f'{name}.{mask(dst)} = {value};'

def translate(backend):
    lines, indent = [], 1
    f = 'Math.fround' if backend == 'js' else ''
    def rnd(x): return f'f({x})' if backend == 'js' else f'({x})'
    def sat(x): return f'sat({x})' if backend == 'js' else f'clamp({x}, 0.0, 1.0)'
    for number, (opcode, args, source) in enumerate(ops):
        op = opcode.removesuffix('_sat'); saturated = opcode.endswith('_sat')
        if op == 'endif': indent -= 1; lines.append('  '*indent+'}'); continue
        if op == 'else': indent -= 1; lines.append('  '*indent+'} else {'); indent += 1; continue
        if op == 'ret': continue
        lines.append('  '*indent+'// '+source)
        if op == 'if_nz':
            x = operand(args[0], 0, 'u', backend)
            lines.append('  '*indent+f'if ({x} != {"0u" if backend == "glsl" else "0"}) {{'); indent += 1; continue
        if op in ('loadStructured', 'loadRaw'):
            if op == 'loadStructured':
                dst, index, offset, resource = args
                i, at = operand(index,0,'u',backend), operand(offset,0,'u',backend)
                table = resource.split('.')[0]
                call = f'bf2BoltEmitter({i}, {at})' if table == 't26' else f'bf2BoltDrawIndex({i}, {at})'
                if backend == 'js': call = f'load({"emitters" if table == "t26" else "drawIndices"}, ({i}) * {912 if table == "t26" else 4} + ({at}))'
            else:
                dst, offset, resource = args; at = operand(offset,0,'u',backend)
                call = f'bf2BoltParticle({at})' if backend == 'glsl' else f'load(particles, {at})'
            temp = 'loaded'+str(number)
            lines.append('  '*indent+f'{"const" if backend == "js" else "uvec4"} {temp} = {call};')
            sw = mask(resource)
            values = [f'{temp}[{"xyzw".index(sw[c])}]' for c in components(dst)]
            lines.append('  '*indent+assign(dst, values, 'u', backend)); continue
        if op == 'imul':
            assert args[0] == 'null'; args = args[1:]
        if op == 'sincos':
            for dst, func in zip(args[:2], ('sin','cos')):
                if dst == 'null': continue
                vals = [f'{"trig." if backend == "js" else ""}{func}({operand(args[2],c,"f",backend)})' for c in components(dst)]
                lines.append('  '*indent+assign(dst, vals, 'f', backend))
            continue
        dst, src = args[0], args[1:]
        integer = op in ('mov','movc','ftou','iadd','imad','imul','xor','and','or','ushr','lt','uge')
        out_kind = 'u' if integer else 'f'
        vals=[]
        for c in components(dst):
            F=lambda n,lane=c:operand(src[n],lane,'f',backend)
            U=lambda n,lane=c:operand(src[n],lane,'u',backend)
            if op == 'mov':
                expr=U(0)
                if src[0].startswith(('-', '|')): expr=f'{"bits" if backend=="js" else "floatBitsToUint"}({F(0)})'
            elif op == 'movc': expr=f'({U(0)} != {"0u" if backend=="glsl" else "0"} ? {U(1)} : {U(2)})'
            elif op in ('add','mul','div'): expr=f'({F(0)} {dict(add="+",mul="*",div="/")[op]} {F(1)})'
            elif op == 'mad': expr=f'({rnd(f"{F(0)} * {F(1)}")} + {F(2)})'
            elif op == 'iadd': expr=f'({U(0)} + {U(1)})'
            elif op in ('imul','imad'):
                expr=f'Math.imul({U(0)}, {U(1)})' if backend=='js' else f'({U(0)} * {U(1)})'
                if op=='imad': expr=f'({expr} + {U(2)})'
            elif op in ('xor','and','or','ushr'): expr=f'({U(0)} {dict(xor="^",and_="&",or_="|",ushr=">>" if backend=="glsl" else ">>>").get(op, "&" if op=="and" else "|")} {U(1)})'
            elif op in ('lt','uge'):
                a,b=(F(0),F(1)) if op=='lt' else (U(0),U(1))
                expr=f'({a} {"<" if op=="lt" else ">="} {b} ? {"0xffffffffu" if backend=="glsl" else "0xffffffff"} : {"0u" if backend=="glsl" else "0"})'
            elif op == 'ftou': expr=f'toUint({F(0)})' if backend=='js' else f'uint({F(0)})'
            elif op == 'utof': expr=U(0) if backend=='js' else f'float({U(0)})'
            elif op == 'f16tof32': expr=f'half({U(0)})' if backend=='js' else f'unpackHalf2x16({U(0)}).x'
            elif op in ('dp2','dp3','dp4'):
                terms=[rnd(f'{F(0,j)} * {F(1,j)}') for j in range(int(op[-1]))]
                expr=terms[0]
                for term in terms[1:]: expr=rnd(f'{expr} + {term}')
            elif op in ('max','min'): expr=f'{"Math." if backend=="js" else ""}{op}({F(0)}, {F(1)})'
            elif op in ('sqrt','log','exp','rsq','round_ni','frc'):
                expr=F(0)
                if op=='sqrt': expr=f'{"Math." if backend=="js" else ""}sqrt({expr})'
                elif op=='rsq': expr=f'1 / Math.sqrt({expr})' if backend=='js' else f'inversesqrt({expr})'
                elif op=='log': expr=f'{"Math." if backend=="js" else ""}log2({expr})'
                elif op=='exp': expr=f'2 ** {expr}' if backend=='js' else f'exp2({expr})'
                elif op=='round_ni': expr=f'{"Math." if backend=="js" else ""}floor({expr})'
                else: expr=f'({expr} - Math.floor({expr}))' if backend=='js' else f'fract({expr})'
            else: raise ValueError((op,args))
            if saturated: expr=sat(expr)
            vals.append(expr)
        lines.append('  '*indent+assign(dst, vals, out_kind, backend))
    assert indent == 1
    return '\n'.join(lines)

glsl='''// LOCAL-BLASTER-BOLT-VS-001. Generated from original f8781d702f DXBC.
// GLSL ES3. The caller supplies these bit-preserving resource load hooks.
// Out-of-range loads return zero, matching D3D buffers. See binding manifest.
uvec4 bf2BoltEmitter(uint element, uint byteOffset);
uvec4 bf2BoltParticle(uint byteOffset);
uvec4 bf2BoltDrawIndex(uint element, uint byteOffset);
struct BlasterBoltVertex { vec4 clip; vec4 v1; vec4 v2; vec4 v3;
  vec4 v4; vec4 v5; vec4 v6; vec4 v7; vec4 v8; };
BlasterBoltVertex evaluateBlasterBoltVertex(vec3 sourcePosition, vec2 sourceUv,
    uint instanceId, vec4 cb1[3], vec4 cb2[38]) {
  // Raw registers MUST stay uint. Representing shifted half words as floats
  // creates subnormals that ANGLE/drivers may flush before unpackHalf2x16.
  uvec4 v0=floatBitsToUint(vec4(sourcePosition,1.0)), v3=floatBitsToUint(vec4(sourceUv,0.0,0.0));
  uvec4 v4=uvec4(instanceId,0u,0u,0u);
'''
glsl+='  '+', '.join(['uvec4 r0=uvec4(0u)']+[f'r{i}=uvec4(0u)'for i in range(1,19)])+';\n'
glsl+='  '+', '.join(['uvec4 o0=uvec4(0u)']+[f'o{i}=uvec4(0u)'for i in range(1,9)])+';\n'
glsl+=translate('glsl')+'\n  return BlasterBoltVertex('+','.join(f'uintBitsToFloat(o{i})'for i in range(9))+');\n}\n'
(ROOT/'tools/materials/blaster-bolt-vertex-equations.glsl').write_bytes(glsl.encode())

js='''// Generated by tools/materials/blaster-bolt-build-vertex.py. Do not hand edit.
// Exact original VS register/buffer mapping; controlled native WARP fixtures
// determine numeric tolerance. Runtime camera and render state stay explicit.
const f=Math.fround, bitBuffer=new ArrayBuffer(4), bitF=new Float32Array(bitBuffer), bitU=new Uint32Array(bitBuffer);
const bits=v=>{bitF[0]=v;return bitU[0];};
const reg=()=>{const u=new Uint32Array(4);return {u,f:new Float32Array(u.buffer)};};
const put=(dst,mask,values)=>{for(let i=0;i<mask.length;i++)dst[mask[i]]=values[i];};
const sat=x=>Number.isNaN(x)?0:Math.min(1,Math.max(0,x));
const toUint=x=>x<=0||Number.isNaN(x)?0:x>=4294967295?4294967295:Math.trunc(x);
const view=b=>b instanceof DataView?b:ArrayBuffer.isView(b)?new DataView(b.buffer,b.byteOffset,b.byteLength):new DataView(b);
const load=(v,offset)=>Array.from({length:4},(_,i)=>offset+i*4+4<=v.byteLength?v.getUint32(offset+i*4,true):0);
const half=word=>{const h=word&65535,s=h&32768?-1:1,e=h>>>10&31,m=h&1023;return s*(e===0?m*2**-24:e===31?(m?NaN:Infinity):(1+m/1024)*2**(e-15));};
export function evaluateBlasterBoltVertex({position,uv,instanceId=0,cb1,cb2,emitters:emitterBytes,particles:particleBytes,drawIndices:indexBytes,trig=Math}) {
  const emitters=view(emitterBytes),particles=view(particleBytes),drawIndices=view(indexBytes);
  if(cb1.length<12||cb2.length<152)throw new Error('Original bolt VS requires CB1[3] and CB2[38]');
  const v0=reg(),v3=reg(),v4=reg();v0.f.set(position);v3.f.set(uv);v4.u[0]=instanceId;
'''
js+='  const '+', '.join(f'r{i}=reg()'for i in range(19))+';\n'
js+='  const '+', '.join(f'o{i}=reg()'for i in range(9))+';\n'
js+=translate('js')+'\n  return ['+','.join(f'o{i}.f'for i in range(9))+'];\n}\n'
js+='export const BLASTER_BOLT_VERTEX_GLSL = '+json.dumps(glsl)+';\n'
(ROOT/'web/src/blaster-bolt-vertex.js').write_bytes(js.encode())
manifest={
    'evidenceId':'LOCAL-BLASTER-BOLT-VS-001','shader':'f8781d702f',
    'shaderPath':'exports/rifle-trail/render-shaders/f8781d702f.dxbc',
    'shaderSha256':sha((DIR/'f8781d702f.dxbc').read_bytes()),
    'hexDisassemblySha256':sha(ASM.read_bytes()),'glslSha256':sha(glsl.encode()),
    'generatedJsSha256':sha(js.encode()),'instructions':len(ops),
    'inputLayout':[{'semantic':'TEXCOORD','index':0,'format':'R32G32B32_FLOAT','offset':0},
                   {'semantic':'TEXCOORD','index':1,'format':'R32G32B32A32_FLOAT','offset':0,'unused':True},
                   {'semantic':'TEXCOORD','index':2,'format':'R32G32B32A32_FLOAT','offset':0,'unused':True},
                   {'semantic':'TEXCOORD','index':3,'format':'R32G32_FLOAT','offset':12}],
    'interleavedStride':20,'instanceId':'SV_InstanceID',
    'streamOutput':[{'semantic':'SV_Position'if i==0 else'TEXCOORD','index':0 if i==0 else i-1,'components':4,'offset':i*16}for i in range(9)],
    'outputStride':144,
    'buffers':{'cb1':{'vec4Count':3,'drawBase':'[0].z','sorted':'[2].x > 0','emitterIndex':'uint([2].y)'},
               'cb2':{'vec4Count':38,'time':'[0].x','cameraBasis':'[2..4].xyz','relativeViewProjection':'[14..17]','cameraPosition':'[37].xyz'},
               't26':{'kind':'structured','stride':912,'uintHeader':{'ringStart':208,'ringCapacity':216,'particleBaseBytes':248,'particleStrideBytes':252}},
               't27':{'kind':'raw','recordBytes':88},'t28':{'kind':'structured','stride':4}},
    'known':['Original source input position/UV0 are unmodified. Mesh contains363vertices,1350indices.',
             'All float and uint immediates originate in D3DDisassemble PRINT_HEX_LITERALS output.',
             'Hash noise multiplier 0x2f800000 is 2^-32; the ordinary disassembly prints0.000000.',
             'GLSL raw registers are uvec4; shifted packed halfwords never travel through subnormal floats.',
             'Original ordinary-body and near-camera flare branches, all9outputs, ring/sorted addressing retained.'],
    'limitations':['CPU evaluator rounds each operation tofloat32 and splits mad; native allowed refactoring may fuse/reorder.',
                   'Native sincos approximation can differ from JavaScript/GLSL, especially after high-gain procedural noise.',
                   'Bindings are exact byte offsets; runtime camera convention and render-target/blend consumer remain separate.',
                   'Controlled original WARP comparison is recorded separately; this translation is not a game runtime capture.']}
(DIR/'render-material-vs-bindings.json').write_text(json.dumps(manifest,indent=2))
(ROOT/'web/public/assets/recovered-blaster-bolt-vertex.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'instructions':len(ops),'glslBytes':len(glsl),'jsBytes':len(js),'shaderSha256':manifest['shaderSha256']}))
