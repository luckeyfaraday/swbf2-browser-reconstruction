"""Bounded source vertex-layout evidence and exact raw-byte VS fixtures."""
import collections, hashlib, json, math, pathlib, struct

ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'exports/materials/native-tangent-witness'
sha=lambda b:hashlib.sha256(b).hexdigest()
read=lambda p:json.loads((ROOT/p).read_text())
INDEX=read('exports/materials/rvm/block-index.json')['blocks']
RVM=(ROOT/'exports/materials/rvm/0.res').read_bytes()
WITNESS=read('exports/materials/native-tangent-witness/manifest.json')

def raw(key):
    b=INDEX[key];return RVM[b['offset']:b['offset']+b['size']]

def glb(path):
    b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);binary=b[28+n:]
    def attribute(index):
        a=j['accessors'][index];v=j['bufferViews'][a['bufferView']];offset=v.get('byteOffset',0)+a.get('byteOffset',0)
        assert a['componentType']in(5125,5126)and'byteStride'not in v
        return binary[offset:offset+a['count']*{'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]*4]
    return b,j['meshes'][0]['primitives'],attribute

def fingerprint(b):
    value=2166136261
    for x in b:value=((value^x)*16777619)&0xffffffff
    return value

def main():
    scene=read('web/public/assets/map.scene.json');paths={a['id']:ROOT/'web/public/assets'/a['url']for a in scene['assets']}
    families={name:read('web/public/assets/recovered-'+name+'-materials.json')for name in ['master1uv','master2uv']}
    shaders=[]
    for family,vertex,ps,atlas in [('master1uv','3eba974d4e','6d0dd89b35',False),('master2uv','894409a19e','2304f89b0d',False),
                                  ('master1uv','007bb70865','965fbe264b',True),('master2uv','15a512d31f','cae11f0532',True)]:
        graph=read('exports/materials/'+family+'-shader/graph.json');edges=collections.defaultdict(list)
        for e in graph['edges']:edges[e['from']].append(e['to'])
        obj=next(k for k,b in graph['blocks'].items()if b['type'].endswith('Dx11VsShader')and vertex in edges[k])
        layout=next(k for k in edges[obj]if INDEX[k]['type'].endswith('Dx11InputElement'))
        assert layout=='07a62c2c96'
        decoded=[]
        for string,index,fmt,slot,offset,kind,step in struct.iter_unpack('<Q6I',raw(layout)):
            string=f'{string&0xffffffffff:010x}';assert raw(string)==b'TEXCOORD\0'
            decoded.append(dict(semantic='TEXCOORD',index=index,dxgiFormat=fmt,inputSlot=slot,offset=offset,classification=kind,step=step))
        assert [(r['index'],r['dxgiFormat'],r['offset'])for r in decoded]==[(0,10,0),(1,10,8),(2,10,16),(3,10,24),(4,34,32)]
        assert all(r['inputSlot']==r['classification']==r['step']==0 for r in decoded)
        path=ROOT/'exports/materials'/f'{family}-shader'/f'{vertex}.dxbc'
        shaders.append(dict(family=family,vertex=vertex,pixel=ps,atlas=atlas,vertexObject=obj,vertexSha256=sha(path.read_bytes()),
                            inputLayoutBlock=layout,inputLayoutOffset=INDEX[layout]['offset'],inputLayoutSha256=sha(raw(layout)),inputLayout=decoded,
                            normalOutputRegister=3 if atlas else 2,frameOutputRegisters=[4,5,6]if atlas else[3,4,5]))
    records=[];vertex_payload=bytearray();tangent_payload=bytearray()
    for row in WITNESS['records']:
        source,primitives,attribute=glb(paths[row['assetId']]);primitive=primitives[row['primitiveIndex']]
        fields={f['usage']:f for f in row['fields']};columns={}
        for usage,f in fields.items():
            b=(OUT/f['floatFile']).read_bytes();rb=(OUT/f['rawFile']).read_bytes()
            assert sha(b)==f['floatSha256']and sha(rb)==f['rawSha256']
            assert f['declaredOffset']==f['traversedOffset']
            columns[usage]=list(struct.iter_unpack('<'+str(f['components'])+'f',b))
        comparisons={}
        for label,usage,components in [('POSITION','Pos',3),('NORMAL','Normal',3),('TEXCOORD_0','TexCoord0',2)]:
            original=b''.join(struct.pack('<'+str(components)+'f',*v[:components])for v in columns[usage])
            actual=attribute(primitive['attributes'][label]);assert original==actual
            comparisons[label]=dict(sha256=sha(actual),fingerprint=fingerprint(actual),bytes=len(actual),bitIdentical=True)
        indices=attribute(primitive['indices']);assert sha(indices)==row['indexSha256']
        route=next((name,m)for name,d in families.items()for m in d['materials']if m['assetId']==row['assetId']and m['materialId']==row['sourceMaterialId'])
        record={k:row[k]for k in ['assetId','sourceLod','primitiveIndex','sourceSectionIndex','sourceMaterialId','vertexCount','indexCount','chunkGuid','chunkSha256']}
        record.update(family=route[0],glbPath=paths[row['assetId']].relative_to(ROOT).as_posix(),glbSha256=sha(source),attributes=comparisons,
                      indexSha256=sha(indices),indexFingerprint=fingerprint(indices),fields=row['fields'])
        if 'BinormalSign'in fields:
            assert [fields[k]['declaredOffset']for k in ['Pos','BinormalSign','Normal','Tangent','TexCoord0','TexCoord1','RadiosityTexCoord']]==[0,6,8,16,24,28,32]
            assert all(f['stride']==36 and f['stream']==0 for f in fields.values())
            record.update(status='source stream is byte-layout-identical to both paired input layouts',vertexOffset=len(vertex_payload),tangentOffset=len(tangent_payload))
            raw_fields={k:(OUT/f['rawFile']).read_bytes()for k,f in fields.items()}
            for i in range(row['vertexCount']):
                packed=bytearray(36)
                for k,f in fields.items():packed[f['declaredOffset']:f['declaredOffset']+f['size']]=raw_fields[k][i*f['size']:(i+1)*f['size']]
                vertex_payload.extend(packed)
                tangent_payload.extend(struct.pack('<4f',*columns['Tangent'][i][:3],columns['BinormalSign'][i][0]))
            record['signCounts']={str(sign):sum(v[0]==sign for v in columns['BinormalSign'])for sign in [-1,1]}
            assert sum(record['signCounts'].values())==row['vertexCount']
            record['tangentBytes']=row['vertexCount']*16
        else:
            record.update(status='not published: Float3/explicit Binormal source requires unresolved native stream conversion')
        records.append(record)
    asset='2dfb9f9d-44b0-2147-6a29-d0b0a878ae53'
    cases=[dict(name='identity',matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),
           dict(name='nonuniform-positive',matrix=[2,0,0,0,0,.3,0,0,0,0,1.5,0,0,0,0,1]),
           dict(name='mirrored',matrix=[-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),
           dict(name='sheared',matrix=[1,.2,0,0,.5,1,.3,0,0,.1,1,0,0,0,0,1])]
    for instance in [x for x in scene['instances']if x['assetId']==asset][:8]:cases.append(dict(name='source-placement-'+str(len(cases)-4),matrix=instance['matrix'],source=instance['source']))
    fixture=bytearray(struct.pack('<4I',0x3147544e,len(cases),len(vertex_payload)//36,36));fixture.extend(vertex_payload)
    for case in cases:
        matrix=case['matrix'];instance=[0.0]*48
        for base in [2,9]:
            for row in range(3):instance[base*4+row*4:base*4+row*4+4]=[matrix[column*4+row]for column in range(4)]
        globals=[0.0]*152
        for i in range(4):globals[14*4+i*4+i]=1
        fixture.extend(struct.pack('<48f4I152f',*instance,0,12,0,0,*globals))
    (OUT/'vertex-input.bin').write_bytes(fixture)
    evidence=dict(evidenceId='BF2-NATIVE-TANGENT-WITNESS-001',sourceRvmSha256=sha(RVM),shaders=shaders,records=records,
                  frameEquation=dict(N='normalize(M*Nsource)',T='normalize(M*(-Tsource))',B='normalize(M*(-cross(Nsource,Tsource)*BinormalSign))',
                    fragment='normalize(Tvarying*normalTS.x + Bvarying*normalTS.y + Nvarying*normalTS.z)',
                    interpolation='VS normalizes each vector, PS interpolates without renormalizing separate frame columns; only final mapped normal is normalized.',
                    transform='Native VS applies the same forward instance3x3 to all three vectors, then normalizes; inverse-transpose is not used.'),
                  inputFixture=dict(path='vertex-input.bin',sha256=sha(fixture),cases=cases,vertices=len(vertex_payload)//36,stride=36),
                  limitations=['No native application frame or original converter execution is captured.',
                    'For2dfb9f9d each source byte offset/format exactly matches the original RVM DX11 input layout. The raw source bytes drive unchanged VS fixtures directly.',
                    'The44-byte explicit-binormal5dde6982 witness requires native stream conversion; its handedness is not inferred or published.',
                    'Only two sections of one LOD0 rigid wall are prepared for optional integration. No runtime activation, GLB mutation or collision change.'])
    (OUT/'evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    # Retain this narrow original witness independently. Runtime publication is
    # explicit in native-tangent-coverage-publish.py and may include more records.
    (OUT/'tangent-output.bin').write_bytes(tangent_payload)
    document=dict(version=1,evidenceId=evidence['evidenceId'],url='/assets/native-tangent-witness.bin',sha256=sha(tangent_payload),byteLength=len(tangent_payload),
                  records=[r for r in records if'tangentOffset'in r],frameEquation=evidence['frameEquation'],limitations=evidence['limitations'])
    (OUT/'document.json').write_text(json.dumps(document,indent=2)+'\n')
    print(json.dumps(dict(records=len(records),published=len(document['records']),vertices=len(vertex_payload)//36,tangentBytes=len(tangent_payload),cases=len(cases))))

if __name__=='__main__':main()
