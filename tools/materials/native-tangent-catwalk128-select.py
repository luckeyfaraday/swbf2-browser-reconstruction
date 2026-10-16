"""Select only independently proven original input layouts for Catwalk1."""
import collections
import hashlib
import json
import pathlib
import struct
ROOT=pathlib.Path(__file__).resolve().parents[2]
read=lambda p:json.loads((ROOT/p).read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
scene=read('web/public/assets/map.scene.json');assets={a['id']:a for a in scene['assets']};counts=collections.Counter(i['assetId'] for i in scene['instances'])
lods=read('web/public/assets/source-lods.json')['assets']
retained={(r['assetId'],r['sourceLod'],r['sourceMaterialId']):r for r in read('exports/lighting/static-atlas-all-uv/manifest.json')['records']}
for row in read('exports/materials/native-tangent-catwalk132/manifest.json')['records']:
    retained[(row['assetId'],row['sourceLod'],row['sourceMaterialId'])]=dict(strides=[row['fields'][0]['stride']],elements=row['fields'])
targets=[]
for material in read('web/public/assets/recovered-catwalk1-materials.json')['materials']:
    a=assets[material['assetId']]
    base=dict(assetId=a['id'],name=a['name'],sourceLod=0,sourceMaterialId=material['materialId'],lod0MaterialId=material['materialId'],
        family='catwalk1',sourceShader=material['sourceShader'],glbPath='web/public/assets/'+a['url'],placementCount=counts[a['id']])
    targets.append(base)
    for asset in lods:
        if asset['assetId']!=a['id']:continue
        for lod in asset['lods']:
            for section in lod['sections']:
                if section['lod0MaterialId']==material['materialId']:
                    assert section['materialParametersEqualLod0'] and section['sharedParameterRoot']
                    targets.append(dict(base,sourceLod=lod['level'],sourceMaterialId=section['sourceMaterialId'],glbPath='web/public'+lod['url'],lodSourceMaterial=section))

raw=(ROOT/'exports/materials/rvm/0.res').read_bytes();index=read('exports/materials/rvm/block-index.json')['blocks'];graph=read('exports/materials/catwalk1-shader/graph.json')
links=collections.defaultdict(list)
for e in graph['edges']:links[e['from']].append(e)
def block(k):
    r=index[k];return raw[r['offset']:r['offset']+r['size']]
def route(start,target,depth=4):
    if start==target:return []
    if not depth:return None
    for edge in links[start]:
        rest=route(edge['to'],target,depth-1)
        if rest is not None:
            n=struct.unpack_from('<Q',block(start),edge['offset'])[0];assert n==int(edge['encoded']) and n&0xffffffffff==int(edge['to'],16)
            return [edge]+rest
    return None
for stride,priorDirectory in [(28,'native-tangent32')]:
    out=ROOT/f'exports/materials/native-tangent-catwalk1{stride}';out.mkdir(parents=True,exist_ok=True)
    pattern=[('Pos','Half3'),('BinormalSign','Half'),('Normal','Half4'),('Tangent','Half4'),('TexCoord0','Half2')]
    selected=[];excluded=[]
    for target in targets:
        layout=retained.get((target['assetId'],target['sourceLod'],target['sourceMaterialId']))
        if (layout and layout['strides'][0]==stride and [(e['usage'],e['format']) for e in layout['elements']]==pattern) or (layout is None and stride==32):selected.append(target)
        else:excluded.append(target)
    identity=f'BF2-NATIVE-TANGENT-CATWALK1{stride}-001'
    selection=dict(evidenceId=identity,targets=selected,excluded=excluded,sourceMaterialsSha256=sha((ROOT/'web/public/assets/recovered-catwalk1-materials.json').read_bytes()))
    (out/'selection.json').write_text(json.dumps(selection,indent=2)+'\n')
    (out/'names.txt').write_text('\n'.join(f"{r['name']}|{r['sourceLod']}|{r['sourceMaterialId']}" for r in selected)+'\n')
    if stride==32:source=read('exports/materials/native-tangent32/shader-routing.json')['shaders']
    elif stride==44:source=read('exports/materials/native-tangent44/shader-routing.json')['shaders']
    else:
        witness=read('exports/materials/native-tangent-witness/evidence.json')
        # The exact direct36-byte RVM layout is independently retained in the original witness.
        source=[dict(vertex='c36ce7f6e3',inputLayoutBlock='8271cd66a9')]
    shaders=[]
    for original,ps,atlas in zip(source,['d260c7f82c'],[False]):
        vs='c36ce7f6e3';layout=original['inputLayoutBlock']
        vertex_object=next(k for k,r in graph['blocks'].items() if r['type'].endswith('Dx11VsShader') and any(e['to']==vs for e in links[k]))
        parameters=[k for k,r in graph['blocks'].items() if r['type'].endswith('SerializedParameterBlock') and route(k,vs) and route(k,ps)]
        assert len(parameters)==1
        paths=dict(vertex=route(parameters[0],vs),pixel=route(parameters[0],ps),layout=route(vertex_object,layout));assert all(paths.values())
        hashes={}
        for label,name in [('vertex',vs),('pixel',ps)]:
            dxbc=(ROOT/f'exports/materials/catwalk1-shader/{name}.dxbc').read_bytes();encoded=block(name);start=encoded.index(b'DXBC');length=struct.unpack_from('<I',encoded,start+24)[0]
            assert dxbc==encoded[start:start+length];hashes[label+'Sha256']=sha(dxbc)
        decoded=[]
        for string,semantic,fmt,slot,offset,kind,step in struct.iter_unpack('<Q6I',block(layout)):
            assert block(f'{string&0xffffffffff:010x}')==b'TEXCOORD\0'
            decoded.append(dict(semantic='TEXCOORD',index=semantic,dxgiFormat=fmt,inputSlot=slot,offset=offset,classification=kind,step=step))
        shaders.append(dict(family='catwalk1',vertex=vs,pixel=ps,atlas=atlas,vertexObject=vertex_object,parameterBlock=parameters[0],paths=paths,**hashes,
            inputLayoutBlock=layout,inputLayoutOffset=index[layout]['offset'],inputLayoutSha256=sha(block(layout)),inputLayout=decoded,frameOutputRegisters=[3,4,5] if atlas else [2,3,4],separateNormalOutput=False))
    routing=dict(evidenceId=identity,sourceRvmSha256=sha(raw),sourceStride=stride,shaders=shaders,
        frameEquation='N=normalize(M*sourceNormal); T=normalize(M*(-sourceTangent)); B=normalize(M*sourceBinormal)' if stride==44 else 'Original signed32/36 forward-transform frame, independent source BinormalSign.',
        limitations=['Exact Catwalk1 ordinary/atlas pairing only; no48-byte layout extrapolation.','Source-only candidate, runtime unchanged. Native dispatch not captured.'])
    (out/'shader-routing.json').write_text(json.dumps(routing,indent=2)+'\n')
    print(json.dumps(dict(stride=stride,sections=len(selected),baseSectionInstances=sum(r['placementCount'] for r in selected if r['sourceLod']==0))))
