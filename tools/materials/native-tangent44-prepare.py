"""Prove direct original 44-byte correspondence; no public/runtime mutation."""
import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import struct

ROOT=pathlib.Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--directory',default='exports/materials/native-tangent44');args=parser.parse_args()
OUT=ROOT/args.directory
read=lambda p:json.loads(p.read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
spec=importlib.util.spec_from_file_location('original_tangent_prepare',ROOT/'tools/materials/native-tangent-coverage-prepare.py')
common=importlib.util.module_from_spec(spec);spec.loader.exec_module(common)
selection=read(OUT/'selection.json');extraction=read(OUT/'manifest.json');routing=read(OUT/'shader-routing.json')
targets={(r['assetId'],r['sourceLod'],r['sourceMaterialId']):r for r in selection['targets']}
records=[];samples=[];payload=bytearray();sample_bytes=bytearray();max_cross_error=0;cross_inexact=0
norm=lambda v:[x/math.sqrt(sum(c*c for c in v)) for x in v]
for row in extraction['records']:
    assert row['exactPreparedLayout'] and row['rigidSource']
    route=targets[(row['assetId'],row['sourceLod'],row['sourceMaterialId'])]
    vertices=(OUT/row['vertexFile']).read_bytes();indices=(OUT/row['indexFile']).read_bytes()
    assert sha(vertices)==row['vertexSha256'] and sha(indices)==row['indexSha256']
    assert len(vertices)==row['vertexCount']*44 and len(indices)==row['indexCount']*4
    columns={key:[struct.unpack_from('<'+fmt,vertices,i*44+at) for i in range(row['vertexCount'])] for key,at,fmt in
        [('position',0,'3f'),('binormal',12,'4e'),('normal',20,'4e'),('tangent',28,'4e'),('uv0',36,'2e'),('radiosity',40,'2e')]}
    assert all(math.isfinite(x) for values in columns.values() for vertex in values for x in vertex)
    assert all(sum(x*x for x in v[:3])>0 for k in ['binormal','normal','tangent'] for v in columns[k])
    source_glb,gltf,attribute=common.parse_glb(ROOT/route['glbPath']);primitive=gltf['meshes'][0]['primitives'][row['primitiveIndex']]
    assert gltf['materials'][primitive['material']]['extras']['sourceMaterialId']==row['sourceMaterialId']
    assert attribute(primitive['indices'])==indices
    attributes={}
    for label,key,size in [('POSITION','position',3),('NORMAL','normal',3),('TEXCOORD_0','uv0',2)]:
        raw=b''.join(struct.pack('<'+str(size)+'f',*v[:size]) for v in columns[key]);assert raw==attribute(primitive['attributes'][label]),(row['assetId'],label)
        attributes[label]=dict(sha256=sha(raw),fingerprint=common.fingerprint(raw),bytes=len(raw),bitIdentical=True)
    tangent_offset=len(payload)
    payload.extend(b''.join(struct.pack('<3f',*v[:3]) for v in columns['tangent']))
    binormal_offset=len(payload)
    payload.extend(b''.join(struct.pack('<3f',*v[:3]) for v in columns['binormal']))
    record=dict(row,glbPath=route['glbPath'],glbSha256=sha(source_glb),family=route['family'],lod0MaterialId=route['lod0MaterialId'],
        sourceShader=route['sourceShader'],placementCount=route['placementCount'],attributes=attributes,indexFingerprint=common.fingerprint(indices),
        sourceInputLayout='21d0b76a8c',sourceVertexStride=44,frameKind='explicit-binormal',tangentOffset=tangent_offset,
        tangentBytes=row['vertexCount']*12,tangentItemSize=3,binormalOffset=binormal_offset,binormalBytes=row['vertexCount']*12)
    records.append(record)
    worst=(0,0)
    for i,(n,t,b) in enumerate(zip(columns['normal'],columns['tangent'],columns['binormal'])):
        c=norm([n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]]);b=norm(b[:3])
        error=min(max(abs(c[j]-s*b[j]) for j in range(3)) for s in [-1,1])
        max_cross_error=max(max_cross_error,error);cross_inexact+=error>1e-6
        if error>worst[0]:worst=(error,i)
    # Distributed real vertices plus the largest source-binormal/cross mismatch.
    chosen={round(i*(row['vertexCount']-1)/63) for i in range(64)}|{worst[1]}
    for i in sorted(chosen):samples.append(dict(recordIndex=len(records)-1,sourceVertex=i));sample_bytes.extend(vertices[i*44:(i+1)*44])

cases=read(ROOT/'exports/materials/native-tangent-witness/evidence.json')['inputFixture']['cases']
fixture=bytearray(struct.pack('<4I',0x3147544e,len(cases),len(samples),44))+sample_bytes
for case in cases:
    m=case['matrix'];instance=[0.0]*48;globals_=[0.0]*152
    for base in [2,9]:
        for row in range(3):instance[base*4+row*4:base*4+row*4+4]=[m[col*4+row] for col in range(4)]
    for i in range(4):globals_[14*4+i*4+i]=1
    fixture.extend(struct.pack('<48f4I152f',*instance,0,12,0,0,*globals_))
(OUT/'vertex-input.bin').write_bytes(fixture)
document=dict(version=1,evidenceId=routing['evidenceId'],frameKind='explicit-binormal',frameEquation=routing['frameEquation'],
    byteLength=len(payload),sha256=sha(payload),records=records,publication='Source-only candidate; not compatible with the current sign-only runtime loader.',
    limitations=routing['limitations'])
(OUT/'native-tangent-explicit.bin').write_bytes(payload)
(OUT/'native-tangent-explicit.json').write_text(json.dumps(document,indent=2)+'\n')
stats=dict(sections=len(records),sourceVertices=sum(r['vertexCount'] for r in records),baseSectionInstances=sum(r['placementCount'] for r in records),
    payloadBytes=len(payload),sampledVertices=len(samples),bestSignedCrossMaxError=max_cross_error,signedCrossInexactVertices=cross_inexact)
evidence=dict(evidenceId=document['evidenceId'],stats=stats,selectionSha256=sha((OUT/'selection.json').read_bytes()),
    extractionSha256=sha((OUT/'manifest.json').read_bytes()),shaderRoutingSha256=sha((OUT/'shader-routing.json').read_bytes()),
    payloadSha256=sha(payload),inputFixture=dict(path='vertex-input.bin',sha256=sha(fixture),cases=cases,vertices=len(samples),stride=44,samples=samples),
    limits=['WARP samples distributed vertices and the largest independently stored B versus signed-cross error per section. Raw correspondence includes every vertex.'])
(OUT/'evidence.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(stats))
