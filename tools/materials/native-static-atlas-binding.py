"""Bounded read-only RVM inspection for original floor atlas inputs."""
import argparse,collections,hashlib,json,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2]
INDEX=json.loads((ROOT/'exports/materials/rvm/block-index.json').read_text())['blocks']
META=json.loads((ROOT/'exports/materials/rvm/material-blocks.json').read_text())
DATA=(ROOT/'exports/materials/rvm/0.res').read_bytes()
GRAPH=json.loads((ROOT/'exports/materials/floor-shader/graph.json').read_text())
EDGES=collections.defaultdict(list)
for edge in GRAPH['edges']:EDGES[edge['from']].append(edge)
def raw(key):
    block=INDEX[key];return DATA[block['offset']:block['offset']+block['size']]
def ref(value):return f'{value&0xffffffffff:010x}'
def refs(key):return [(offset,ref(value[0])) for offset,value in zip(range(0,len(raw(key)),8),struct.iter_unpack('<Q',raw(key))) if ref(value[0]) in INDEX] if len(raw(key))%8==0 else []
def show(key):
    block=INDEX[key]
    return {'hash':key,**block,'hex':raw(key).hex() if block['size']<=384 else None,'references':[{'offset':offset,'hash':child,'type':INDEX[child]['type']} for offset,child in refs(key)],'decoded':META.get(key,{}).get('values')}
def reachable(key):
    pending=[key];seen=set()
    while pending:
        current=pending.pop()
        if current in seen:continue
        seen.add(current);pending.extend(edge['to'] for edge in EDGES[current])
    return seen
def sampler_binding(instance,function):
    graph=reachable(function);candidates=[]
    for key in graph:
        if not INDEX[key]['type'].endswith('Dx11ApplyParametersBlock'):continue
        block=raw(key)
        for offset in range(0,len(block),16):
            stage,kind,first=block[offset:offset+3];count=struct.unpack_from('<I',block,offset+4)[0]
            if stage==1 and kind==2 and first<=0<first+count:
                slotref=ref(struct.unpack_from('<Q',block,offset+8)[0]);slot=struct.unpack_from('<I',raw(slotref),(0-first)*4)[0]>>16
                candidates.append((key,offset//16,slotref,slot))
    assert len(candidates)==1,candidates
    apply,record,slotref,slot=candidates[0]
    direct=next(key for key in graph if INDEX[key]['type'].endswith('DirectInputInstructionData'))
    view=refs(direct)[0][1];keys=refs(view)[0][1];parameter=refs(keys)[slot][1]
    assert INDEX[parameter]['type'].endswith('SerializedParamDbKey')
    assert struct.unpack_from('<I',raw(parameter),8)[0]==3322792717
    combined=next(child for _,child in refs(instance) if INDEX[child]['type'].endswith('CombinedSerializedParameterBlock'))
    block_array=refs(combined)[0][1];matches=[]
    for _,block in refs(block_array):
        source_keys,values=[child for _,child in refs(block)[:2]]
        for index,(_,candidate) in enumerate(refs(source_keys)):
            if candidate!=parameter:continue
            value=refs(values)[index][1];sampler=refs(value)[0][1]
            matches.append({'parameterBlock':block,'parameterIndex':index,'valueRef':value,'sampler':sampler,'samplerBytes':raw(sampler).hex()})
    assert len(matches)==1,matches
    assert matches[0]['sampler']=='9216198462',matches
    return {'instance':instance,'applyBlock':apply,'applyRecord':record,'register':'s0','registerSlots':slotref,'slot':slot,'directInput':direct,'parameterKeys':keys,'parameter':parameter,**matches[0],
            'packedSamplerBytes16to19':list(raw(matches[0]['sampler'])[16:20]),
            'interpretation':'Packed bytes 0x15,3,3,1 match D3D min/mag/mip linear, clamp U/V and wrap W. Native packed-to-D3D descriptor conversion remains unobserved.'}
def recover_binding():
    reverse=collections.defaultdict(list)
    for edges in EDGES.values():
        for edge in edges:reverse[edge['to']].append(edge['from'])
    queue=[('f789fdaafa',0)];seen=set();instances=[]
    while queue:
        key,depth=queue.pop(0)
        if key in seen or depth>7:continue
        seen.add(key)
        if INDEX[key]['type'].endswith('RvmFunctionInstance'):instances.append(key)
        else:queue.extend((parent,depth+1) for parent in reverse[key])
    bindings=[]
    slots=lambda key:[item[0]>>16 for item in struct.iter_unpack('<I',raw(key))]
    for instance in sorted(instances):
        function=next(child for _,child in refs(instance) if INDEX[child]['type'].endswith('RvmFunction'))
        graph=reachable(function)
        conversions={}
        for key in graph:
            if INDEX[key]['type'].endswith('Dx11TextureConversionInstructionData'):
                source,destination=[child for _,child in refs(key)]
                for src,dst in zip(slots(source),slots(destination)):conversions[dst]=(src,key,source,destination)
        producer={}
        for key in graph:
            if INDEX[key]['type'].endswith('LegacyInstructionData'):
                block=raw(key)
                for offset in range(0,len(block),20):
                    instruction=block[offset:offset+20];slot=struct.unpack_from('<I',instruction,12)[0]>>16
                    producer[slot]={'block':key,'record':offset//20,'byteOffset':INDEX[key]['offset']+offset,'bytes':instruction.hex(),'inputScope':struct.unpack_from('<H',instruction,0)[0],'inputSlot':struct.unpack_from('<H',instruction,2)[0],'selector':struct.unpack_from('<H',instruction,16)[0]}
        candidates=[]
        for key in graph:
            if not INDEX[key]['type'].endswith('Dx11ApplyParametersBlock'):continue
            block=raw(key)
            for offset in range(0,len(block),16):
                stage,kind,first=block[offset:offset+3];count=struct.unpack_from('<I',block,offset+4)[0]
                if stage!=1 or kind!=1:continue
                slotref=ref(struct.unpack_from('<Q',block,offset+8)[0])
                for register in range(max(2,first),min(7,first+count)):
                    converted=slots(slotref)[register-first]
                    source,conversion,source_ref,destination_ref=conversions[converted]
                    candidates.append({'register':'t'+str(register),'instance':instance,'function':function,'applyBlock':key,'applyRecord':offset//16,'applyHeader':block[offset:offset+8].hex(),'registerSlots':slotref,'convertedSlot':converted,'conversionInstruction':conversion,'sourceSlots':source_ref,'destinationSlots':destination_ref,'sourceSlot':source,'producer':producer.get(source)})
        assert len(candidates)==5,(instance,candidates)
        assert sorted(x['producer']['selector'] for x in candidates)==list(range(18,23)),candidates
        bindings.extend(candidates)
    assert len(bindings)==40,len(bindings)
    shader=ROOT/'exports/materials/floor-shader/f789fdaafa.dxbc'
    enums={x['value']:x['name'] for x in json.loads((ROOT/'exports/lighting/dfg-native-enums.json').read_text()) if x['type']=='ShaderConstantFunction'}
    for binding in bindings:binding['producer']['name']=enums[binding['producer']['selector']]
    return {'evidenceId':'BF2-NATIVE-STATIC-ATLAS-BINDING-001','sourceRvm':'exports/materials/rvm/0.res','sourceRvmSha256':hashlib.sha256(DATA).hexdigest(),'shader':'f789fdaafa','shaderSha256':hashlib.sha256(shader.read_bytes()).hexdigest(),'functionBindings':bindings,'result':'All eight retained RGB-direction atlas function instances map t2 through t6 to explicit native lightmap texture selectors 18 through 22.','limitations':['Legacy selector numeric dispatch implementation has not been decompiled here.','Native active pass selection is static evidence, not a recorded game frame.']}
if __name__=='__main__':
    report=recover_binding();path=ROOT/'exports/lighting/static-atlas-shader-binding.json';path.write_text(json.dumps(report,indent=2))
    instances={b['instance']:b['function'] for b in report['functionBindings']}
    samplers=[sampler_binding(instance,function) for instance,function in sorted(instances.items())]
    (ROOT/'exports/lighting/static-atlas-sampler-binding.json').write_text(json.dumps({'evidenceId':'BF2-NATIVE-STATIC-ATLAS-SAMPLER-001','samplerBindings':samplers},indent=2))
    print(json.dumps({'bindings':len(report['functionBindings']),'samplers':len(samplers),'selectors':sorted({b['producer']['selector'] for b in report['functionBindings']})}))
