"""Source-bound texture-array 2UV material recovery; original native records only."""
import collections,hashlib,json,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/array2uv-shader'
NAME='Shaders/Presets/SS_PropsMetallicPreset_2UV_TextureArray_01'
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
assert h==graph['sourceNameHash']==2612997987
chain=['910d6c3e8a','a37ac89626','f673e060ff','2e3b04517c','957539a103','4f315b6173','09b8103fce','8e08628d06','9b265905d5','f5e607381c','74303d0c84','52d055444c']
for parent,child in zip(chain,chain[1:]):assert any(e['from']==parent and e['to']==child for e in graph['edges'])
assert ref(meta['9b265905d5']['values'][18]['hash'])=='43087780e7'
assert ref(meta['43087780e7']['values'][0]['hash'])=='ac172e99cc'
assert ref(struct.unpack_from('<Q',raw('ac172e99cc'),32)[0])=='91e68dabef'
keys=meta['f2ebc80d50']['values'];default_keys=meta['955acad362']['values'];default_values=meta['9b265905d5']['values']
assert slots('3de31beb53')==[0,19,8] and slots('c7a54171cb')==[40,41,42] and slots('5d97a6d35a')==[41,42,40]
assert raw('fe3e7710f5')[48:56]==bytes.fromhex('0101020003000000')
mapping=[]
for register,role,slot,converted in [(2,'normalArrayMetal',19,41),(3,'detailArray',8,42),(4,'colorSmoothness',0,40)]:
 key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
 mapping.append({'register':f't{register}','role':role,'convertedSlot':converted,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters[packed]['nameHash']})
writes=[(v>>16,off,n)for v,off,n in struct.iter_unpack('<IHH',raw('a587d358b5'))];assert writes==[(25,0,1),(12,0,1),(29,16,1)]
assert slots('41a38bad30')==[38] # Pixel CB1 table, distinct from converted vertex table39.
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
assert len(materials)==14 and len(textures)==23 and sum(m['placementCount']for m in materials)==395
producer=['mov o0.w, l(0)','mov o2.xz, l(0,0,0.500000,0)','mov o2.y, r2.w']
normal_ops=['dp3 r2.x, r5.xyzx, r5.xyzx','rsq r2.x, r2.x','mul r5.xyz, r2.xxxx, r5.xyzx']
shader=(OUT/'52d055444c.asm').read_text();assert all(op in shader for op in producer+normal_ops)
vs=(OUT/'91e68dabef.asm').read_text();uv_ops=['mov o1.w, v5.z','mov o2.w, v5.w','mov o3.w, v5.x','mov o4.w, v5.y'];assert all(op in vs for op in uv_ops)
model=json.loads((ROOT/'exports/materials/metalonly-shader/material-analysis.json').read_text())['nativeMaterialModel'];model={**model,'producerOperations':producer}
audit=json.loads((ROOT/'exports/materials/visible-material-audit.json').read_text());visible=next(x for x in audit['remainingFamilies']if x['shader']==NAME)
report={'evidenceId':'LOCAL-ARRAY2UV-SHADER-001','analysisKind':'Retained-source static decoding; no native execution','shaderName':NAME,'shaderNameHash':h,'shaderGuid':graph['sourceGuid'],'pixelShader':'52d055444c','pixelShaderSha256':hashlib.sha256((OUT/'52d055444c.dxbc').read_bytes()).hexdigest(),'pairedVertexShader':'91e68dabef','pairedVertexShaderSha256':hashlib.sha256((OUT/'91e68dabef.dxbc').read_bytes()).hexdigest(),'sourceRvmSha256':hashlib.sha256(data).hexdigest(),'selectionChain':[{'block':k,**index[k]}for k in chain],'functionInstance':'957539a103','function':'1a2fac3af8','inputKeyTable':'f2ebc80d50','textureConversionSourceSlots':'3de31beb53','textureConversionTargetSlots':'c7a54171cb','applyBlock':'fe3e7710f5','constantWriteOps':'a587d358b5','pixelConstantTableOutputSlot':38,'vertexConstantTableOutputSlot':37,'textureMapping':mapping,'constantMapping':constants,'materials':materials,'sourceTextures':textures,'placedSectionCount':395,'visibleCoverage':{k:v for k,v in visible.items()if k!='members'},'nativeMaterialModel':model,
 'nativeLightingInputs':{'shNormal':'normalized-source-world-normal','normalInstructions':normal_ops,'materialId':0,'reflectance':.5,'metalness':'normalArrayMetal(baseUV).a','ao':1,'emissive':[0,0,0],'deferredConsumerEvidence':'BF2-NATIVE-GBUFFER-001'},
 'uvRouting':{'vertexOperations':uv_ops,'packedVertexRegister':'v5 float4 at converted input offset36','surfaceUv':'v5.zw','normalAndDetailUv':'v5.xy','sourceAttributeAssociation':'UV0 to v5.xy and UV1 to v5.zw is inferred from contiguous native Half2 TexCoord0/1 element order and paired Half4 shader input. Native vertex-buffer-conversion implementation has not been decoded.','browserSurfaceUv':'original UV1','browserNormalAndDetailUv':'original UV0','baseNormalUv':'clamp(UV0,0,1)','detailArrayUv':'UV0 * cb1[0].xy','arrayLayer':'normalArrayMetal(UV1).b * 10; hardware nearest layer with edge clamp'},
 'limitations':['Default variation0 only; native runtime permutation selection is unobserved.','The VS register UV routing is exact; association of converted v5.xy/zw to original UV0/UV1 remains an explicit inference, not native execution evidence.','Packed native tangent parity remains unresolved; browser uses derivative frame of original UV0.','Three/native BRDF, broad specular, reflection projection and sampling details remain separately incomplete.','DDS format transfer functions preserved; native resource-view overrides and regenerated PNG mips remain limits.']}
(OUT/'material-analysis.json').write_text(json.dumps(report,indent=2));print(json.dumps({'materials':len(materials),'textures':len(textures),'constants':[(m['meshName'].split('/')[-1],m['constants'])for m in materials],'mapping':mapping},indent=2))
