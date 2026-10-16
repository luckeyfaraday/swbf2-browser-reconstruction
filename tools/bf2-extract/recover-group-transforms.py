"""Recover original static-model placement matrices from the paired BF2 Havok payloads.

The container's fixup tables use a Frostbite variant and are not decoded here.
The 64-bit virtual class table identifies hknpStaticCompoundShape; its 2013.3
instance array is serialized directly after the 0xd0-byte class. Every inferred
array is independently compared with its 32-bit counterpart and shape-tag order.
"""
import argparse
import collections
import hashlib
import json
import math
import pathlib
import struct

MAGIC = bytes.fromhex('57e0e05710c0c010')


def recover(raw, document):
    starts=[];at=0
    while True:
        at=raw.find(MAGIC,at)
        if at<0:break
        starts.append(at);at+=8
    headers=[]
    for start in starts:
        pointer_size=raw[start+16]
        version=raw[start+40:start+56].rstrip(b'\0\xff').decode('ascii')
        section_at=start+0x40+struct.unpack_from('<h',raw,start+0x3e)[0]
        sections={}
        for i in range(struct.unpack_from('<I',raw,start+20)[0]):
            at=section_at+i*64
            name=raw[at:at+19].split(b'\0')[0].decode('ascii')
            sections[name]=struct.unpack_from('<7I',raw,at+20)
        headers.append((start,pointer_size,version,sections))
    selected=[h for h in headers if h[1]==8 and h[2]=='hk_2013.3.0-r1']
    paired=[h for h in headers if h[1]==4 and h[2]=='hk_2013.3.0-r1']
    if len(selected)!=1 or len(paired)!=1:raise ValueError('Expected paired 32/64-bit Havok2013.3 payloads')
    start,pointer_size,version,sections=selected[0]
    data_header=sections['__data__'];data=start+data_header[0]
    classes=start+sections['__classnames__'][0]
    virtual_begin=data+data_header[3];virtual_end=data+data_header[4]
    compounds=[]
    for at in range(virtual_begin,virtual_end-11,12):
        offset,section,name_offset=struct.unpack_from('<III',raw,at)
        if offset==0xffffffff:continue
        name_start=classes+name_offset
        name=raw[name_start:raw.index(b'\0',name_start)].decode('ascii')
        if name=='hknpStaticCompoundShape':
            count=struct.unpack_from('<I',raw,data+offset+0x68)[0]
            compounds.append({'objectOffset':offset,'count':count,'arrayOffset':data+offset+0xd0})
    groups=[o for o in document['asset']['objects'] if o.get('$type','').endswith('.StaticModelGroupEntityData')]
    if len(groups)!=1:raise ValueError('This bounded recovery expects exactly one source static group')
    group=groups[0];members=group['MemberDatas']
    missing=sum(m['InstanceCount'] for m in members if not m['InstanceTransforms'])
    expected_tags=[m['PhysicsPartRange']['First']+i*m['PhysicsPartCountPerInstance'] for m in members if not m['InstanceTransforms'] for i in range(m['InstanceCount'])]
    candidates=[c for c in compounds if c['count']==missing]
    if not candidates:raise ValueError('No compound count agrees with EBX missing transforms')
    compound=candidates[0];array=compound['arrayOffset']
    first=raw[array:array+80]
    pair_start=paired[0][0];pair_end=start
    pair_array=raw.find(first,pair_start,pair_end)
    if pair_array<0:raise ValueError('32-bit counterpart first transform absent')
    matrices=[];max_orthogonality_error=0;tag_errors=[];scale_ranges=[]
    for i in range(missing):
        at=array+i*128;pair_at=pair_array+i*128
        if raw[at:at+80]!=raw[pair_at:pair_at+80]:raise ValueError('Paired transform differs at instance '+str(i))
        values=list(struct.unpack_from('<20f',raw,at))
        relevant=[0,1,2,4,5,6,8,9,10,12,13,14,16,17,18]
        for other in candidates[1:]:
            other_values=struct.unpack_from('<20f',raw,other['arrayOffset']+i*128)
            if any(values[k]!=other_values[k] for k in relevant):raise ValueError('Collision/raycast root transforms disagree at '+str(i))
        if not all(math.isfinite(v) for v in values):raise ValueError('Non-finite transform')
        tag=struct.unpack_from('<H',raw,at+88)[0];pair_tag=struct.unpack_from('<H',raw,pair_at+84)[0]
        if tag!=expected_tags[i] or pair_tag!=expected_tags[i]:tag_errors.append([i,expected_tags[i],tag,pair_tag])
        scale=values[16:19];mat=values[:16]
        for c in range(3):
            for r in range(3):mat[c*4+r]*=scale[c]
        # Havok stores packed flags in otherwise unused matrix W lanes.
        mat[3]=mat[7]=mat[11]=0;mat[15]=1
        for c in range(3):
            for r in range(c+1,3):
                dot=sum(values[c*4+k]*values[r*4+k] for k in range(3))
                max_orthogonality_error=max(max_orthogonality_error,abs(dot))
        matrices.append(mat)
    if tag_errors:raise ValueError('Sequential shape tags mismatch: '+str(tag_errors[:5]))
    mapped=[];cursor=0
    for index,member in enumerate(members):
        if member['InstanceTransforms']:continue
        count=member['InstanceCount']
        mapped.append({'memberIndex':index,'memberName':member['MeshAsset'].get('name'),'firstShapeTag':member['PhysicsPartRange']['First'],'shapeTagStep':member['PhysicsPartCountPerInstance'],'firstArrayIndex':cursor,'count':count,'matrices':matrices[cursor:cursor+count]})
        cursor+=count
    return {'evidenceId':'BF2-GROUP-TRANSFORMS-'+document['entry']['guid'][:8],'method':'Havok2013.3 hknpStaticCompoundShape identified through virtual class table; source hknpShapeInstance transform/scale and shape tags match every EBX member PhysicsPartRange.First + instance*PhysicsPartCountPerInstance; all '+str(missing)+' transform/scale records byte-equal in independent 32/64-bit payloads',
            'classification':'Original matrix values observed; mapping contiguous shape tags to missing EBX member instance ranges is a corroborated inference pending native/browser visual comparison.',
            'sourceSha256':hashlib.sha256(raw).hexdigest(),'fileGuid':document['entry']['guid'],'groupId':group['$id'],'sourceResource':next(o['Resource'] for o in document['asset']['objects'] if o.get('$type','').endswith('.GroupHavokAsset')),
            'havokVersion':version,'packfile64Offset':start,'compound':compound,'agreeingRootCompounds':candidates,'paired32ArrayOffset':pair_array,'instanceStride':128,'pairedMatricesEqual':True,'shapeTagsMatchEbxPhysicsPartRanges':True,'maxRotationOrthogonalityError':max_orthogonality_error,'recoveredCount':missing,'members':mapped,
            'referenceSource':'https://github.com/vawser/Smithbox/blob/main/src/Havok/HKX2/Autogen/hknpShapeInstance.cs',
            'limitations':['Original collision shapes and compressed fixup tables not decoded.','Member mapping remains an inference until geometry alignment is inspected.']}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--res',required=True,type=pathlib.Path);parser.add_argument('--ebx',required=True,type=pathlib.Path);parser.add_argument('--out',required=True,type=pathlib.Path);args=parser.parse_args()
    result=recover(args.res.read_bytes(),json.loads(args.ebx.read_text(encoding='utf-8')))
    args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ['evidenceId','recoveredCount','pairedMatricesEqual','shapeTagsMatchEbxPhysicsPartRanges','maxRotationOrthogonalityError']}))
