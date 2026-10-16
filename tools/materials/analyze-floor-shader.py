"""Bounded proof of the selected installed floor shader's texture-register mapping."""
import collections, hashlib, json, pathlib, struct
root=pathlib.Path(__file__).resolve().parents[2]
graph=json.loads((root/'exports/materials/floor-shader/graph.json').read_text())
index=json.loads((root/'exports/materials/rvm/block-index.json').read_text())['blocks']
metadata=json.loads((root/'exports/materials/rvm/material-blocks.json').read_text())
data=(root/'exports/materials/rvm/0.res').read_bytes()
blocks=json.loads((root/'exports/materials/floor-blocks/shader-blocks.json').read_text())['blocks']
def raw(key):
 b=index[key];return data[b['offset']:b['offset']+b['size']]
def ref(value):return f'{value&0xffffffffff:010x}'
def slots(key):return [v[0]>>16 for v in struct.iter_unpack('<I',raw(key))]

read_keys=metadata['a3ab1ceb3e']['values']
source_slots=slots('0c904b37ea');converted_slots=slots('e93d08d05e')
conversion=dict(zip(converted_slots,source_slots))
register_slots=slots('d1af947651')
assert source_slots==[11,27,10,9] and converted_slots==[34,35,36,37]
assert register_slots==[35,37,36,34]
header=raw('e06a525d5b')[16:24]
assert header==bytes.fromhex('0101020004000000')
source_params={p['packedFlags']:p for b in blocks for p in b.get('parameters',[]) if 'textureGuid'in p}
mapping=[]
for register,converted in enumerate(register_slots,2):
 slot=conversion[converted];key=ref(int(read_keys[slot]['hash']));param=metadata[key]['values'][0]
 packed=int(param['hash'])&0xffffffffffff;source=source_params[str(packed)]
 mapping.append({'register':f't{register}','convertedSlot':converted,'inputSlot':slot,'parameterKeyBlock':key,'parameterKeyHash':param['hash'],'packedLow48':str(packed),'sourceParameterHash':source['nameHash'],'sourceTextureRootGuid':source['textureGuid']})

plan=json.loads((root/'exports/materials/final-map-material-plan.json').read_text());meshes=[]
for mesh in plan['meshes']:
 for material in mesh['materials']:
  shader=(material.get('shader')or{}).get('name','')
  if shader.lower()!='objects/architecture/_galacticempire/_shaders/ss_dsi_floor_01':continue
  bindings={str(x['parameterHash']):x['texture'] for x in material.get('fallbackTextureBindings',[])}
  assert bindings['2680602575']['fileGuid']=='1aebcb26-41d0-11e6-b972-db87ffe79dfa'
  assert bindings['3886408699']['fileGuid']=='b3fa1236-41db-11e6-b972-db87ffe79dfa'
  meshes.append({'name':mesh['name'],'material':material['index'],'shader':shader,'bindings':bindings})
bytecode=(root/'exports/materials/floor-shader/13ddb144d2.dxbc').read_bytes()
assert hashlib.sha256(bytecode).hexdigest()=='61d1a55e59a352e3d5d044f8aaf2ee7261c7ea787263d456bf0d07fffb52859f'
tint=list(struct.unpack_from('<3f',bytecode,4608))
variants=[]
for path in (root/'exports/materials/floor-shader').glob('*.asm'):
 text=path.read_text()
 if '\nps_5_0\n' in text and '0.064803, 0.053606, 0.042944' in text:
  assert all(term in text for term in ['0.300000, 0.300000, 0.200000, 0.200000','l(1.600000)','l(0.307000)','l(0.500000, 0.500000','l(2.200000)'])
  variants.append(path.stem)
report={'evidenceId':'LOCAL-FLOOR-SHADER-002','parentEvidenceId':graph['evidenceId'],'shaderGuid':graph['sourceGuid'],'shaderNameHash':graph['sourceNameHash'],'pixelShader':'13ddb144d2','pixelShaderSha256':hashlib.sha256(bytecode).hexdigest(),'pairedVertexShader':'606a379e52','functionInstance':'6a604aa2c7','function':'004085b0e5','readView':'5781d06840','inputKeys':'a3ab1ceb3e','textureConversionInstruction':'bd53a144b8','applyInstruction':'3e2599cc3d','applyBlock':'e06a525d5b','applyHeaderHex':header.hex(),'registerMapping':mapping,'linearTint':tint,'tintBytecodeOffset':4608,'sameMaterialMathPixelVariants':sorted(variants),'defaultMaterialSections':meshes,'primaryNormalCounts':dict(collections.Counter(m['bindings']['1648243766']['name']for m in meshes)),'limitations':['RVM slot/stage interpretation is corroborated by shader declarations and exact parameter hash matches, not native execution.','Only exact SS_DSI_Floor_01 default material bindings were checked; per-instance overrides and related dark/vertex-color shader variants are outside this scope.','Full native lighting output, normal encoding, streaming LOD, sampler semantics and tone mapping remain separate.']}
out=root/'exports/materials/floor-shader/material-analysis.json';out.write_text(json.dumps(report,indent=2));print(json.dumps({'report':str(out),'registerMapping':mapping,'materialSections':len(meshes),'materialMathVariants':len(variants),'primaryNormalCounts':report['primaryNormalCounts']},indent=2))
