"""Retain the exact bounded native draw-state route without guessing its selector."""
import collections,hashlib,json,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2];DIR=ROOT/'exports/rifle-trail/weapons-rvm';OUT=ROOT/'exports/rifle-trail/render-shaders'
data=(DIR/'0.res').read_bytes();index=json.loads((DIR/'block-index.json').read_text())['blocks'];meta=json.loads((DIR/'material-blocks.json').read_text());graph=json.loads((OUT/'graph.json').read_text())
def ref(v):return f'{int(v)&0xffffffffff:010x}'
def raw(k):b=index[k];return data[b['offset']:b['offset']+b['size']]
def describe(k):return {'block':k,**index[k],'sha256':hashlib.sha256(raw(k)).hexdigest(),'rawHex':raw(k).hex()}
keys=[ref(v['hash'])for v in meta['ff720a6d5c']['values']]
assert ref(meta['9bbc174117']['values'][0]['hash'])=='4d54b69286'
assert ref(meta['4d54b69286']['values'][0]['hash'])=='6b5116d286'
assert ref(meta['9bbc174117']['values'][1]['hash'])=='55e53bdabe'
assert ref(meta['55e53bdabe']['values'][0]['hash'])=='c621d91821'
table=[ref(v[0])for v in struct.iter_unpack('<Q',raw('c621d91821'))]
assert len(table)==512 and keys[0]=='c6925ac038' and keys[6]=='6e3cf2b601'
states={k:describe(k)for k in dict.fromkeys(table)}
assert all(s['type'].endswith('Dx11SerializedBlendState')and s['size']==128 for s in states.values())
words=[v[0]for v in struct.iter_unpack('<I',raw('cd98e9755d'))]
slots=[]
for offset,v in enumerate(words):
 row={'builderByteOffset':offset*4,'rawWord':v,'bank':v&65535,'slot':v>>16}
 if row['bank']==0 and row['slot']<len(keys):
  k=keys[row['slot']];row.update({'parameterKeyBlock':k,'parameterKey':meta[k]['values'][0]})
 slots.append(row)
report={'evidenceId':'LOCAL-BLASTER-BOLT-RENDER-STATE-001','sourceRvmSha256':hashlib.sha256(data).hexdigest(),
 'selection':{'combinedParameters':'56d0ffc265','commonParameterBlock':'c35f6f526b','commonDefaults':'9bbc174117','function':'c227d4a7bd','instructionBatches':'b03ea05b9f','drawInstruction':'117d334116','drawBuilder':'cd98e9755d'},
 'baseShaderState':describe('6b5116d286'),'blendStateTable':describe('c621d91821'),'tableEntries':table,'uniqueStates':states,
 'builder':describe('cd98e9755d'),'builderSlots':slots,
 'known':['Common native defaults select exactly this6-byte BaseShaderState and512-entry blend-state table.',
          'Native legacy draw builder references inputslot0 BaseShaderState andinputslot6 Dx11BlendStateData.',
          'Table contains multiple target0 state byte patterns; no table-wide additive or alpha rule exists.'],
 'unresolved':['BaseShaderState bytes000000030501 field meanings and native draw-builder selector arithmetic.',
               'Runtime uint8 inputs1/13 and write-mask/render-pass overrides.',
               'Native render-target2 consumer and complete MRT composite policy.',
               'Global cb2[40].z/.w values: consumer equations preserved, producer has not been recovered.'],
 'policy':'This evidence does not authorize selecting an arbitrary tableindex or claiming native additive rendering.'}
(OUT/'render-material-state.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'tableEntries':len(table),'uniqueStates':len(states),'baseShaderState':raw('6b5116d286').hex(),'builderBytes':len(raw('cd98e9755d'))}))
