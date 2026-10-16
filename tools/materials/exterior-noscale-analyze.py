"""Source-bound exterior no-object-scale material recovery; no native execution."""
import collections,hashlib,json,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/exterior-noscale-shader'
NAME='Objects/Architecture/_GalacticEmpire/_Shaders/SS_DeathStar_Props_Exterior_01_NoObjectScale_01'
data=(ROOT/'exports/materials/rvm/0.res').read_bytes();index=json.loads((ROOT/'exports/materials/rvm/block-index.json').read_text())['blocks']
meta=json.loads((ROOT/'exports/materials/rvm/material-blocks.json').read_text());split=json.loads((ROOT/'exports/materials/final-map-blocks.json').read_text())['blocks']
by_rid={b['source']['rid']:b for b in split};parameters={p['packedFlags']:p for b in split for p in b.get('parameters',[])}
plan=json.loads((ROOT/'exports/materials/final-map-material-plan.json').read_text());graph=json.loads((OUT/'graph.json').read_text())
def raw(k):
    b=index[k];return data[b['offset']:b['offset']+b['size']]
def ref(v):return f'{int(v)&0xffffffffff:010x}'
def slots(k):return [v[0]>>16 for v in struct.iter_unpack('<I',raw(k))]
def params_under(k,seen):
    if k in seen:return []
    seen.add(k);b=by_rid[k]
    return [(b,p)for p in b.get('parameters',[])]+[p for c in b.get('children',[])for p in params_under(c,seen)]
h=5381
for c in NAME.lower():h=((h*33)^ord(c))&0xffffffff
assert h==graph['sourceNameHash']==1764561980
chain=['3f3868dbc7','eb389e06b6','4b494fe52c','75804534d2','9d1630ead6','c0a1dc0b7b','5da54a413a','263cd638e8','f59a7c10f4','b914af4bec','937a1c1e31','87f18d3646']
for parent,child in zip(chain,chain[1:]):assert any(e['from']==parent and e['to']==child for e in graph['edges'])
assert ref(meta['f59a7c10f4']['values'][20]['hash'])=='ae466c39eb'
assert ref(meta['ae466c39eb']['values'][0]['hash'])=='e8b5691d4c'
assert ref(struct.unpack_from('<Q',raw('e8b5691d4c'),32)[0])=='971c1855d6'
keys=meta['e2a933ba3b']['values'];default_keys=meta['d1c9d57812']['values'];default_values=meta['f59a7c10f4']['values']
assert slots('91d05b932e')==[27,22] and slots('b705e05358')==[42,43]
assert raw('9f7cc71c51')[48:56]==bytes.fromhex('0101020002000000')
mapping=[]
for register,(role,slot)in enumerate(zip(['base','detail'],slots('91d05b932e')),2):
    key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
    mapping.append({'register':f't{register}','role':role,'convertedSlot':42+register-2,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters[packed]['nameHash']})
writes=[(v>>16,off,n)for v,off,n in struct.iter_unpack('<IHH',raw('3dc36fe0b4'))]
assert writes==[(7,0,1),(26,16,1),(12,32,1),(4,48,1),(11,64,1),(29,0,1)]
assert slots('4685a9a555')==[40] and slots('916e6db529')==[39]
constants=[]
for cb,((slot,offset,count),role)in enumerate(zip(writes[:5],['uvScale','baseColor','wearColor','smoothnessMultiplier','metalnessMultiplier'])):
    key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
    n=[ref(k['hash'])for k in default_keys].index(key);vr=ref(default_values[n]['hash']);vector=ref(meta[vr]['values'][0]['hash'])
    constants.append({'register':f'cb1[{cb}]','role':role,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters.get(packed,{}).get('nameHash'),
                      'defaultIndex':n,'defaultVectorBlock':vector,'defaultSourceOffset':index[vector]['offset'],'default':list(struct.unpack('<4f',raw(vector)))})
scene=json.loads((ROOT/'web/public/assets/map.scene.json').read_text());placed=collections.Counter(i['assetId']for i in scene['instances']);materials=[];textures={}
for mesh in plan['meshes']:
    for material in mesh['materials']:
        if(material.get('shader')or{}).get('name')!=NAME:continue
        bindings={b['parameterHash']:b for b in material['fallbackTextureBindings']};assert set(bindings)==set(b['parameterHash']for b in mapping)
        source=next(iter(bindings.values()));assert all(b['variationHash']==0 and b['sourceEntry']==source['sourceEntry'] and b['sourceSection']==source['sourceSection']for b in bindings.values())
        section=by_rid[by_rid[source['sourceEntry']]['children'][source['sourceSection']]];params=params_under(section['children'][1],set())
        row={'assetId':mesh['guid'],'meshName':mesh['name'],'materialId':material['index'],'sourceShader':material['shader'],'sourceEntry':source['sourceEntry'],'sourceSection':source['sourceSection'],
             'variationHash':0,'placementCount':placed[mesh['guid']],'bindings':{x['role']:bindings[x['parameterHash']]for x in mapping},'constants':[],'constantEvidence':[]}
        for c in constants:
            matches=[(b,p)for b,p in params if p['packedFlags']==c['packedLow48']];assert len({p['rawHex']for _,p in matches})<=1
            if matches:
                b,p=matches[0];value=list(struct.unpack('<4f',bytes.fromhex(p['rawHex'])));e={'kind':'exact-section-override','sourceBlock':b['source']['rid'],'sourceBlockSha256':b['sha256'],'offset':p['offset'],'rawHex':p['rawHex']}
            else:value=c['default'];e={'kind':'rvm-shader-default','sourceBlock':c['defaultVectorBlock'],'sourceOffset':c['defaultSourceOffset']}
            row['constants'].append(value);row['constantEvidence'].append(e)
        materials.append(row)
        for b in bindings.values():textures[b['texture']['fileGuid']]=b['texture']
assert len(materials)==4 and len(textures)==3 and sum(m['placementCount']for m in materials)==87
producer=['mov o0.w, l(0)','mov o2.xz, l(0,0,0.500000,0)']
normal_ops=['mul r3.xyz, r2.xxxx, r6.xyzx','mul r4.yzw, r2.xxxx, r6.xxyz',
            'mad r5.xyz, r3.xyzx, l(1.000000, 1.000000, 0.000000, 0.000000), r4.yzwy',
            'mul r2.xy, r5.zyzz, r5.zyzz','dp3 r0.x, r5.xyzx, r5.xyzx','mul r0.xyz, r0.xxxx, r5.xyzx']
shader=(OUT/'87f18d3646.asm').read_text();assert all(op in shader for op in producer+normal_ops)
model=json.loads((ROOT/'exports/materials/metalonly-shader/material-analysis.json').read_text())['nativeMaterialModel'];model={**model,'producerOperations':producer}
audit=json.loads((ROOT/'exports/materials/visible-material-audit.json').read_text());visible=next(x for x in audit['remainingFamilies']if x['shader']==NAME)
report={'evidenceId':'LOCAL-EXTERIOR-NOSCALE-SHADER-001','analysisKind':'Retained-source static decoding; no native execution','shaderName':NAME,'shaderNameHash':h,'shaderGuid':graph['sourceGuid'],
        'pixelShader':'87f18d3646','pixelShaderSha256':hashlib.sha256((OUT/'87f18d3646.dxbc').read_bytes()).hexdigest(),
        'pairedVertexShader':'971c1855d6','pairedVertexShaderSha256':hashlib.sha256((OUT/'971c1855d6.dxbc').read_bytes()).hexdigest(),'sourceRvmSha256':hashlib.sha256(data).hexdigest(),
        'selectionChain':[{'block':k,**index[k]}for k in chain],'functionInstance':'9d1630ead6','function':'f8b6bd5e1d','inputKeyTable':'e2a933ba3b',
        'textureConversionSourceSlots':'91d05b932e','textureConversionTargetSlots':'b705e05358','applyBlock':'9f7cc71c51','constantWriteOps':'3dc36fe0b4','pixelConstantTableOutputSlot':39,'vertexConstantTableOutputSlot':40,
        'textureMapping':mapping,'constantMapping':constants,'materials':materials,'sourceTextures':textures,'placedSectionCount':87,'visibleCoverage':{k:v for k,v in visible.items()if k!='members'},'nativeMaterialModel':model,
        'nativeLightingInputs':{'shNormal':'unnormalized-world-normal-sum','normalExpression':'bf2_exterior_prelightingNormal','normalInstructions':normal_ops,'materialId':0,'reflectance':.5,
                                'metalness':'2*(1-base.a)*detail.a*cb1[4].x','ao':'base.b','emissive':[0,0,0],'deferredConsumerEvidence':'BF2-NATIVE-GBUFFER-001',
                                'normalEquation':'normalize(TBN*baseNormal)+normalize(TBN*detailNormal)*worldAxisMask(1,1,0); normalize this sum only for final G-buffer normal.'},
        'limitations':['Default variation0 only; native runtime permutation selection is unobserved.',
                       'Packed native tangent stream remains undecoded; derivative tangent parity is unproven.',
                       'Source explicitly masks WORLD X/Y detail normal components. Browser world axes are the currently preserved source axes; future coordinate conversion must transform this mask.',
                       'Native SH uses an unnormalized world sum; applying generic normalized SH would change the source polynomial.',
                       'Three/native BRDF, broad specular, reflection projection and sampling details remain separately incomplete.',
                       'DDS format transfer functions are preserved; resource-view overrides and regenerated lower PNG mips remain limits.']}
(OUT/'material-analysis.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'materials':len(materials),'textures':len(textures),'mapping':mapping,'constantMapping':constants,'selectedConstants':[(m['meshName'].split('/')[-1],m['constants'])for m in materials]},indent=2))
