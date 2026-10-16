"""Recover the selected nonmetal emissive wall from its original RVM graph."""
import collections, hashlib, json, pathlib, struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/materials/master1uv-emissive-nonmetal-shader'
NAME = 'Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_1UV_Emissive_NonMetal_01'
data = (ROOT/'exports/materials/rvm/0.res').read_bytes()
index = json.loads((ROOT/'exports/materials/rvm/block-index.json').read_text())['blocks']
meta = json.loads((ROOT/'exports/materials/rvm/material-blocks.json').read_text())
graph = json.loads((OUT/'graph.json').read_text())
split = json.loads((ROOT/'exports/materials/final-map-blocks.json').read_text())['blocks']
by_rid = {b['source']['rid']: b for b in split}
parameters = {p['packedFlags']: p for b in split for p in b.get('parameters', [])}
plan = json.loads((ROOT/'exports/materials/final-map-material-plan.json').read_text())

def raw(k):
    b = index[k]
    return data[b['offset']:b['offset']+b['size']]

def ref(v): return f'{int(v)&0xffffffffff:010x}'
def slots(k): return [v[0]>>16 for v in struct.iter_unpack('<I', raw(k))]

def params_under(k, seen):
    if k in seen: return []
    seen.add(k)
    b = by_rid[k]
    return [(b,p) for p in b.get('parameters', [])] + [p for c in b.get('children', []) for p in params_under(c,seen)]

h = 5381
for c in NAME.lower(): h = ((h*33)^ord(c))&0xffffffff
assert h == graph['sourceNameHash'] == 2996852712
chain = ['3c5e1c26c0','7d5d32c7f5','832cb27b20','913dc0069d','2f21363058','365cf0c0e6','10b1feb483','f6c12bee36','9b939c5c7d','88da4ed11e','2bb21151b7','17069bc692']
for a,b in zip(chain,chain[1:]): assert any(e['from']==a and e['to']==b for e in graph['edges'])
input_chain=['2f21363058','1f3622d1a3','b6394c3cdf','5d569b112e','0a6b4ec7d4','ba848c69d8','5a1c079e63']
for a,b in zip(input_chain,input_chain[1:]): assert any(e['from']==a and e['to']==b for e in graph['edges'])
assert ref(meta['9b939c5c7d']['values'][29]['hash']) == 'ec22b366f4'
assert ref(meta['ec22b366f4']['values'][0]['hash']) == 'fb0aa25ab6'
assert ref(struct.unpack_from('<Q',raw('fb0aa25ab6'),32)[0]) == '282854795b'
keys = meta['5a1c079e63']['values']
default_keys = meta['562eb86d26']['values']
default_values = meta['9b939c5c7d']['values']
assert slots('159ea631e6') == [1,13,40,14,46,17,5,39,2,41]
assert slots('80d3c8d7c0') == list(range(53,63))
assert slots('6a6803992a') == [61,60,58,62,56,55,59,57,53,54]
assert raw('fdacbc63f2')[32:40] == bytes.fromhex('010102000a000000')
conversion = dict(zip(slots('80d3c8d7c0'),slots('159ea631e6')))
roles = ['globalWear','wear','id','normalEmission','grunge','anodized','rubber','metalCS','metalNormal','aluminium']
mapping = []
for register,(role,converted) in enumerate(zip(roles,slots('6a6803992a')),2):
    slot = conversion[converted]
    key = ref(keys[slot]['hash'])
    packed = str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
    mapping.append({'register':f't{register}','role':role,'convertedSlot':converted,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters[packed]['nameHash']})
writes = [(v>>16,offset,count) for v,offset,count in struct.iter_unpack('<IHH',raw('cfe99acaa3'))]
assert writes == [(37,0,1),(23,0,1),(7,16,1),(16,32,1),(21,48,1),(25,64,1),(30,80,1),(15,96,1),(52,112,1),(28,128,1),(44,144,1),(49,160,1),(0,176,1),(35,192,1)]
assert slots('e8eb8cf78d') == [63] and slots('21daf05442') == [64]
assert ref(keys[26]['hash'])=='485d5c4968'
assert ref(meta['d954cf7fb6']['values'][1]['hash'])=='d9ca639329'
assert ref(meta['d9ca639329']['values'][0]['hash'])=='5993a514cd'
assert raw('5993a514cd')[16:20]==bytes([85,1,1,1])
roles = ['emissiveIntensity','emissiveColor','emissiveBaseColor','emissiveMultiplier','depositedColor','uvScale','restoreDivisor','scratchColor','anodizedColor','anodizedSmoothnessScale','rubberColor','rubberSmoothnessScale','metalColor']
constants = []
for cb,((slot,offset,count),role) in enumerate(zip(writes[1:],roles)):
    key = ref(keys[slot]['hash'])
    packed = str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
    n = [ref(k['hash']) for k in default_keys].index(key)
    vr = ref(default_values[n]['hash'])
    vector = ref(meta[vr]['values'][0]['hash'])
    constants.append({'register':f'cb1[{cb}]','role':role,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters.get(packed,{}).get('nameHash'),'defaultIndex':n,'defaultVectorBlock':vector,'defaultSourceOffset':index[vector]['offset'],'default':list(struct.unpack('<4f',raw(vector)))})
scene = json.loads((ROOT/'web/public/assets/map.scene.json').read_text())
placed = collections.Counter(i['assetId'] for i in scene['instances'])
materials, textures = [], {}
for mesh in plan['meshes']:
    for material in mesh['materials']:
        if (material.get('shader')or{}).get('name') != NAME: continue
        bindings = {b['parameterHash']: b for b in material['fallbackTextureBindings']}
        assert set(bindings) == set(b['parameterHash'] for b in mapping)
        source = next(iter(bindings.values()))
        assert all(b['variationHash']==0 and b['sourceEntry']==source['sourceEntry'] and b['sourceSection']==source['sourceSection'] for b in bindings.values())
        section = by_rid[by_rid[source['sourceEntry']]['children'][source['sourceSection']]]
        params = params_under(section['children'][1],set())
        files = list((ROOT/'exports/map-initial').glob('*/ebx/*__'+mesh['guid']+'.json'))
        assert files
        doc = json.loads(files[0].read_text())
        material_object = next(o for o in doc['asset']['objects'] if o['$id']==material['classGuid'])
        assert material_object['Shader']['ConditionalParameters'] == []
        row = {'assetId':mesh['guid'],'meshName':mesh['name'],'materialId':material['index'],'materialClassGuid':material['classGuid'],'sourceShader':material['shader'],'sourceEntry':source['sourceEntry'],'sourceSection':source['sourceSection'],'variationHash':0,'placementCount':placed[mesh['guid']],'bindings':{x['role']:bindings[x['parameterHash']] for x in mapping},'constants':[],'constantEvidence':[],'sourceMaterialEbx':files[0].relative_to(ROOT).as_posix(),'conditionalParameters':[]}
        for c in constants:
            matches = [(b,p) for b,p in params if p['packedFlags']==c['packedLow48']]
            assert len({p['rawHex'] for _,p in matches}) <= 1
            if matches:
                b,p = matches[0]
                value = list(struct.unpack('<4f',bytes.fromhex(p['rawHex'])))
                e = {'kind':'exact-section-override','sourceBlock':b['source']['rid'],'sourceBlockSha256':b['sha256'],'offset':p['offset'],'rawHex':p['rawHex']}
            else:
                value = c['default']
                e = {'kind':'rvm-shader-default','sourceBlock':c['defaultVectorBlock'],'sourceOffset':c['defaultSourceOffset']}
            row['constants'].append(value)
            row['constantEvidence'].append(e)
        materials.append(row)
        for b in bindings.values(): textures[b['texture']['fileGuid']] = b['texture']
assert len(materials)==1 and sum(m['placementCount'] for m in materials)==202
assert materials[0]['sourceShader']['$external']=='9bb448ea-10e9-4c76-bed2-df6e56179fc9'
shader = (OUT/'17069bc692.asm').read_text()
producer = ['mov o0.w, l(0)','mov o2.xyz, l(0,0,0.500000,0)']
normal_ops = ['dp3 r2.w, r2.xyzx, r2.xyzx','rsq r2.w, r2.w','mul r2.xyz, r2.wwww, r2.xyzx']
emission_ops = ['mul r0.w, cb1[0].x, cb1[3].x','mad_sat r1.x, r8.z, l(1.111111), l(-0.111111)','mul r3.xyz, r1.xxxx, cb1[1].xyzx','mad r0.xyz, r3.xyzx, r0.wwww, r0.xyzx','mul o3.xyz, r0.xyzx, cb2[40].xxxx']
assert all(op in shader for op in producer+normal_ops+emission_ops)
model = json.loads((ROOT/'exports/materials/metalonly-shader/material-analysis.json').read_text())['nativeMaterialModel']
model = {**model,'producerOperations':producer}
visible = next(r for r in json.loads((ROOT/'exports/materials/visible-material-audit-current.json').read_text())['remainingFamilies'] if r['shader']==NAME)
report = {'evidenceId':'LOCAL-MASTER1UV-EMISSIVE-NONMETAL-SHADER-001','shaderName':NAME,'shaderNameHash':h,'shaderGuid':materials[0]['sourceShader']['$external'],'rvmSurfaceGuid':graph['sourceGuid'],'pixelShader':'17069bc692','pixelShaderSha256':hashlib.sha256((OUT/'17069bc692.dxbc').read_bytes()).hexdigest(),'pairedVertexShader':'282854795b','pairedVertexShaderSha256':hashlib.sha256((OUT/'282854795b.dxbc').read_bytes()).hexdigest(),'sourceRvmSha256':hashlib.sha256(data).hexdigest(),'selectionChain':[{'block':k,**index[k]} for k in chain],'functionInstance':'2f21363058','function':'1f3622d1a3','inputKeyTable':'5a1c079e63','textureConversionSourceSlots':'159ea631e6','textureConversionTargetSlots':'80d3c8d7c0','applyBlock':'fdacbc63f2','constantWriteOps':'cfe99acaa3','pixelConstantTableOutputSlot':64,'vertexConstantTableOutputSlot':63,'textureMapping':mapping,'constantMapping':constants,'materials':materials,'sourceTextures':textures,'placedSectionCount':202,'visibleCoverage':{k:v for k,v in visible.items() if k!='members'},'nativeMaterialModel':model,'nativeLightingInputs':{'shNormal':'normalized-source-world-normal','normalInstructions':normal_ops,'materialId':0,'metalness':0,'reflectance':.5,'ao':1,'emissive':'clamp(normalEmission.b*1.1111111640930176-.111111119389534,0,1)*cb1[1].rgb*cb1[0].x*cb1[3].x','emissionInstructions':emission_ops,'deferredConsumerEvidence':'BF2-NATIVE-GBUFFER-001'},'limitations':['The exact material has no conditional parameters and uses source variation0. Native runtime pass selection is unobserved.','Native packed tangent parity remains unresolved; browser reconstructs a UV derivative frame.','Original linear emission and source multiplier are preserved; full native prelighting/radiometric composition remains separate.','Selected producer has zero metalness and no AO multiplication; normalEmission alpha is unused.','DDS transfer functions are preserved; resource-view overrides and browser lower-mip generation remain separate.']}
dxbc = (OUT/'17069bc692.dxbc').read_bytes()
report['directInputChain']=input_chain
report['samplerEvidence']={'register':'s0','inputSlot':26,'key':'485d5c4968','valueTable':'d954cf7fb6','valueIndex':1,'valueRef':'d9ca639329','samplerBlock':'5993a514cd','rawHex':raw('5993a514cd').hex(),'sourceAddressing':'repeat'}
report['sourceEmissionLiterals'] = []
for value in [1.1111111640930176,-.111111119389534]:
    offsets = [at for at in range(0,len(dxbc)-3,4) if struct.unpack_from('<f',dxbc,at)[0]==value]
    assert offsets
    report['sourceEmissionLiterals'].append({'float32':value,'dxbcOffsets':offsets,'rawHex':struct.pack('<f',value).hex()})
(OUT/'material-analysis.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'materials':len(materials),'textures':len(textures),'placements':202,'constants':materials[0]['constants']}))
