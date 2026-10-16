"""Recover source Corvette damage shader, original array and per-vertex inputs."""
import collections,hashlib,json,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/corvette-damage-shader';NAME='Objects/Architecture/CorvetteCR90_Interior_01/SS_CovetteCR90_Interior_01_Damage_01'
data=(ROOT/'exports/materials/rvm/0.res').read_bytes();index=json.loads((ROOT/'exports/materials/rvm/block-index.json').read_text())['blocks'];meta=json.loads((ROOT/'exports/materials/rvm/material-blocks.json').read_text());graph=json.loads((OUT/'graph.json').read_text());split=json.loads((ROOT/'exports/materials/final-map-blocks.json').read_text())['blocks'];by_rid={b['source']['rid']:b for b in split};parameters={p['packedFlags']:p for b in split for p in b.get('parameters',[])};plan=json.loads((ROOT/'exports/materials/final-map-material-plan.json').read_text())
def raw(k):
 b=index[k];return data[b['offset']:b['offset']+b['size']]
def ref(v):return f'{int(v)&0xffffffffff:010x}'
def slots(k):return [v[0]>>16 for v in struct.iter_unpack('<I',raw(k))]
def params_under(k,seen):
 if k in seen:return []
 seen.add(k);b=by_rid[k];return [(b,p)for p in b.get('parameters',[])]+[p for c in b.get('children',[])for p in params_under(c,seen)]
h=5381
for c in NAME.lower():h=((h*33)^ord(c))&0xffffffff
assert h==graph['sourceNameHash']==2730669534
chain=['edf2c9fdc0','a085dcf901','d373fc7d51','dddee97aab','0c37b7f6e0','d297d16807','3a4409bd6d','c04e500fb0','94aa92c470','0ffddfcdc9','46271e69ce','d92fda6613']
for a,b in zip(chain,chain[1:]):assert any(e['from']==a and e['to']==b for e in graph['edges'])
assert ref(meta['94aa92c470']['values'][19]['hash'])=='d667c3ebe9'and ref(meta['d667c3ebe9']['values'][0]['hash'])=='9a3f90b095'and ref(struct.unpack_from('<Q',raw('9a3f90b095'),32)[0])=='246f1ef674'
# Read-view order is the executable input slot order. The function hash/filter
# table6832e4f272 is a different ordering and must not substitute for this table.
keys=meta['15a2163e05']['values'];default_keys=meta['4fb81794d1']['values'];default_values=meta['94aa92c470']['values']
assert slots('489da080df')==[10,27,34,31,6]and slots('04ec24c792')==[38,39,40,41,42]and slots('8504076e89')==[40,41,38,39,42]
assert raw('e316fe00af')[48:56]==bytes.fromhex('0101020005000000')
conversion=dict(zip(slots('04ec24c792'),slots('489da080df')));mapping=[]
for register,(role,converted)in enumerate(zip(['dirt','normalMetal','color','detailArray','wreck'],slots('8504076e89')),2):
 slot=conversion[converted];key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff);mapping.append({'register':f't{register}','role':role,'convertedSlot':converted,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters[packed]['nameHash']})
writes=[(v>>16,offset,count)for v,offset,count in struct.iter_unpack('<IHH',raw('451360c675'))];assert writes==[(25,0,1),(9,0,8)]and slots('ecb5923ee5')==[43]and slots('62559384f3')==[44]
key=ref(keys[9]['hash']);assert key=='07da08ada9';packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff);n=[ref(k['hash'])for k in default_keys].index(key);vr=ref(default_values[n]['hash']);vector=ref(meta[vr]['values'][0]['hash']);assert vector=='a9d75501f0'
constants=[list(v)for v in struct.iter_unpack('<4f',raw(vector))];assert len(constants)==8 and all(v[:3]==[0,0,0]for v in constants)
constant_mapping={'register':'cb1[0..7]','role':'subMaterialArrayLayer','inputSlot':9,'parameterKeyBlock':key,'packedLow48':packed,'defaultIndex':n,'defaultVectorBlock':vector,'defaultSourceOffset':index[vector]['offset'],'rawHex':raw(vector).hex(),'default':constants,'note':'Only x read by PS; preserved raw Vec payload includes nonsemantic stored w metadata.'}
array_file=next((ROOT/'exports/materials/corvette-damage-array-ebx/ebx').glob('*.json'));array=json.loads(array_file.read_text());assert array['asset']['rootInstanceGuid']=='b9948b43-0b9b-4f16-9f63-77c67ca4b164'
array_identity={'name':array['entry']['name'],'fileGuid':array['asset']['fileGuid'],'rootInstanceGuid':array['asset']['rootInstanceGuid'],'sha1':array['entry']['sha1'],'identityEvidence':'Exact TextureArrayAsset rootInstanceGuid matches original split parameter GUID.','sourceEbxPath':array_file.relative_to(ROOT).as_posix(),'sourceEbxSha256':hashlib.sha256(array_file.read_bytes()).hexdigest()}
scene=json.loads((ROOT/'web/public/assets/map.scene.json').read_text());placed=collections.Counter(i['assetId']for i in scene['instances']);materials=[];textures={}
for mesh in plan['meshes']:
 for material in mesh['materials']:
  if(material.get('shader')or{}).get('name')!=NAME:continue
  bindings={b['parameterHash']:dict(b)for b in material['fallbackTextureBindings']};assert set(bindings)==set(b['parameterHash']for b in mapping)
  source=next(iter(bindings.values()));assert all(b['variationHash']==0 and b['sourceEntry']==source['sourceEntry']and b['sourceSection']==source['sourceSection']for b in bindings.values())
  unresolved=bindings[3914995556];p=next(p for p in by_rid[unresolved['sourceBlock']]['parameters']if p['offset']==unresolved['sourceOffset']);assert p['textureGuid']==array_identity['rootInstanceGuid'];unresolved['texture']=array_identity
  section=by_rid[by_rid[source['sourceEntry']]['children'][source['sourceSection']]];params=params_under(section['children'][1],set());assert not any(p['packedFlags']==packed for _,p in params)
  files=list((ROOT/'exports/map-initial').glob('*/ebx/*__'+mesh['guid']+'.json'));assert files;doc=json.loads(files[0].read_text());material_object=next(o for o in doc['asset']['objects']if o['$id']==material['classGuid']);assert material_object['Shader']['ConditionalParameters']==[]and material_object['Shader']['VectorArrayParameters']==[]
  materials.append({'assetId':mesh['guid'],'meshName':mesh['name'],'materialId':material['index'],'materialClassGuid':material['classGuid'],'sourceShader':material['shader'],'sourceEntry':source['sourceEntry'],'sourceSection':source['sourceSection'],'variationHash':0,'placementCount':placed[mesh['guid']],'bindings':{x['role']:bindings[x['parameterHash']]for x in mapping},'constants':constants,'constantEvidence':{'kind':'rvm-shader-default','sourceBlock':vector,'sourceOffset':index[vector]['offset'],'rawHex':raw(vector).hex(),'sectionOverrideAbsent':True},'sourceMaterialEbx':files[0].relative_to(ROOT).as_posix(),'conditionalParameters':[]})
  for b in bindings.values():textures[b['texture']['fileGuid']]=b['texture']
assert len(materials)==6 and sum(m['placementCount']for m in materials)==49
producer=['mov o0.w, l(0)','mov o2.xz, l(0,0,0.500000,0)','mov o2.y, r5.z'];normal_ops=['dp3 r3.x, r4.xyzx, r4.xyzx','rsq r3.x, r3.x','mul r4.xyz, r3.xxxx, r4.xyzx'];shader=(OUT/'d92fda6613.asm').read_text();assert all(op in shader for op in producer+normal_ops)
vs=(OUT/'246f1ef674.asm').read_text();vertex_ops=['mov o1.xyzw, v2.xyzw','mov o2.w, v5.z','mov o3.w, v5.w','mov o4.w, v5.x','mov o5.w, v5.y','mov o6.xyzw, v6.xyzw'];assert all(op in vs for op in vertex_ops)
model=json.loads((ROOT/'exports/materials/metalonly-shader/material-analysis.json').read_text())['nativeMaterialModel'];model={**model,'producerOperations':producer}
visible=next(r for r in json.loads((ROOT/'exports/materials/visible-material-audit.json').read_text())['remainingFamilies']if r['shader']==NAME)
dxbc=(OUT/'d92fda6613.dxbc').read_bytes();literals=[]
for value in [.529,.527,.767,.573]:
 f=struct.unpack('<f',struct.pack('<f',value))[0];offsets=[at for at in range(0,len(dxbc)-3,4)if struct.unpack_from('<f',dxbc,at)[0]==f];assert offsets;literals.append({'float32':f,'dxbcOffsets':offsets})
report={'evidenceId':'LOCAL-CORVETTE-DAMAGE-SHADER-001','shaderName':NAME,'shaderNameHash':h,'shaderGuid':graph['sourceGuid'],'pixelShader':'d92fda6613','pixelShaderSha256':hashlib.sha256(dxbc).hexdigest(),'pairedVertexShader':'246f1ef674','pairedVertexShaderSha256':hashlib.sha256((OUT/'246f1ef674.dxbc').read_bytes()).hexdigest(),'sourceRvmSha256':hashlib.sha256(data).hexdigest(),'selectionChain':[{'block':k,**index[k]}for k in chain],'functionInstance':'0c37b7f6e0','function':'955ed48988','inputKeyTable':'15a2163e05','textureConversionSourceSlots':'489da080df','textureConversionTargetSlots':'04ec24c792','applyBlock':'e316fe00af','constantWriteOps':'451360c675','pixelConstantTableOutputSlot':44,'vertexConstantTableOutputSlot':43,'textureMapping':mapping,'constantMapping':constant_mapping,'sourceLiterals':literals,'materials':materials,'sourceTextures':textures,'placedSectionCount':49,'visibleCoverage':{k:v for k,v in visible.items()if k!='members'},'nativeMaterialModel':model,'nativeLightingInputs':{'shNormal':'normalized-source-world-normal','normalInstructions':normal_ops,'materialId':0,'reflectance':.5,'ao':1,'emissive':[0,0,0],'deferredConsumerEvidence':'BF2-NATIVE-GBUFFER-001'},'uvRouting':{'vertexOperations':vertex_ops,'baseUv':'converted v5.xy','tiledUv':'converted v5.zw','damage':'v2.r to interpolated PS v1.x','arrayIndex':'v6.x to flat PS v6.x; then cb1[index].x','browserAssociation':'Source UV0/UV1 to converted v5.xy/zw and Color0/SubMaterialIndex to v2/v6 inferred from matching element formats/order, original declarations and paired VS. Native vertex converter implementation remains undecoded.'},'limitations':['Default variation0 selected; native runtime pass selection remains unobserved.','Original source attributes are preserved; converted attribute association remains explicit inference.','No mesh layer-table overrides exist in retained section parameter roots or MeshMaterial declarations; native runtime-generated overrides remain unobserved.','Native damage blend weight is unsaturated and may exceed1; do not clamp it.','Derivative tangent parity and native texture filtering/resource-view overrides remain unresolved.','Original DDS format/native mip bytes preserved; lower browser PNG mips regenerate.']}
assert ref(meta['e039d512ff']['values'][1]['hash'])=='d9ca639329'and ref(meta['d9ca639329']['values'][0]['hash'])=='5993a514cd'
assert raw('5993a514cd')[16:20]==bytes([85,1,1,1])
report['samplerMapping']={'register':'s0','inputSlot':17,'parameterKeyBlock':'485d5c4968','defaultParameterBlock':'13dcf28caf','defaultValues':'e039d512ff','defaultIndex':1,'valueRef':'d9ca639329','samplerBlock':'5993a514cd','sourceOffset':index['5993a514cd']['offset'],'rawHex':raw('5993a514cd').hex(),'packedFilterAddressBytes':[85,1,1,1],'browserAddressing':'repeat U/V/W','limitation':'Native packed filter0x55 matches D3D anisotropic; browser uses shared linear mip filtering, native filter conversion and anisotropy level remain unobserved.'}
(OUT/'material-analysis.json').write_text(json.dumps(report,indent=2));print(json.dumps({'sections':len(materials),'textures':len(textures),'placements':49,'mapping':mapping,'literals':literals}))
