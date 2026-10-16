"""Recover the original emissive Master1UV material; no source-runtime changes."""
import collections,hashlib,json,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/master1uv-emissive-shader';NAME='Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_1UV_Emissive'
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
assert h==graph['sourceNameHash']==292172631
chain=['cea9720ace','28eff7c22b','328b40f416','27351a27e1','80340d58d7','9ae272b31c','eeaedaa1de','e331499a2d','3bbeeae035','f37f6a71e0','3a155ff0f2','5ffbbd02c2']
for a,b in zip(chain,chain[1:]):assert any(e['from']==a and e['to']==b for e in graph['edges'])
assert ref(meta['3bbeeae035']['values'][28]['hash'])=='ec22b366f4'and ref(meta['ec22b366f4']['values'][0]['hash'])=='fb0aa25ab6'and ref(struct.unpack_from('<Q',raw('fb0aa25ab6'),32)[0])=='282854795b'
keys=meta['7c7b5855fd']['values'];default_keys=meta['7a37b05895']['values'];default_values=meta['3bbeeae035']['values']
assert slots('c9dd95f328')==[1,13,39,14,45,17,5,38,2,40]and slots('bf79016d15')==list(range(52,62))and slots('b9cf6a8df2')==[60,59,57,61,55,54,58,56,52,53]
assert raw('61f46a670c')[32:40]==bytes.fromhex('010102000a000000')
conversion=dict(zip(slots('bf79016d15'),slots('c9dd95f328')));mapping=[]
for register,(role,converted)in enumerate(zip(['globalWear','wear','id','normalEmission','grunge','anodized','rubber','metalCS','metalNormal','aluminium'],slots('b9cf6a8df2')),2):
 slot=conversion[converted];key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff);mapping.append({'register':f't{register}','role':role,'convertedSlot':converted,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters[packed]['nameHash']})
writes=[(v>>16,offset,count)for v,offset,count in struct.iter_unpack('<IHH',raw('0f3e70acc8'))];assert writes==[(22,0,1),(7,16,1),(16,32,1),(24,48,1),(29,64,1),(15,80,1),(51,96,1),(27,112,1),(43,128,1),(48,144,1),(0,160,1),(34,176,1),(36,0,1)];assert slots('fc90c146e3')==[62]and slots('e8eb8cf78d')==[63]
roles=['emissiveIntensity','emissiveColor','emissiveBaseColor','depositedColor','uvScale','restoreDivisor','scratchColor','anodizedColor','anodizedSmoothnessScale','rubberColor','rubberSmoothnessScale','metalColor'];constants=[]
for cb,((slot,offset,count),role)in enumerate(zip(writes[:12],roles)):
 key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff);n=[ref(k['hash'])for k in default_keys].index(key);vr=ref(default_values[n]['hash']);vector=ref(meta[vr]['values'][0]['hash']);constants.append({'register':f'cb1[{cb}]','role':role,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters.get(packed,{}).get('nameHash'),'defaultIndex':n,'defaultVectorBlock':vector,'defaultSourceOffset':index[vector]['offset'],'default':list(struct.unpack('<4f',raw(vector)))})
scene=json.loads((ROOT/'web/public/assets/map.scene.json').read_text());placed=collections.Counter(i['assetId']for i in scene['instances']);materials=[];textures={}
for mesh in plan['meshes']:
 for material in mesh['materials']:
  if(material.get('shader')or{}).get('name')!=NAME:continue
  bindings={b['parameterHash']:b for b in material['fallbackTextureBindings']};assert set(bindings)==set(b['parameterHash']for b in mapping)
  source=next(iter(bindings.values()));assert all(b['variationHash']==0 and b['sourceEntry']==source['sourceEntry']and b['sourceSection']==source['sourceSection']for b in bindings.values())
  section=by_rid[by_rid[source['sourceEntry']]['children'][source['sourceSection']]];params=params_under(section['children'][1],set())
  files=list((ROOT/'exports/map-initial').glob('*/ebx/*__'+mesh['guid']+'.json'));assert files;doc=json.loads(files[0].read_text());material_object=next(o for o in doc['asset']['objects']if o['$id']==material['classGuid']);assert material_object['Shader']['ConditionalParameters']==[]
  row={'assetId':mesh['guid'],'meshName':mesh['name'],'materialId':material['index'],'materialClassGuid':material['classGuid'],'sourceShader':material['shader'],'sourceEntry':source['sourceEntry'],'sourceSection':source['sourceSection'],'variationHash':0,'placementCount':placed[mesh['guid']],'bindings':{x['role']:bindings[x['parameterHash']]for x in mapping},'constants':[],'constantEvidence':[],'sourceMaterialEbx':files[0].relative_to(ROOT).as_posix(),'conditionalParameters':[]}
  for c in constants:
   matches=[(b,p)for b,p in params if p['packedFlags']==c['packedLow48']];assert len({p['rawHex']for _,p in matches})<=1
   if matches:
    b,p=matches[0];value=list(struct.unpack('<4f',bytes.fromhex(p['rawHex'])));e={'kind':'exact-section-override','sourceBlock':b['source']['rid'],'sourceBlockSha256':b['sha256'],'offset':p['offset'],'rawHex':p['rawHex']}
   else:value=c['default'];e={'kind':'rvm-shader-default','sourceBlock':c['defaultVectorBlock'],'sourceOffset':c['defaultSourceOffset']}
   row['constants'].append(value);row['constantEvidence'].append(e)
  materials.append(row)
  for b in bindings.values():textures[b['texture']['fileGuid']]=b['texture']
assert len(materials)==15 and sum(m['placementCount']for m in materials)==126
producer=['mov o0.w, l(0)','mov o2.xz, l(0,0,0.500000,0)'];normal_ops=['dp3 r2.w, r2.xyzx, r2.xyzx','rsq r2.w, r2.w','mul r2.xyz, r2.wwww, r2.xyzx']
shader=(OUT/'5ffbbd02c2.asm').read_text();assert all(op in shader for op in producer+normal_ops)
emission_ops=['mad_sat r0.w, r5.w, l(1.111111), l(-0.111111)','mul r1.xyz, r0.wwww, cb1[1].xyzx','mad r0.xyz, r1.xyzx, cb1[0].xxxx, r0.xyzx','mul o3.xyz, r0.xyzx, cb2[40].xxxx'];assert all(op in shader for op in emission_ops)
model=json.loads((ROOT/'exports/materials/metalonly-shader/material-analysis.json').read_text())['nativeMaterialModel'];model={**model,'producerOperations':producer}
visible=next(r for r in json.loads((ROOT/'exports/materials/visible-material-audit.json').read_text())['remainingFamilies']if r['shader']==NAME)
report={'evidenceId':'LOCAL-MASTER1UV-EMISSIVE-SHADER-001','shaderName':NAME,'shaderNameHash':h,'shaderGuid':graph['sourceGuid'],'pixelShader':'5ffbbd02c2','pixelShaderSha256':hashlib.sha256((OUT/'5ffbbd02c2.dxbc').read_bytes()).hexdigest(),'pairedVertexShader':'282854795b','pairedVertexShaderSha256':hashlib.sha256((OUT/'282854795b.dxbc').read_bytes()).hexdigest(),'sourceRvmSha256':hashlib.sha256(data).hexdigest(),'selectionChain':[{'block':k,**index[k]}for k in chain],'functionInstance':'80340d58d7','function':'e1747c38fc','inputKeyTable':'7c7b5855fd','textureConversionSourceSlots':'c9dd95f328','textureConversionTargetSlots':'bf79016d15','applyBlock':'61f46a670c','constantWriteOps':'0f3e70acc8','pixelConstantTableOutputSlot':62,'vertexConstantTableOutputSlot':63,'textureMapping':mapping,'constantMapping':constants,'materials':materials,'sourceTextures':textures,'placedSectionCount':126,'visibleCoverage':{k:v for k,v in visible.items()if k!='members'},'nativeMaterialModel':model,'nativeLightingInputs':{'shNormal':'normalized-source-world-normal','normalInstructions':normal_ops,'materialId':0,'reflectance':.5,'ao':1,'emissive':'clamp(normalEmission.b*1.1111111640930176-.111111119389534,0,1)*cb1[1].rgb*cb1[0].x','emissionInstructions':emission_ops,'deferredConsumerEvidence':'BF2-NATIVE-GBUFFER-001'},'limitations':['All15 source material ConditionalParameters arrays empty; default variation0 selected. Native runtime pass selection remains unobserved.','Native derivative/packed tangent parity remains unresolved.','Original linear emissive arithmetic is preserved with no arbitrary normalization; complete native radiometric/presentation conventions remain separate.','No AO factor occurs in selected emissive producer; do not inherit nonemissive Master alpha AO.','DDS format transfer functions preserved; resource-view overrides, browser-generated lower mips and remaining native rendering equations stay incomplete.']}
dxbc=(OUT/'5ffbbd02c2.dxbc').read_bytes();report['sourceEmissionLiterals']=[]
for value in [1.1111111640930176,-.111111119389534]:
 offsets=[at for at in range(0,len(dxbc)-3,4)if struct.unpack_from('<f',dxbc,at)[0]==value];assert offsets
 report['sourceEmissionLiterals'].append({'float32':value,'dxbcOffsets':offsets,'rawHex':struct.pack('<f',value).hex()})
(OUT/'material-analysis.json').write_text(json.dumps(report,indent=2));print(json.dumps({'materials':len(materials),'textures':len(textures),'emission':[(m['meshName'].split('/')[-1],m['constants'][:3])for m in materials]}))
