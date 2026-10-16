"""Source-bound texture-array 1UV material recovery; original native records only."""
import collections,hashlib,json,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/array1uv-shader'
NAME='Shaders/Presets/SS_PropsMetallicPreset_1UV_TextureArray_01'
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
 seen.add(k);b=by_rid[k];return [(b,p)for p in b.get('parameters',[])]+[p for c in b.get('children',[])for p in params_under(c,seen)]
h=5381
for c in NAME.lower():h=((h*33)^ord(c))&0xffffffff
assert h==graph['sourceNameHash']==666991456
chain=['5990c90cac','8b23e19ee5','a0eeb557a5','43147ba673','2e0b74eb6d','6003900b1f','3ef32d4149','d2cb05384e','d214631de5','b7457b6d8a','44b94cbf44','dfa7a16109']
for parent,child in zip(chain,chain[1:]):assert any(e['from']==parent and e['to']==child for e in graph['edges'])
assert ref(meta['d214631de5']['values'][19]['hash'])=='c3a0c72052'
assert ref(meta['c3a0c72052']['values'][0]['hash'])=='c79eb15579'
assert ref(struct.unpack_from('<Q',raw('c79eb15579'),32)[0])=='58a22ef3c1'
keys=meta['ae021015ca']['values'];default_keys=meta['9c5653cbd3']['values'];default_values=meta['d214631de5']['values']
assert slots('56cb0d2e6c')==[0,20,9] and slots('7a8bf1524f')==[41,42,43] and slots('1531b15d34')==[42,43,41]
assert raw('6ce02f318b')[48:56]==bytes.fromhex('0101020003000000')
mapping=[]
for register,role,slot,converted in [(2,'normalArrayMetal',20,42),(3,'detailArray',9,43),(4,'colorSmoothness',0,41)]:
 key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
 mapping.append({'register':f't{register}','role':role,'convertedSlot':converted,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters[packed]['nameHash']})
writes=[(v>>16,off,n)for v,off,n in struct.iter_unpack('<IHH',raw('d944dd1b73'))];assert writes==[(27,0,1),(13,0,1),(1,16,1)]
assert slots('916e6db529')==[39] # Pixel CB1 table, distinct from converted vertex table39.
constants=[]
for cb,((slot,offset,count),role)in enumerate(zip(writes[1:],['detailUvScale','detailWeight'])):
 key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
 n=[ref(k['hash'])for k in default_keys].index(key);vr=ref(default_values[n]['hash']);vector=ref(meta[vr]['values'][0]['hash'])
 constants.append({'register':f'cb1[{cb}]','role':role,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters.get(packed,{}).get('nameHash'),'defaultIndex':n,'defaultVectorBlock':vector,'defaultSourceOffset':index[vector]['offset'],'default':list(struct.unpack('<4f',raw(vector)))})
array_file=next((ROOT/'exports/materials/array2uv-array-ebx/ebx').glob('*.json'));array=json.loads(array_file.read_text());assert array['asset']['rootInstanceGuid']=='d72f699d-b7ad-f0da-de8e-7f2741b3ef4c'
array_identity={'name':array['entry']['name'],'fileGuid':array['asset']['fileGuid'],'rootInstanceGuid':array['asset']['rootInstanceGuid'],'sha1':array['entry']['sha1'],'identityEvidence':'Exact TextureArrayAsset rootInstanceGuid equals original split parameter GUID; ordinary TextureAsset-only identity inventory omitted this asset class.','sourceEbxPath':array_file.relative_to(ROOT).as_posix(),'sourceEbxSha256':hashlib.sha256(array_file.read_bytes()).hexdigest()}
scene=json.loads((ROOT/'web/public/assets/map.scene.json').read_text());placed=collections.Counter(i['assetId']for i in scene['instances']);materials=[];textures={}
for mesh in plan['meshes']:
 for material in mesh['materials']:
  if(material.get('shader')or{}).get('name')!=NAME:continue
  bindings={b['parameterHash']:dict(b)for b in material['fallbackTextureBindings']};assert set(bindings)==set(b['parameterHash']for b in mapping)
  source=next(iter(bindings.values()));assert all(b['variationHash']==0 and b['sourceEntry']==source['sourceEntry'] and b['sourceSection']==source['sourceSection']for b in bindings.values())
  unresolved=bindings[26739661];p=next(p for p in by_rid[unresolved['sourceBlock']]['parameters']if p['offset']==unresolved['sourceOffset']);assert p['textureGuid']==array_identity['rootInstanceGuid'];unresolved['texture']=array_identity
  section=by_rid[by_rid[source['sourceEntry']]['children'][source['sourceSection']]];params=params_under(section['children'][1],set())
  row={'assetId':mesh['guid'],'meshName':mesh['name'],'materialId':material['index'],'sourceShader':material['shader'],'sourceEntry':source['sourceEntry'],'sourceSection':source['sourceSection'],'variationHash':0,'placementCount':placed[mesh['guid']],'bindings':{x['role']:bindings[x['parameterHash']]for x in mapping},'constants':[],'constantEvidence':[]}
  for c in constants:
   matches=[(b,p)for b,p in params if p['packedFlags']==c['packedLow48']];assert len({p['rawHex']for _,p in matches})<=1
   if matches:
    b,p=matches[0];value=list(struct.unpack('<4f',bytes.fromhex(p['rawHex'])));e={'kind':'exact-section-override','sourceBlock':b['source']['rid'],'sourceBlockSha256':b['sha256'],'offset':p['offset'],'rawHex':p['rawHex']}
   else:value=c['default'];e={'kind':'rvm-shader-default','sourceBlock':c['defaultVectorBlock'],'sourceOffset':c['defaultSourceOffset']}
   row['constants'].append(value);row['constantEvidence'].append(e)
  materials.append(row)
  for b in bindings.values():textures[b['texture']['fileGuid']]=b['texture']
assert len(materials)==13 and len(textures)==27 and sum(m['placementCount']for m in materials)==314
producer=['mov o0.w, l(0)','mov o2.xz, l(0,0,0.500000,0)','mov o2.y, r2.w']
normal_ops=['dp3 r2.x, r5.xyzx, r5.xyzx','rsq r2.x, r2.x','mul r5.xyz, r2.xxxx, r5.xyzx']
shader=(OUT/'dfa7a16109.asm').read_text();assert all(op in shader for op in producer+normal_ops)
vs=(OUT/'58a22ef3c1.asm').read_text();uv_ops=['mov o1.w, v5.x','mov o2.w, v5.y'];assert all(op in vs for op in uv_ops)
model=json.loads((ROOT/'exports/materials/metalonly-shader/material-analysis.json').read_text())['nativeMaterialModel'];model={**model,'producerOperations':producer}
assert slots('f2bb6012ca')==[17,23]
samplers=[]
for register,slot,value,sampler in [(0,17,'d9ca639329','5993a514cd'),(1,23,'3f54e96801','0a829c84fa')]:
 key=ref(keys[slot]['hash']);n=[ref(k['hash'])for k in meta['c8d12545b1']['values']].index(key)
 assert ref(meta['f973b2b732']['values'][n]['hash'])==value and ref(meta[value]['values'][0]['hash'])==sampler
 samplers.append({'register':f's{register}','inputSlot':slot,'key':key,'defaultBlock':'1caa4ec440','valueRef':value,'samplerBlock':sampler,'sourceOffset':index[sampler]['offset'],'rawHex':raw(sampler).hex(),'packedFilterAddressBytes':list(raw(sampler)[16:20]),'descriptorInterpretation':'Packed0x55 corresponds to anisotropic filtering; address1 wrap,3 clamp. Packed-to-D3D conversion implementation remains unobserved.'})
audit=json.loads((ROOT/'exports/materials/visible-material-audit.json').read_text());visible=next(x for x in audit['remainingFamilies']if x['shader']==NAME)
report={'evidenceId':'LOCAL-ARRAY1UV-SHADER-001','analysisKind':'Retained-source static decoding; no native execution','shaderName':NAME,'shaderNameHash':h,'shaderGuid':graph['sourceGuid'],'pixelShader':'dfa7a16109','pixelShaderSha256':hashlib.sha256((OUT/'dfa7a16109.dxbc').read_bytes()).hexdigest(),'pairedVertexShader':'58a22ef3c1','pairedVertexShaderSha256':hashlib.sha256((OUT/'58a22ef3c1.dxbc').read_bytes()).hexdigest(),'sourceRvmSha256':hashlib.sha256(data).hexdigest(),'selectionChain':[{'block':k,**index[k]}for k in chain],'functionInstance':'2e0b74eb6d','function':'421da1918a','inputKeyTable':'ae021015ca','textureConversionSourceSlots':'56cb0d2e6c','textureConversionTargetSlots':'7a8bf1524f','applyBlock':'6ce02f318b','constantWriteOps':'d944dd1b73','pixelConstantTableOutputSlot':39,'vertexConstantTableOutputSlot':38,'textureMapping':mapping,'constantMapping':constants,'materials':materials,'sourceTextures':textures,'placedSectionCount':314,'visibleCoverage':{k:v for k,v in visible.items()if k!='members'},'nativeMaterialModel':model,
 'nativeLightingInputs':{'shNormal':'normalized-source-world-normal','normalInstructions':normal_ops,'materialId':0,'reflectance':.5,'metalness':'normalArrayMetal(UV0).a','ao':1,'emissive':[0,0,0],'deferredConsumerEvidence':'BF2-NATIVE-GBUFFER-001'},
 'samplerMapping':samplers,'uvRouting':{'vertexOperations':uv_ops,'surfaceUv':'v5.xy, one source UV pair for every texture','browserSurfaceUv':'original UV0'},
 'limitations':['Default variation0 only; native runtime permutation selection is unobserved.','Original UV0 retained; native packed tangent parity remains unresolved.','Native packed sampler bytes match D3D descriptor enums; packed-to-native descriptor conversion remains unobserved.','Three/native BRDF, broad specular, reflection projection and sampling details remain separately incomplete.','DDS format transfer functions preserved; native resource-view overrides and regenerated PNG mips remain limits.']}
(OUT/'material-analysis.json').write_text(json.dumps(report,indent=2));print(json.dumps({'materials':len(materials),'textures':len(textures),'constants':[(m['meshName'].split('/')[-1],m['constants'])for m in materials],'mapping':mapping},indent=2))
