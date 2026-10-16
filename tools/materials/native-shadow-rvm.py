"""Close local-shadow bias -> floor RVM -> named DX11 state, without execution."""
from pathlib import Path
import collections
import hashlib
import json
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/materials/python-libs'))
import cityhash

seed = ROOT/'tools/materials/native-dfg-pe.py'
ns = {'__file__': str(seed)}
exec(seed.read_text().split('names =')[0], ns)
exe, base, to_offset = ns['data'], ns['image_base'], ns['to_offset']
assert hashlib.sha256(exe).hexdigest() == 'd350b321fcf2d17168d3696a5bbd94e8b74d59f4672b505a8a3ebf9906ee6ae4'

def read(address, size):
    at = to_offset(address-base)
    return exe[at:at+size]

def key(name, type_name, module, count=1):
    # 14136db60: four LE32 lengths/count followed by exact source strings.
    parts = [v.encode() for v in [name, type_name, module]]
    payload = struct.pack('<4I', count, *map(len, parts))+b''.join(parts)
    legacy = 5381
    for c in name.lower().encode():
        legacy = ((legacy*33)^c)&0xffffffff
    return (cityhash.CityHash64(payload)&0xffffffffffff)|((legacy&0xffff)<<48)

names = ['!depthBiasGroup', '!dispatchListDepthBiasGroup']
keys = [key(v, 'ShaderDepthBiasGroup', 'Render') for v in names]
assert keys == [0x362f737f43153b50, 0x7c3d16efa38ffb1e]
assert read(0x14342c618, len(names[0])+1) == names[0].encode()+b'\0'
assert read(0x14342c628, len(names[1])+1) == names[1].encode()+b'\0'
assert struct.unpack('<Q', read(0x144bf3570+0x38,8))[0] == 0x146c525d0
constructor_bytes = bytes.fromhex('4885c97425488d0574f87ffcc74108000000004889014889c8c3')
assert read(0x146c525d0,len(constructor_bytes)) == constructor_bytes
assert struct.unpack('<Q',read(0x143451e50+0x18,8))[0] == 0x146c52d80
assert struct.unpack('<Q',read(0x1434531e0+8,8))[0] == 0x146c5aca0

# Exact instruction windows, verified against the retained bounded assembly.
# These assert the joins, not merely the existence of similarly named fields.
assertions = [
    (0x140f715fc, '8b41648985a8040000', 'wrapper+64 -> descriptor+538'),
    (0x140d8e369, '0f280520f68503660f7f85d0010000', 'named dispatch key -> layout entry21'),
    (0x140d89d8d, '0fb748548b8738050000890431', 'descriptor+538 -> layout entry21'),
    (0x1415efd5a, '8b4224440fb7c8c1e8100fb7c84b8b04cb488b0cc88b42200fb7d0c1e810448b014585c00fb7c8498b04d3488b0cc8418b070fb7d0448b09450f45c8c1e810', 'RVM handles +24/+20; nonzero dispatch override replaces base'),
    (0x1415efda0, '488d15d9d200034963d9488b3cc8498bce4c8d049fe826a8dcfe4c8d4744498bce4d8d0498488d15d4d20003e80fa8dcfe', 'group indexes original bias and slope tables into exact DX11 keys'),
    (0x1415e5b9d, '488d8ba000000041b9010000004c8d0527324403488d1508dbe601e88326d9ff', 'DX11 property index10 named $depthBias'),
    (0x1415e5bdd, '488d8bc000000041b9010000004c8d0507314403488d15e8dae601e84326d9ff', 'DX11 property index12 named $slopeScaledDepthBias'),
]
for address, encoded, role in assertions:
    expected = bytes.fromhex(encoded)
    assert read(address,len(expected)) == expected, role
for address, name in [(0x1434536c0,'$depthBias'),(0x1434536e0,'$slopeScaledDepthBias')]:
    assert read(address,len(name)+1) == name.encode()+b'\0'

graph_path = ROOT/'exports/materials/floor-shader/graph.json'
graph = json.loads(graph_path.read_text())
rvm = (ROOT/'exports/materials/rvm/0.res').read_bytes()
parents, children = collections.defaultdict(list), collections.defaultdict(list)
for edge in graph['edges']:
    parents[edge['to']].append(edge['from'])
    children[edge['from']].append(edge)

def raw(block):
    entry = graph['blocks'][block]
    return rvm[entry['offset']:entry['offset']+entry['size']]

def find(start, type_suffix, reverse=False):
    seen, pending = set(), [start]
    while pending:
        block = pending.pop()
        if block in seen:
            continue
        seen.add(block)
        if graph['blocks'][block]['type'].endswith(type_suffix):
            yield block
        else:
            pending.extend(parents[block] if reverse else [e['to'] for e in children[block]])

def ref_at(block, offset):
    return next(e['to'] for e in children[block] if e['offset']==offset)

records = []
for block, entry in graph['blocks'].items():
    if not entry['type'].endswith('_Dx11LegacyDrawStateBuilderData'):
        continue
    values = struct.unpack('<23I', raw(block))
    bindings = []
    for function in find(block, '_RvmFunction', True):
        for direct in find(function, '_DirectInputInstructionData'):
            read_view = ref_at(direct,0)
            ordered_keys = ref_at(read_view,0)
            order = [e['to'] for e in sorted(children[ordered_keys], key=lambda e:e['offset'])]
            handles = [values[i] for i in [0,8,9]]
            assert all(v&0xffff == 0 for v in handles), (block, handles)
            slots = [v>>16 for v in handles]
            direct_handles = struct.unpack_from('<IIH',raw(direct),8)
            # 1415cd610 copies these fields; 146c49b20 ->1415cd900 writes
            # ordered ordinals below splitCount to firstHandle+ordinal.
            assert direct_handles[0] == 0 and max(slots) < direct_handles[2]
            if max(slots) >= len(order):
                continue
            serialized = [struct.unpack('<QIHH',raw(order[slot])) for slot in slots]
            if [v[0] for v in serialized[1:]] != keys:
                continue
            assert serialized[0][1] == 0xd946931e
            assert all(v[1]==0x191c1d07 and v[2]==1 for v in serialized[1:])
            bindings.append({'function':function,'directInput':direct,'readView':read_view,
                'orderedKeys':ordered_keys,'slots':slots,'directInputHandles':list(direct_handles),
                'serializedKeyBlocks':[order[i] for i in slots]})
    assert bindings, block
    records.append({'block':block,'offset':entry['offset'],'bytes':entry['size'],
        'sha256':hashlib.sha256(raw(block)).hexdigest(),'bindings':bindings})
assert len(records)==23

functions = [(0x146c52d80,0x146c52dce),(0x146c5aca0,0x146c5af5e),
    (0x1415efd20,0x1415eff2d),(0x1415e5a70,0x1415e5d06),
    (0x1415e6ca0,0x1415e70d4),(0x1415ec7f0,0x1415ecbb4),
    (0x14136db60,0x14136e338),(0x1414ec1b0,0x1414ee57a),
    (0x140d8e210,0x140d8e467),(0x140d89c10,0x140d89fae),
    (0x140f714a0,0x140f716fa),(0x1415cd610,0x1415cd69b),
    (0x146c49b20,0x146c49b5c),(0x1415cd900,0x1415cd99e)]
evidence = {'evidenceId':'BF2-NATIVE-SHADOW-DX11-BIAS-001','schemaVersion':1,
    'sourceExecutableSha256':hashlib.sha256(exe).hexdigest(),
    'keys':[{'name':name,'type':'ShaderDepthBiasGroup','module':'Render','count':1,
        'hash64':f'{value:016x}'} for name,value in zip(names,keys)],
    'keyAlgorithm':'14136db60: CityHash64(LE32(count,len(name),len(type),len(module))+name+type+module), low48; high16=low16(case-insensitive DJB2-XOR(name)).',
    'instructionAssertions':[{'address':hex(a),'hex':b,'role':r} for a,b,r in assertions],
    'functions':[{'start':hex(a),'endExclusive':hex(b),'sha256':hashlib.sha256(read(a,b-a)).hexdigest(),
        'path':f'exports/lighting/dfg-native-functions/{a:x}.c'} for a,b in functions],
    'floorGraphSha256':hashlib.sha256(graph_path.read_bytes()).hexdigest(),
    'floorDrawStateBuilderCount':len(records),'floorDrawStateBuilders':records,
    'producer':{'localShadowDescriptor':'140f714a0: descriptor base uStack_5a8, group uStack_70 = +0x538',
        'layout':'140d8e210: entry21 is !dispatchListDepthBiasGroup, original key 1445ed990',
        'write':'140d89c10: layout entry21 (byte offset0x54) copies input descriptor+0x538'},
    'consumer':{'factoryMetadata':'0x144bf3570','concreteConstructor':'0x146c525d0',
        'factoryVtable':'0x143451e50','implementationVtable':'0x1434531e0',
        'read':'1415efd20: data+0x20 base group, data+0x24 dispatch override; nonzero override replaces base',
        'table':'data+0 resolves DepthBiasGroupData; bias=table[group], slope=table[0x44+group*4]',
        'dx11Keys':{'depthBias':'0x1445fd080','slopeScaledDepthBias':'0x1445fd0a0'},
        'dx11Create':'1415e6ca0 ->1415ec7f0 -> ID3D11Device.CreateRasterizerState or Device3.CreateRasterizerState2'},
    'limitations':['All 23 retained floor draw-state builders share the proven bias input semantics; native frame-selected caster shader/LOD is not captured.',
        'Shadow processor submission/culling, comparison sampler and WebGL depth-bias equivalence still require separate proof.',
        'No original game execution, GPU rendering or runtime activation performed.']}
(ROOT/'exports/lighting/native-shadow-rvm-bias.json').write_text(json.dumps(evidence,indent=2)+'\n')
print(json.dumps({'floorBuilders':len(records),'functionBindings':sum(len(v['bindings']) for v in records),'keys':[v['hash64'] for v in evidence['keys']]}))
