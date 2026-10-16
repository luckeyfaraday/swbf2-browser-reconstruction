"""Bounded read-only RVM inspection for native forward DFG input recovery."""
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
            if stage==1 and kind==2 and first<=1<first+count:
                slotref=ref(struct.unpack_from('<Q',block,offset+8)[0]);slot=struct.unpack_from('<I',raw(slotref),(1-first)*4)[0]>>16
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
    assert matches[0]['sampler']=='e639db23cb',matches
    return {'instance':instance,'applyBlock':apply,'applyRecord':record,'register':'s1','registerSlots':slotref,'slot':slot,'directInput':direct,'parameterKeys':keys,'parameter':parameter,**matches[0],
            'packedSamplerBytes16to19':list(raw(matches[0]['sampler'])[16:20]),
            'interpretation':'Packed bytes 0x14,3,3,1 match D3D min/mag linear, mip point, clamp U/V and wrap W. Native packed-to-D3D descriptor conversion remains unobserved.'}
def recover_binding():
    reverse=collections.defaultdict(list)
    for edges in EDGES.values():
        for edge in edges:reverse[edge['to']].append(edge['from'])
    queue=[('d825be064c',0)];seen=set();instances=[]
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
                if stage!=1 or kind!=1 or not(first<=2<first+count):continue
                slotref=ref(struct.unpack_from('<Q',block,offset+8)[0]);converted=slots(slotref)[2-first]
                source,conversion,source_ref,destination_ref=conversions[converted]
                candidates.append({'instance':instance,'function':function,'applyBlock':key,'applyRecord':offset//16,'applyHeader':block[offset:offset+8].hex(),'registerSlots':slotref,'convertedSlot':converted,'conversionInstruction':conversion,'sourceSlots':source_ref,'destinationSlots':destination_ref,'sourceSlot':source,'producer':producer.get(source)})
        assert len(candidates)==1,(instance,candidates)
        assert candidates[0]['producer']['selector']==122,candidates
        bindings.extend(candidates)
    assert len(bindings)==9,len(bindings)
    shader=ROOT/'exports/materials/floor-shader/d825be064c.dxbc'
    samplers=[sampler_binding(binding['instance'],binding['function']) for binding in bindings]
    return {'evidenceId':'BF2-NATIVE-DFG-BINDING-001','sourceRvm':'exports/materials/rvm/0.res','sourceRvmSha256':hashlib.sha256(DATA).hexdigest(),'shader':'d825be064c','shaderSha256':hashlib.sha256(shader.read_bytes()).hexdigest(),'register':'t2','lookupUV':['saturate(dot(normalizedWorldNormal,view))','perceptualRoughnessSquared'],'diffuseChannel':'z','functionBindings':bindings,'samplerBindings':samplers,'result':'All nine retained function instances bind t2 through legacy selector122(0x7a), matching SDK ShaderConstantFunction_ForwardShadingPreIntegratedFG; all nine s1 samplers resolve to the same native packed sampler.','nativeDispatch':'1415d7710 dispatches selector122 to1415d7310, which copies the resource pointer from source input +0x58. Earlier kind0x25 was actually the input slot index37, not an opcode.','generatorEvidence':'exports/lighting/dfg-generator/manifest.json','limitations':['Native active pass selection is not observed.','Original generator DXBC is executed on D3D11 WARP, not substituted with the Frosty preview or a guessed fit.']}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('keys',nargs='*');parser.add_argument('--function');parser.add_argument('--report',action='store_true');args=parser.parse_args()
    if args.report:
        report=recover_binding();destination=ROOT/'exports/lighting/dfg-binding.json';destination.write_text(json.dumps(report,indent=2));print(json.dumps({'report':str(destination),'bindings':len(report['functionBindings']),'selectors':sorted({x['producer']['selector'] for x in report['functionBindings']}),'inputSlots':sorted({x['producer']['inputSlot'] for x in report['functionBindings']})}));raise SystemExit
    if args.function:
        keys=reachable(args.function)
        selected=[key for key in keys if INDEX[key]['type'].endswith(('Dx11ApplyParametersBlock','Dx11TextureConversionInstructionData','DirectInputInstructionData','ParamDbSerializedReadView'))]
    else:selected=args.keys
    print(json.dumps([show(key) for key in sorted(selected)],indent=2))
