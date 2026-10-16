"""Bounded direct explicit-binormal layout proof, outside runtime publication."""
import collections
import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/native-tangent44'
read = lambda p: json.loads((ROOT / p).read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
source = read('exports/materials/native-tangent-metallic/selection.json')
targets = [r for r in source['excluded'] if r['sourceStride'] == 44]
assert len(targets) == 3
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'selection.json').write_text(json.dumps(dict(evidenceId='BF2-NATIVE-TANGENT44-001', targets=targets,
    sourceSelectionSha256=sha((ROOT / 'exports/materials/native-tangent-metallic/selection.json').read_bytes())), indent=2)+'\n')
(OUT / 'names.txt').write_text('\n'.join(f"{r['name']}|{r['sourceLod']}|{r['sourceMaterialId']}" for r in targets)+'\n')
raw = (ROOT / 'exports/materials/rvm/0.res').read_bytes()
index = read('exports/materials/rvm/block-index.json')['blocks']
graph = read('exports/materials/master1uv-emissive-shader/graph.json')
links = collections.defaultdict(list)
for edge in graph['edges']:
    links[edge['from']].append(edge)

def block(key):
    row = index[key]
    return raw[row['offset']:row['offset']+row['size']]

def route(start, target, depth=4):
    if start == target:
        return []
    if not depth:
        return None
    for edge in links[start]:
        rest = route(edge['to'], target, depth-1)
        if rest is not None:
            value = struct.unpack_from('<Q', block(start), edge['offset'])[0]
            assert value == int(edge['encoded']) and value & 0xffffffffff == int(edge['to'],16)
            return [edge]+rest
    return None

layout='21d0b76a8c'
decoded=[]
for string, semantic, fmt, slot, offset, kind, step in struct.iter_unpack('<Q6I',block(layout)):
    assert block(f'{string & 0xffffffffff:010x}') == b'TEXCOORD\0'
    decoded.append(dict(semantic='TEXCOORD',index=semantic,dxgiFormat=fmt,inputSlot=slot,offset=offset,classification=kind,step=step))
assert [(r['index'],r['dxgiFormat'],r['offset']) for r in decoded] == [(0,6,0),(1,10,12),(2,10,20),(3,10,28),(4,10,36)]
assert all(r['inputSlot']==r['classification']==r['step']==0 for r in decoded)
shaders=[]
for vertex,pixel,parameter,atlas in [('d4f2fe6832','5ffbbd02c2','ffaedac3ce',False),('5a2ec69557','d1092739db','a812ad74e3',True)]:
    vs=next(k for k,r in graph['blocks'].items() if r['type'].endswith('Dx11VsShader') and any(e['to']==vertex for e in links[k]))
    paths=dict(vertex=route(parameter,vertex),pixel=route(parameter,pixel),layout=route(vs,layout))
    assert all(paths.values())
    hashes={}
    for key,name in [('vertex',vertex),('pixel',pixel)]:
        bytecode=(ROOT/f'exports/materials/master1uv-emissive-shader/{name}.dxbc').read_bytes()
        encoded=block(name);start=encoded.index(b'DXBC');length=struct.unpack_from('<I',encoded,start+24)[0]
        assert bytecode == encoded[start:start+length]
        hashes[key+'Sha256']=sha(bytecode)
    shaders.append(dict(family='master1uv-emissive',vertex=vertex,pixel=pixel,atlas=atlas,vertexObject=vs,parameterBlock=parameter,paths=paths,
        **hashes,inputLayoutBlock=layout,inputLayoutOffset=index[layout]['offset'],inputLayoutSha256=sha(block(layout)),inputLayout=decoded,
        normalOutputRegister=3 if atlas else 2,frameOutputRegisters=[4,5,6] if atlas else [3,4,5]))
document=dict(evidenceId='BF2-NATIVE-TANGENT44-001',sourceRvmSha256=sha(raw),sourceStride=44,shaders=shaders,
    shaderInputBindings=dict(position='input0.xyz Float3 at0',binormal='input1.xyz Half4 at12',normal='input2.xyz Half4 at20',
        tangent='input3.xyz Half4 at28',uv0='input4.xy Half2 at36',radiosity='input4.zw Half2 at40'),
    frameEquation='N=normalize(M*sourceNormal); T=normalize(M*(-sourceTangent)); B=normalize(M*sourceBinormal)',
    limitations=['Source Binormal XYZ is an independent original vector, not an inferred cross product or W-channel handedness.',
        'Three selected rigid44-byte metallic sections only; no48-byte, color, other family or native converter generalization.',
        'Native pass dispatch and a running original frame are not captured. This builder does not activate runtime support.'])
(OUT/'shader-routing.json').write_text(json.dumps(document,indent=2)+'\n')
print(json.dumps(dict(records=len(targets),sourceStride=44,shaders=len(shaders))))
