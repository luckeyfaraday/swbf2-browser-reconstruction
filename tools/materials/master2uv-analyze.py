"""Recover the selected Master2UV RVM recipe without reusing a guessed1UV binding."""
import collections,hashlib,json,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/materials/master2uv-shader'
NAME='Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_2UV'
data=(ROOT/'exports/materials/rvm/0.res').read_bytes();index=json.loads((ROOT/'exports/materials/rvm/block-index.json').read_text())['blocks'];meta=json.loads((ROOT/'exports/materials/rvm/material-blocks.json').read_text());graph=json.loads((OUT/'graph.json').read_text())
split=json.loads((ROOT/'exports/materials/final-map-blocks.json').read_text())['blocks'];by_rid={b['source']['rid']:b for b in split};parameters={p['packedFlags']:p for b in split for p in b.get('parameters',[])};plan=json.loads((ROOT/'exports/materials/final-map-material-plan.json').read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
def raw(k):
 b=index[k];return data[b['offset']:b['offset']+b['size']]
def ref(v):return f'{int(v)&0xffffffffff:010x}'
def slots(k):return [v[0]>>16 for v in struct.iter_unpack('<I',raw(k))]
def descendants(k,seen):
 if k in seen:return []
 seen.add(k);b=by_rid[k];return [(b,p)for p in b.get('parameters',[])]+[p for c in b.get('children',[])for p in descendants(c,seen)]
h=5381
for c in NAME.lower():h=((h*33)^ord(c))&0xffffffff
assert h==graph['sourceNameHash']==2187313360 and graph['sourceGuid']=='3eb625cd-c165-9adb-d4af-d3f3fc3143f3'
chain=['c1e6d9d9b4','c62df8a023','aab373d210','530e48a180','7a4ff9d3e9','a8f22c93b7','abd0f749d0','f237a128ef','8cb85e216d','ca20d289eb','105245b7f0','2304f89b0d']
for a,b in zip(chain,chain[1:]):assert any(e['from']==a and e['to']==b for e in graph['edges']),(a,b)
keys=meta['2031e97674']['values'];default_keys=meta['d9d92f2854']['values'];default_values=meta['8cb85e216d']['values']
vertex_chain=['8cb85e216d','ed3a777f20','a15e19476b','894409a19e']
assert ref(default_values[25]['hash'])==vertex_chain[1] and ref(meta[vertex_chain[1]]['values'][0]['hash'])==vertex_chain[2]
assert ref(struct.unpack_from('<Q',raw(vertex_chain[2]),32)[0])==vertex_chain[3]
sampler_keys=meta['a9cebf3d90']['values'];sampler_values=meta['d954cf7fb6']['values']
assert ref(keys[22]['hash'])==ref(sampler_keys[1]['hash'])=='485d5c4968'
assert ref(sampler_values[1]['hash'])=='d9ca639329' and ref(meta['d9ca639329']['values'][0]['hash'])=='5993a514cd'
assert list(raw('5993a514cd')[16:20])==[85,1,1,1]
sampler={'register':'s0','inputSlot':22,'parameterKeyBlock':'485d5c4968','defaultValues':'d954cf7fb6','defaultIndex':1,'valueRef':'d9ca639329','samplerBlock':'5993a514cd','sourceOffset':index['5993a514cd']['offset'],'rawHex':raw('5993a514cd').hex(),'packedFilterAddressBytes':[85,1,1,1],'browserAddressing':'repeat U/V/W','limitation':'Packed filter0x55 matches D3D anisotropic; browser uses linear mipmaps, native filter conversion and anisotropy remain unobserved.'}
assert slots('a62b277ef4')==[1,12,46,36,13,42,15,5,35,2,37]and slots('e1cfe7a879')==list(range(50,61))
assert slots('c0df1e4652')==[52,59,58,56,60,54,53,57,55,50,51]and raw('44545c9e27')[32:40]==bytes.fromhex('010102000b000000')
conversion=dict(zip(slots('e1cfe7a879'),slots('a62b277ef4')));roles=['baseNormal','globalWear','wear','id','normalAO','grunge','anodized','rubber','metalCS','metalNormal','aluminium'];mapping=[]
for register,(role,converted)in enumerate(zip(roles,slots('c0df1e4652')),2):
 slot=conversion[converted];key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff)
 mapping.append({'register':f't{register}','role':role,'convertedSlot':converted,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters[packed]['nameHash']})
writes=[(v>>16,off,count)for v,off,count in struct.iter_unpack('<IHH',raw('95e4aa260a'))]
assert writes==[(33,0,1),(21,0,1),(26,16,1),(14,32,1),(49,48,1),(24,64,1),(40,80,1),(45,96,1),(0,112,1),(31,128,1)]
constants=[]
for cb,((slot,offset,count),role)in enumerate(zip(writes[1:],['depositedColor','uvScale','restoreDivisor','scratchColor','anodizedColor','anodizedSmoothnessScale','rubberColor','rubberSmoothnessScale','metalColor'])):
 key=ref(keys[slot]['hash']);packed=str(int(meta[key]['values'][0]['hash'])&0xffffffffffff);n=[ref(k['hash'])for k in default_keys].index(key);vr=ref(default_values[n]['hash']);vector=ref(meta[vr]['values'][0]['hash'])
 constants.append({'register':f'cb1[{cb}]','role':role,'inputSlot':slot,'parameterKeyBlock':key,'packedLow48':packed,'parameterHash':parameters[packed]['nameHash'],'defaultIndex':n,'defaultVectorBlock':vector,'defaultSourceOffset':index[vector]['offset'],'default':list(struct.unpack('<4f',raw(vector)))})
scene=json.loads((ROOT/'web/public/assets/map.scene.json').read_text());placed=collections.Counter(i['assetId']for i in scene['instances']);materials=[];textures={}
for mesh in plan['meshes']:
 for material in mesh['materials']:
  if(material.get('shader')or{}).get('name')!=NAME:continue
  bindings={b['parameterHash']:b for b in material['fallbackTextureBindings']};assert set(bindings)==set(x['parameterHash']for x in mapping)
  source=next(iter(bindings.values()));assert all(b['variationHash']==0 and b['sourceEntry']==source['sourceEntry']and b['sourceSection']==source['sourceSection']for b in bindings.values())
  section=by_rid[by_rid[source['sourceEntry']]['children'][source['sourceSection']]];params=descendants(section['children'][1],set())
  row={'assetId':mesh['guid'],'meshName':mesh['name'],'materialId':material['index'],'sourceShader':material['shader'],'sourceEntry':source['sourceEntry'],'sourceSection':source['sourceSection'],'variationHash':0,'placementCount':placed[mesh['guid']],'bindings':{x['role']:bindings[x['parameterHash']]for x in mapping},'constants':[],'constantEvidence':[]}
  for c in constants:
   matches=[(b,p)for b,p in params if p['packedFlags']==c['packedLow48']];assert len({p['rawHex']for _,p in matches})<=1
   if matches:
    b,p=matches[0];value=list(struct.unpack('<4f',bytes.fromhex(p['rawHex'])));e={'kind':'exact-section-override','sourceBlock':b['source']['rid'],'sourceBlockSha256':b['sha256'],'offset':p['offset'],'rawHex':p['rawHex']}
   else:value=c['default'];e={'kind':'rvm-shader-default','sourceBlock':c['defaultVectorBlock'],'sourceOffset':c['defaultSourceOffset']}
   row['constants'].append(value);row['constantEvidence'].append(e)
  materials.append(row)
  for b in bindings.values():textures[b['texture']['fileGuid']]=b['texture']
assert len(materials)==8 and len(textures)==15 and sum(m['placementCount']for m in materials)==680
ps=(OUT/'2304f89b0d.asm').read_text();vs=(OUT/'894409a19e.asm').read_text()
uv_ops=['mov o1.w, v3.x','mov o2.w, v3.y','mov o3.w, v3.z','mov o4.w, v3.w'];assert all(op in vs for op in uv_ops)
normal_ops=['add r2.xy, r2.xyxx, r2.zwzz','add r8.xy, r5.xzxx, r2.xyxx','dp3 r2.x, r8.xyzx, r8.xyzx','rsq r2.x, r2.x','mul r2.xyz, r2.xxxx, r8.xyzx','dp3 r2.x, r3.xyzx, r3.xyzx','rsq r2.x, r2.x','mul r2.xyz, r2.xxxx, r3.xyzx'];assert all(op in ps for op in normal_ops)
producer=['mov o0.w, l(0)','mov o2.xz, l(0,0,0.500000,0)','mad o2.y, r4.w, r1.x, r0.w'];assert all(op in ps for op in producer)
model=json.loads((ROOT/'exports/materials/metalonly-shader/material-analysis.json').read_text())['nativeMaterialModel'];model={**model,'producerOperations':producer}
audit=json.loads((ROOT/'exports/materials/visible-material-audit-current.json').read_text());visible=next(x for x in audit['remainingFamilies']if x['shader']==NAME)
literals={};dxbc=(OUT/'2304f89b0d.dxbc').read_bytes()
for value in [.323143,.171441,.042311,.007499]:
 found=[(off,struct.unpack_from('<f',dxbc,off)[0])for off in range(0,len(dxbc)-3,4)if abs(struct.unpack_from('<f',dxbc,off)[0]-value)<.00000051];assert found and len(set(v for _,v in found))==1
 literals[str(value)]={'value':found[0][1],'bytecodeOffsets':[off for off,_ in found]}
report={'evidenceId':'LOCAL-MASTER2UV-SHADER-001','analysisKind':'Retained-source static decoding; no native execution','shaderName':NAME,'shaderNameHash':h,'shaderGuid':'779b5cbe-1506-41b0-857d-1fe6587182e3','rvmSurfaceGuid':graph['sourceGuid'],'pixelShader':'2304f89b0d','pixelShaderSha256':sha(dxbc),'pairedVertexShader':'894409a19e','pairedVertexShaderSha256':sha((OUT/'894409a19e.dxbc').read_bytes()),'sourceRvmSha256':sha(data),'selectionChain':[{'block':k,**index[k]}for k in chain],'functionInstance':'7a4ff9d3e9','function':'ed8fea1ea5','inputKeyTable':'2031e97674','textureConversionSourceSlots':'a62b277ef4','textureConversionTargetSlots':'e1cfe7a879','applyBlock':'44545c9e27','applyTextureSlots':'c0df1e4652','constantTableWriteOps':'95e4aa260a','constantTableAssembly':'15a9846fb8','defaultKeyTable':'d9d92f2854','defaultValueTable':'8cb85e216d','textureMapping':mapping,'constantMapping':constants,'sourceLiterals':literals,'materials':materials,'sourceTextures':textures,'placedSectionCount':680,'visibleCoverage':{k:v for k,v in visible.items()if k!='members'},'nativeMaterialModel':model,'nativeLightingInputs':{'shNormal':'normalized-source-world-normal','normalInstructions':normal_ops,'materialId':0,'reflectance':.5,'ao':'normalAO(UV1).a','emissive':[0,0,0],'deferredConsumerEvidence':'BF2-NATIVE-GBUFFER-001'},'uvRouting':{'vertexOperations':uv_ops,'baseNormalUv':'converted v3.xy to PS v1.w/v2.w','surfaceUv':'converted v3.zw to PS v3.w/v4.w','sourceAttributeAssociation':'Original UV0/UV1 to converted v3.xy/zw inferred from contiguous source Half2 TexCoord0/1 order and paired float4 input; native vertex-buffer conversion remains undecoded.','browserBaseNormalUv':'original UV0','browserSurfaceUv':'original UV1'},'limitations':['Default variation0 permutation is retained; live native pass selection remains unobserved.','Original UV1 is preserved, but original-to-converted UV association and derivative tangent parity remain explicit reconstruction assumptions.','Material normal sums baseNormal(UV0).rg, normalAO(UV1).rg and detailed UV1 normals; Z comes only from baseNormal(UV0).rg.','Native lighting/framebuffer packing/texture resource-view overrides and lower PNG mip generation remain separate from material algebra.']}
grunge_ops=['mov_sat r8.xy, -v2.xyxx','mov_sat r8.zw, v2.xxxy','add r8.xy, r8.zwzz, r8.xyxx','mad_sat r5.w, r8.x, l(2.000000), l(-1.000000)','mad r5.x, r8.y, -r5.x, r5.x']
assert all(op in ps for op in grunge_ops)
report['samplerMapping']=sampler
report['pairedVertexSelection']={'defaultIndex':25,'chain':vertex_chain}
report['nativeLightingInputs']['geometricNormal']='Vertex-normalized, then interpolated without fragment renormalization for grunge; distinct from final normalized shading normal.'
report['nativeLightingInputs']['grungeInstructions']=grunge_ops
(OUT/'material-analysis.json').write_text(json.dumps(report,indent=2))
lods=json.loads((ROOT/'web/public/assets/source-lods.json').read_text());levels={a['assetId']:[0]+[r['level']for r in a['lods']]for a in lods['assets']}
(ROOT/'exports/materials/master2uv-uv-names.txt').write_text('\n'.join(m['meshName']+'|'+','.join(map(str,levels.get(m['assetId'],[0])))for m in {m['assetId']:m for m in materials}.values())+'\n')
existing={row.get('guid')for file in (ROOT/'exports/materials').glob('*/texture.manifest.json')for row in json.loads(file.read_text()).get('results',[])}
(ROOT/'exports/materials/master2uv-texture-names.txt').write_text('\n'.join(t['name']for guid,t in textures.items()if guid not in existing)+'\n')
print(json.dumps({'sections':len(materials),'textures':len(textures),'placedSections':680,'constants':[m['constants']for m in materials]}))
