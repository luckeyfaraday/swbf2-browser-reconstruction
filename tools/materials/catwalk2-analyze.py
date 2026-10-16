"""Recover exact CatwalkSystem_Preset_02 routing, packed inputs and constants."""
import collections, hashlib, json, pathlib, struct
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'exports/materials/catwalk2-shader'
NAME='Objects/Props/ObjectSets/_Generic/CatwalkSystem_01/SS_CatwalkSystem_Preset_02'
data=(ROOT/'exports/materials/rvm/0.res').read_bytes()
index=json.loads((ROOT/'exports/materials/rvm/block-index.json').read_text())['blocks']
meta=json.loads((ROOT/'exports/materials/rvm/material-blocks.json').read_text())
split=json.loads((ROOT/'exports/materials/final-map-blocks.json').read_text())['blocks']
by_rid={b['source']['rid']:b for b in split}
parameters={p['packedFlags']:p for b in split for p in b.get('parameters',[])}
plan=json.loads((ROOT/'exports/materials/final-map-material-plan.json').read_text())
graph=json.loads((OUT/'graph.json').read_text())
def raw(k):
    b=index[k]
    return data[b['offset']:b['offset']+b['size']]
def ref(value):return f'{int(value)&0xffffffffff:010x}'
def slots(k):return [v[0]>>16 for v in struct.iter_unpack('<I',raw(k))]
def params_under(k,seen):
    if k in seen:return []
    seen.add(k);b=by_rid[k]
    return [(b,p) for p in b.get('parameters',[])]+[p for c in b.get('children',[]) for p in params_under(c,seen)]
h=5381
for ch in NAME.lower():h=((h*33)^ord(ch))&0xffffffff
assert h==graph['sourceNameHash']==2105226254
chain=['dc8e628ebf','217c8d2a74','bbbd64177e','4bcd14fd7f','5331dc4e1e','9b2b8ec985','8f2409e1ce','2ded4290be','2b9f675449','dcb4cf2a75','7bcfdb74a1','2b6d233517']
for parent,child in zip(chain,chain[1:]):assert any(e['from']==parent and e['to']==child for e in graph['edges'])
assert ref(meta['2b9f675449']['values'][16]['hash'])=='639a7ec2b4'
assert ref(meta['639a7ec2b4']['values'][0]['hash'])=='3c3b5e2387'
assert ref(struct.unpack_from('<Q',raw('3c3b5e2387'),32)[0])=='ea0522bd70'
read_keys=meta['9f5f8da3a0']['values']
assert slots('1bc318c6c1')==[6,31,18]
assert slots('1b99e3538d')==[36,37,38]
assert slots('8acd8b352a')==[36,38,37]
assert raw('a4b167e3fa')[32:40]==bytes.fromhex('0101020003000000')
conversion=dict(zip(slots('1b99e3538d'),slots('1bc318c6c1')))
mapping=[]
for register,(role,converted) in enumerate(zip(['base','detail','grunge'],slots('8acd8b352a')),2):
    slot=conversion[converted];key=ref(read_keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
    mapping.append({'register':f't{register}','role':role,'convertedSlot':converted,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters[packed]['nameHash']})
# Table order differs from earlier recovered shaders: PS table is first, VS second.
assert [(v>>16,off,n) for v,off,n in struct.iter_unpack('<IHH',raw('abe2d6ba68'))]==[(24,0,1),(25,0,1)]
assert slots('6b46f85781')==[35] # apply VS constant buffer0
assert slots('59d4478b1b')==[34] # apply PS constant buffer1
assert raw('bb2440dcb4')[:4]==struct.pack('<I',34<<16)
key=ref(read_keys[24]['hash']);assert key=='03271e4aab'
packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
default_keys=meta['76ffc980ed']['values'];default_values=meta['2b9f675449']['values']
default_index=[ref(k['hash']) for k in default_keys].index(key)
value_ref=ref(default_values[default_index]['hash']);vector=ref(meta[value_ref]['values'][0]['hash'])
constant={'register':'cb1[0]','role':'uvScale','inputSlot':24,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters.get(packed,{}).get('nameHash'),
          'defaultIndex':default_index,'defaultVectorBlock':vector,'defaultSourceOffset':index[vector]['offset'],'default':list(struct.unpack('<4f',raw(vector)))}
assert constant['default']==[1,1,0,0]
materials,textures=[],{}
scene=json.loads((ROOT/'web/public/assets/map.scene.json').read_text())
placed=collections.Counter(i['assetId'] for i in scene['instances'])
for mesh in plan['meshes']:
    for material in mesh['materials']:
        if (material.get('shader')or{}).get('name','').lower()!=NAME.lower():continue
        bindings={b['parameterHash']:b for b in material['fallbackTextureBindings']}
        assert set(bindings)==set(b['parameterHash'] for b in mapping)
        source=next(iter(bindings.values()))
        assert all(b['variationHash']==0 and b['sourceEntry']==source['sourceEntry'] and b['sourceSection']==source['sourceSection'] for b in bindings.values())
        section=by_rid[by_rid[source['sourceEntry']]['children'][source['sourceSection']]]
        params=params_under(section['children'][1],set())
        matches=[(b,p) for b,p in params if p['packedFlags']==constant['packedLow48']]
        assert len({p['rawHex'] for _,p in matches})<=1
        if matches:
            b,p=matches[0];value=list(struct.unpack('<4f',bytes.fromhex(p['rawHex'])))
            provenance={'kind':'exact-section-override','sourceBlock':b['source']['rid'],'sourceBlockSha256':b['sha256'],'offset':p['offset'],'rawHex':p['rawHex']}
        else:
            value=constant['default'];provenance={'kind':'rvm-shader-default','sourceBlock':vector,'sourceOffset':index[vector]['offset']}
        row={'assetId':mesh['guid'],'meshName':mesh['name'],'materialId':material['index'],'sourceShader':material['shader'],
             'sourceEntry':source['sourceEntry'],'sourceSection':source['sourceSection'],'variationHash':0,'placementCount':placed[mesh['guid']],
             'bindings':{x['role']:bindings[x['parameterHash']] for x in mapping},'constants':[value],'constantEvidence':[provenance]}
        materials.append(row)
        for binding in bindings.values():textures[binding['texture']['fileGuid']]=binding['texture']
assert len(materials)==30 and len(textures)==4
assert sum(m['placementCount'] for m in materials)==384
shader=(OUT/'2b6d233517.asm').read_text()
output_ops=['mov o0.w, l(0)','mov o2.xyz, l(0,0,0.500000,0)']
assert all(op in shader for op in output_ops)
sh_normal_ops=['dp3 r5.x, r2.xyzx, v2.xyzx','dp3 r5.y, r2.xyzx, v3.xyzx','dp3 r5.z, r2.xyzx, v4.xyzx',
               'dp3 r2.x, r5.xyzx, r5.xyzx','rsq r2.x, r2.x','mul r2.xyz, r2.xxxx, r5.xyzx',
               'mul r13.xy, r2.zyzz, r2.zyzz']
assert all(op in shader for op in sh_normal_ops)
metal=json.loads((ROOT/'exports/materials/metalonly-shader/material-analysis.json').read_text())
model={**metal['nativeMaterialModel'],'producerOperations':output_ops,'metalness':0,'scope':'Catwalk2 emits ordinary materialID0, metalness0 and reflectance0.5; two native gbLayout=0 deferred consumers establish dielectric F0=.04.'}
audit=json.loads((ROOT/'exports/materials/visible-material-audit.json').read_text())
visibility=next(x for x in audit['remainingFamilies'] if x['shader']==NAME)
report={'evidenceId':'LOCAL-CATWALK2-SHADER-001','analysisKind':'Retained original source static decoding; no native execution',
        'shaderName':NAME,'shaderNameHash':h,'shaderGuid':graph['sourceGuid'],'pixelShader':'2b6d233517',
        'pixelShaderSha256':hashlib.sha256((OUT/'2b6d233517.dxbc').read_bytes()).hexdigest(),
        'pairedVertexShader':'ea0522bd70','pairedVertexShaderSha256':hashlib.sha256((OUT/'ea0522bd70.dxbc').read_bytes()).hexdigest(),
        'sourceRvmSha256':hashlib.sha256(data).hexdigest(),'selectionChain':[{'block':k,**index[k]} for k in chain],
        'functionInstance':'5331dc4e1e','function':'ffe276e248','inputKeyTable':'9f5f8da3a0',
        'textureConversionSourceSlots':'1bc318c6c1','textureConversionTargetSlots':'1b99e3538d','applyBlock':'a4b167e3fa','applyTextureSlots':'8acd8b352a',
        'constantWriteOps':'abe2d6ba68','constantTableAssembly':'4aff476110','pixelConstantTableOutputSlot':34,'vertexConstantTableOutputSlot':35,
        'textureMapping':mapping,'constantMapping':[constant],'materials':materials,'sourceTextures':textures,'nativeMaterialModel':model,
        'placedSectionCount':384,'visibleCoverage':{k:v for k,v in visibility.items() if k!='members'},
        'forwardShader':'798255efd6','forwardShaderSha256':hashlib.sha256((OUT/'798255efd6.dxbc').read_bytes()).hexdigest(),
        'nativeLightingInputs':{'shNormal':'normalized-final-world-normal','normalInstructions':sh_normal_ops,
                                'materialId':0,'metalness':0,'reflectance':.5,'ao':1,'emissive':[0,0,0],
                                'deferredConsumerEvidence':'BF2-NATIVE-GBUFFER-001',
                                'diffuse':'Source normalized-normal prelighting * baseColor * native DFG.b; common ordinary-ID0 consumer with metalness0.',
                                'specular':'Common ordinary-ID0 consumer with dielectric F0=.04; native reflection projection and all BRDF operations remain separate.'},
        'limitations':['Default variation0 section bindings only; native runtime permutation selection is unobserved.',
                       'Source normal tangent streams remain undecoded; browser derivative tangent parity is unproven.',
                       'Three BRDF, full source prelighting and reflection selection differ from the native renderer.',
                       'Source DDS format is preserved; resource-view overrides, sampler states and browser-generated lower PNG mips remain limits.']}
(OUT/'material-analysis.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'materials':len(materials),'textures':len(textures),'uvScales':dict(collections.Counter(str(m['constants']) for m in materials)),'mapping':mapping},indent=2))
