"""Narrow read-only BF2 paired Havok2013.3 static-compound convex decoder.

Frostbite stores both pointer-width packfiles followed by their fixup blobs.
The __data__ header fields normally used as local/global offsets instead hold
total fixup bytes and local-fixup bytes. No in-place pointer mutation is needed.
"""
import argparse
import hashlib
import json
import math
import pathlib
import struct

MAGIC=bytes.fromhex('57e0e05710c0c010')

def load_packs(raw):
    packs=[];cursor=0
    while True:
        start=raw.find(MAGIC,cursor)
        if start<0:break
        cursor=start+8
        version=raw[start+40:start+56].rstrip(b'\0\xff').decode()
        if version!='hk_2013.3.0-r1':raise ValueError('Unsupported Havok version '+version)
        sections={};table=start+0x40+struct.unpack_from('<h',raw,start+0x3e)[0]
        for i in range(struct.unpack_from('<I',raw,start+20)[0]):
            at=table+i*64;name=raw[at:at+19].split(b'\0')[0].decode()
            sections[name]=struct.unpack_from('<7I',raw,at+20)
        dh=sections['__data__'];data=start+dh[0];classnames=start+sections['__classnames__'][0];classes={}
        for at in range(data+dh[3],data+dh[4]-11,12):
            offset,section,nameoffset=struct.unpack_from('<III',raw,at)
            if offset==0xffffffff:continue
            if section!=0:raise ValueError('Unexpected class name section')
            name_start=classnames+nameoffset;classes[offset]=raw[name_start:raw.index(b'\0',name_start)].decode()
        packs.append({'start':start,'pointerSize':raw[start+16],'version':version,'sections':sections,'data':data,'end':data+dh[6],'classes':classes})
    if len(packs)!=2 or [p['pointerSize'] for p in packs]!=[4,8]:raise ValueError('Expected exactly paired32/64 packs')
    trailer=packs[-1]['end'];sizes=struct.unpack_from('<II',raw,trailer);cursor=trailer+8
    for pack,size in zip(packs,sizes):
        dh=pack['sections']['__data__'];local_size=dh[2]
        if size!=dh[1] or size<local_size or cursor+size>len(raw):raise ValueError('Fixup trailer bounds disagree')
        local={};glob={}
        for at in range(cursor,cursor+local_size,8):
            source,dest=struct.unpack_from('<II',raw,at)
            if source==0xffffffff:continue
            if source>=dh[3] or dest>=dh[3]:raise ValueError('Local fixup outside object data')
            local[source]=dest
        for at in range(cursor+local_size,cursor+size-11,12):
            source,section,dest=struct.unpack_from('<III',raw,at)
            if source==0xffffffff:continue
            if section!=2 or source>=dh[3] or dest not in pack['classes']:raise ValueError('Global fixup invalid')
            glob[source]=dest
        pack.update(local=local,glob=glob,fixupStart=cursor,fixupBytes=size)
        cursor+=size
    return packs

def relarray(raw,base,offset,stride):
    count,relative=struct.unpack_from('<HH',raw,base+offset);at=base+offset+relative
    if at+count*stride>len(raw):raise ValueError('Relative array out of bounds')
    return count,at

def polytope(raw,pack,offset):
    if pack['classes'].get(offset)!='hknpConvexPolytopeShape':raise ValueError('Unsupported compound child '+str(pack['classes'].get(offset)))
    base=pack['data']+offset;flags=struct.unpack_from('<H',raw,base+16)[0];radius=struct.unpack_from('<f',raw,base+20)[0]
    if not flags&0x100:raise ValueError('Only observed small-face format supported')
    if radius!=0:raise ValueError('Rounded convex hull requires explicit radius surface treatment')
    vc,va=relarray(raw,base,48,16);pc,pa=relarray(raw,base,64,16);fc,fa=relarray(raw,base,68,4);ic,ia=relarray(raw,base,72,1)
    vertices=[list(struct.unpack_from('<4f',raw,va+i*16)[:3]) for i in range(vc)]
    planes=[list(struct.unpack_from('<4f',raw,pa+i*16)) for i in range(pc)]
    faces=[];triangles=[]
    for i in range(fc):
        angle,count,first=struct.unpack_from('<BBH',raw,fa+i*4)
        if count<3 or first+count>ic:raise ValueError('Face index range invalid')
        indices=list(raw[ia+first:ia+first+count])
        if any(v>=vc for v in indices):raise ValueError('Face references absent vertex')
        faces.append({'indices':indices,'minimumHalfAngle':angle})
        for j in range(1,count-1):triangles.extend([indices[0],indices[j],indices[j+1]])
    # First fc plane records correspond to the source faces. The extra records
    # pad the SIMD array. Check each face and every convex vertex independently.
    plane_error=0
    for face,plane in zip(faces,planes):
        for i in face['indices']:plane_error=max(plane_error,abs(sum(a*b for a,b in zip(plane[:3],vertices[i]))+plane[3]))
        if max(sum(a*b for a,b in zip(plane[:3],v))+plane[3] for v in vertices)>2e-5:raise ValueError('Vertex outside source convex plane')
    if plane_error>2e-5:raise ValueError('Face/plane mismatch')
    return {'class':'hknpConvexPolytopeShape','objectOffset':offset,'absoluteOffset':base,'flags':flags,'convexRadius':radius,'vertices':vertices,'planes':planes,'faces':faces,'triangles':triangles,'maxFacePlaneError':plane_error,'sourceArrays':{'vertices':va,'planes':pa,'faces':fa,'indices':ia}}

def root_shapes(raw,pack):
    containers=[k for k,v in pack['classes'].items() if v=='HavokPhysicsContainer']
    if len(containers)!=1:raise ValueError('Expected one HavokPhysicsContainer')
    offset=containers[0];pointer=pack['pointerSize'];field=offset+(16 if pointer==8 else 8)
    array=pack['local'][field];count=struct.unpack_from('<I',raw,pack['data']+field+pointer)[0]
    return [pack['glob'][array+i*pointer] for i in range(count)]

def compound(raw,pack,root_index):
    roots=root_shapes(raw,pack);offset=roots[root_index]
    if pack['classes'][offset]!='hknpStaticCompoundShape':raise ValueError('Expected static compound root')
    array=pack['local'][offset+0x60];count=struct.unpack_from('<I',raw,pack['data']+offset+0x60+pack['pointerSize'])[0]
    shapes=[]
    for i in range(count):
        instance=array+i*128;values=list(struct.unpack_from('<20f',raw,pack['data']+instance));matrix=values[:16]
        for col in range(3):
            for row in range(3):matrix[col*4+row]*=values[16+col]
        matrix[3]=matrix[7]=matrix[11]=0;matrix[15]=1
        child=polytope(raw,pack,pack['glob'][instance+80]);child['matrix']=matrix;child['instanceOffset']=instance
        child['transformedVertices']=[[sum(matrix[c*4+r]*v[c] for c in range(3))+matrix[12+r] for r in range(3)] for v in child['vertices']]
        shapes.append(child)
    return {'rootIndex':root_index,'objectOffset':offset,'class':pack['classes'][offset],'roots':[{'index':i,'objectOffset':v,'class':pack['classes'][v]} for i,v in enumerate(roots)],'shapes':shapes}

def write_glb(path,shapes,extras):
    vertices=[];indices=[]
    for shape in shapes:
        first=len(vertices);vertices.extend(shape['transformedVertices']);indices.extend(first+i for i in shape['triangles'])
    positions=b''.join(struct.pack('<3f',*v) for v in vertices);index_bytes=struct.pack('<'+'I'*len(indices),*indices)
    bounds={'min':[min(v[i] for v in vertices) for i in range(3)],'max':[max(v[i] for v in vertices) for i in range(3)]}
    doc={'asset':{'version':'2.0','generator':'BF2 original convex collision extractor'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],
      'meshes':[{'name':'native-catwalk-collision-root0','primitives':[{'attributes':{'POSITION':0},'indices':1,'mode':4}]}],
      'buffers':[{'byteLength':len(positions)+len(index_bytes)}],
      'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(positions),'target':34962},{'buffer':0,'byteOffset':len(positions),'byteLength':len(index_bytes),'target':34963}],
      'accessors':[{'bufferView':0,'componentType':5126,'count':len(vertices),'type':'VEC3',**bounds},{'bufferView':1,'componentType':5125,'count':len(indices),'type':'SCALAR'}],
      'extras':extras}
    text=json.dumps(doc,separators=(',',':')).encode();text+=b' '*((-len(text))%4);binary=positions+index_bytes
    path.write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(text)+8+len(binary))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(binary),0x004e4942)+binary)
    return {'vertices':len(vertices),'triangles':len(indices)//3,'bounds':bounds}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--out',required=True);parser.add_argument('--root',type=int,default=0);args=parser.parse_args()
    source=pathlib.Path(args.input);raw=source.read_bytes();packs=load_packs(raw);a,b=[compound(raw,p,args.root) for p in packs]
    if len(a['shapes'])!=len(b['shapes']):raise ValueError('Paired compound sizes differ')
    for x,y in zip(a['shapes'],b['shapes']):
        for key in ['vertices','planes','faces','triangles','matrix','transformedVertices']:
            if x[key]!=y[key]:raise ValueError('Independent pointer-width data differs: '+key)
    output=pathlib.Path(args.out);output.mkdir(parents=True,exist_ok=True)
    evidence={'evidenceId':'BF2-CATWALK-NATIVE-COLLISION-001','source':str(source),'sourceSha256':hashlib.sha256(raw).hexdigest(),'root':b,'paired32And64Agree':True,
      'fixupLayout':[{'pointerSize':p['pointerSize'],'start':p['fixupStart'],'bytes':p['fixupBytes'],'localCount':len(p['local']),'globalCount':len(p['glob'])} for p in packs],
      'observations':['Collision root0 contains original convex polytope surfaces; separate root1 is a compressed raycast mesh.','Every face index, vertex, plane and instance matrix agrees between independent32/64-bit payloads.','All source faces lie on their stored planes; all vertices are inside the source convex planes.'],
      'inferences':['Frostbite fixup trailer fields interpreted by exact pointer/class/range consistency across both payloads.','Relative-array byte layout recovered by bounds/plane/face agreement; polygon faces triangulated without moving vertices.'],
      'unknowns':['Compressed raycast-root geometry not decoded.','Only zero-radius convex hulls with observed small-face layout supported.','No claim of matching native collision solver contact response.'],
      'references':['https://github.com/vawser/Smithbox/blob/main/src/Havok/HKX2/Autogen/hknpConvexPolytopeShape.cs','https://github.com/vawser/Smithbox/blob/main/src/Havok/HKX2/Autogen/hknpShape.cs']}
    evidence['geometry']=write_glb(output/'collision.root0.glb',b['shapes'],{'evidenceId':evidence['evidenceId'],'sourceSha256':evidence['sourceSha256'],'originalCollisionRoot':args.root,'runtimeObserved':False})
    (output/'collision.source.json').write_text(json.dumps(evidence,indent=2));print(json.dumps({'evidenceId':evidence['evidenceId'],'shapes':len(b['shapes']),'geometry':evidence['geometry'],'paired32And64Agree':True}))
if __name__=='__main__':main()
